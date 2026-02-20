#!/usr/bin/env python3
"""
Flux Image Generation Service
FastAPI service for local Flux/SDXL image generation
"""

import os
import sys
from pathlib import Path
from typing import Optional, List
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
from diffusers import FluxPipeline, AutoencoderKL, EulerDiscreteScheduler, DDIMScheduler, PNDMScheduler, DPMSolverMultistepScheduler
from diffusers.utils import load_image
from huggingface_hub import login
from safetensors.torch import load_file
from transformers import T5Config

# Import encoder loading module (extracted for reusability and testability)
# Make sure encoder_loading.py is in Python path (it's in same directory)
services_dir = Path(__file__).parent
if str(services_dir) not in sys.path:
    sys.path.insert(0, str(services_dir))
from encoder_loading import load_text_encoders, load_vae_with_fallback

# Service configuration
PORT = int(os.getenv('FLUX_PORT', '8001'))

# Model source: Local path or HuggingFace repo
# FLUX_MODEL_PATH takes precedence for locally downloaded models (e.g., from CivitAI)
# FLUX_MODEL is used for HuggingFace repos
FLUX_MODEL_PATH = os.getenv('FLUX_MODEL_PATH')  # e.g., /path/to/model.safetensors
MODEL_NAME = os.getenv('FLUX_MODEL', 'black-forest-labs/FLUX.1-dev')

# LoRA configuration
FLUX_LORA_PATH = os.getenv('FLUX_LORA_PATH')  # Optional LoRA weights path
LORA_DEFAULT_SCALE = float(os.getenv('FLUX_LORA_SCALE', '1.0'))  # Default LoRA strength
LORAS_DIR = Path(os.getenv('FLUX_LORAS_DIR', 'services/loras'))  # Directory for LoRA files
MAX_LORAS = 4  # Maximum number of simultaneous LoRAs

# Scheduler configuration
# Supported schedulers for Flux fine-tunes (e.g., CustomFluxModel recommends Euler)
SUPPORTED_SCHEDULERS = {
    'euler': EulerDiscreteScheduler,
    'dpmsolver': DPMSolverMultistepScheduler,  # default for Flux
    'ddim': DDIMScheduler,
    'pndm': PNDMScheduler,
}
DEFAULT_SCHEDULER = os.getenv('FLUX_SCHEDULER')  # Optional default scheduler override

# Custom encoder paths (for models like pixelwave that require specific encoders)
FLUX_TEXT_ENCODER_PATH = os.getenv('FLUX_TEXT_ENCODER_PATH')  # Local CLIP-L encoder
FLUX_TEXT_ENCODER_2_PATH = os.getenv('FLUX_TEXT_ENCODER_2_PATH')  # Local T5-XXL encoder
FLUX_VAE_PATH = os.getenv('FLUX_VAE_PATH')  # Local VAE encoder

# Debug: Log encoder configuration at startup
if FLUX_TEXT_ENCODER_PATH or FLUX_TEXT_ENCODER_2_PATH or FLUX_VAE_PATH:
    print('[Flux Service] Custom encoder paths configured:')
    if FLUX_TEXT_ENCODER_PATH:
        print(f'  - CLIP-L: {FLUX_TEXT_ENCODER_PATH}')
    if FLUX_TEXT_ENCODER_2_PATH:
        print(f'  - T5-XXL: {FLUX_TEXT_ENCODER_2_PATH}')
    if FLUX_VAE_PATH:
        print(f'  - VAE: {FLUX_VAE_PATH}')

# Determine model source and validate
if FLUX_MODEL_PATH:
    # Using local model file
    MODEL_SOURCE = 'local'
    model_path = Path(FLUX_MODEL_PATH).resolve()  # Convert to absolute path
    if not model_path.exists():
        print(f'[Flux Service] ⚠️ WARNING: FLUX_MODEL_PATH does not exist: {FLUX_MODEL_PATH}')
        print(f'[Flux Service] Falling back to HuggingFace model: {MODEL_NAME}')
        MODEL_SOURCE = 'huggingface'
        FLUX_MODEL_PATH = None
    else:
        FLUX_MODEL_PATH = str(model_path)  # Use absolute path for DiffusionPipeline
        print(f'[Flux Service] Using local model: {FLUX_MODEL_PATH}')
else:
    # Using HuggingFace repo
    MODEL_SOURCE = 'huggingface'
    print(f'[Flux Service] Using HuggingFace model: {MODEL_NAME}')

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
HF_TOKEN = os.getenv('HF_TOKEN')

# Authenticate with Hugging Face only if needed (HuggingFace model source or VAE fallback)
if HF_TOKEN and MODEL_SOURCE == 'huggingface':
    print('[Flux Service] Authenticating with Hugging Face...')
    try:
        login(token=HF_TOKEN)
    except Exception as e:
        print(f'[Flux Service] ⚠️ HuggingFace login failed: {e}')
        print('[Flux Service] Continuing without authentication - gated models may fail')
elif MODEL_SOURCE == 'local':
    print('[Flux Service] Using local model - HuggingFace authentication not required')
else:
    print('[Flux Service] ⚠️ HF_TOKEN not set - gated models will fail to load')


@asynccontextmanager
async def lifespan(app):
    """Lifespan event handler for startup/shutdown"""
    print(f'[Flux Service] Starting on port {PORT}')
    if MODEL_SOURCE == 'local':
        print(f'[Flux Service] Model source: LOCAL')
        print(f'[Flux Service] Model path: {FLUX_MODEL_PATH}')
    else:
        print(f'[Flux Service] Model source: HuggingFace')
        print(f'[Flux Service] Model: {MODEL_NAME}')
    print(f'[Flux Service] Device: {DEVICE}')
    if FLUX_LORA_PATH:
        print(f'[Flux Service] LoRA configured: {FLUX_LORA_PATH} (scale: {LORA_DEFAULT_SCALE})')
        print(f'[Flux Service] LoRA will auto-load when model is loaded (on first generation)')
    yield
    print('[Flux Service] Shutting down')


# Initialize FastAPI with lifespan
app = FastAPI(title='Flux Image Generation Service', version='1.0.0', lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Global pipeline (loaded on first request)
pipeline = None

# Global LoRA state (single LoRA - legacy support)
current_lora = {
    'path': None,
    'scale': LORA_DEFAULT_SCALE,
    'loaded': False
}

# Multiple LoRA state tracking
current_loras = []  # List of loaded LoRAs: [{'path': ..., 'scale': ..., 'adapter_name': ..., 'loaded': True/False}]

# Global face fixer (lazy-loaded on first use)
face_fixer = None


def load_face_fixer():
    """Load face fixing pipeline with GPU coordination"""
    global face_fixer

    if face_fixer is not None:
        return face_fixer

    try:
        print('[Flux Service] Loading face fixing models...')
        from face_fixing import FaceFixingPipeline
        face_fixer = FaceFixingPipeline(device=DEVICE)
        print('[Flux Service] Face fixing models loaded')
        return face_fixer
    except ImportError:
        print('[Flux Service] Warning: Face fixing not available (face_fixing module not found)')
        return None
    except Exception as e:
        print(f'[Flux Service] Warning: Failed to load face fixing: {e}')
        return None


class GenerationRequest(BaseModel):
    """Image generation request"""
    model: str
    prompt: str
    height: int = 1024
    width: int = 1024
    steps: int = 25  # Flux-dev: 20-30 steps for quality
    guidance: float = 3.5  # Flux-dev guidance scale
    seed: Optional[int] = None
    negativePrompt: Optional[str] = None
    loras: List[dict] = []
    lora_scale: Optional[float] = None  # Per-request LoRA strength override
    scheduler: Optional[str] = None  # euler, dpmsolver, ddim, pndm (per-request override)
    fix_faces: bool = False  # Enable face fixing via GFPGAN
    restoration_strength: float = 0.5  # GFPGAN restoration strength (0.0=preserve original, 1.0=full restoration)
    face_upscale: Optional[int] = None  # Optional upscaling factor (1=none, 2=2x)
    return_intermediate_images: bool = False  # Return base image before face fixing for debugging


class GenerationResponse(BaseModel):
    """Image generation response"""
    localPath: str
    metadata: dict
    base_image: Optional[str] = None  # Base64-encoded base image before face fixing


def load_pipeline():
    """Load the Flux pipeline with memory optimizations for 12GB GPUs"""
    global pipeline

    if pipeline is not None:
        return pipeline

    # Determine which model to load
    model_to_load = FLUX_MODEL_PATH if MODEL_SOURCE == 'local' else MODEL_NAME
    print(f'[Flux Service] Loading model from {MODEL_SOURCE}: {model_to_load}')
    print(f'[Flux Service] Device: {DEVICE}')

    # Clear GPU memory before loading
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        import gc
        gc.collect()
        free_mem = torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated(0)
        print(f'[Flux Service] Available GPU memory: {free_mem / 1024**3:.1f} GB')

    try:
        # Load from local path or HuggingFace
        # For local models, token is not needed
        # For HuggingFace models, pass token for gated models
        kwargs = {
            'torch_dtype': torch.float16 if DEVICE == 'cuda' else torch.float32,
            'low_cpu_mem_usage': True,  # Enable memory-efficient loading (uses ~50% less RAM)
        }
        if MODEL_SOURCE == 'huggingface':
            kwargs['token'] = HF_TOKEN
            pipeline = FluxPipeline.from_pretrained(
                model_to_load,
                **kwargs
            )
        else:
            # Local .safetensors file - use from_single_file
            # First try loading as-is
            try:
                pipeline = FluxPipeline.from_single_file(
                    model_to_load,
                    **kwargs
                )
            except Exception as e:
                # If missing components (e.g., text_encoder, text_encoder_2, vae), load them using encoder_loading module
                error_str = str(e).lower()
                if any(x in error_str for x in ['missing', 'cliptextmodel', 't5encoder', 'autoencoder']):
                    print(f'[Flux Service] Custom model missing components, loading with encoder_loading module: {e}')

                    # CRITICAL: For local checkpoints, require local encoders (no fallback)
                    # This prevents dimension mismatches that cause errors like:
                    # "mat1 and mat2 shapes cannot be multiplied (512x768 and 4096x3072)"
                    require_local_encoders = (MODEL_SOURCE == 'local')

                    if require_local_encoders:
                        print('[Flux Service] 🔒 LOCAL CHECKPOINT DETECTED')
                        print('[Flux Service] Requiring local encoders - HuggingFace fallback DISABLED')
                        print('[Flux Service] This prevents architecture mismatches with custom models')

                    # Load VAE with fallback chain (or require local)
                    vae = load_vae_with_fallback(kwargs['torch_dtype'], require_local=require_local_encoders)

                    # Load text encoders (CLIP-L and T5-XXL) with fallback chains (or require local)
                    print('[Flux Service] Loading text encoders with encoder_loading module...')
                    text_encoder, text_encoder_2 = load_text_encoders(kwargs['torch_dtype'], require_local=require_local_encoders)

                    # Retry with all loaded components
                    pipeline = FluxPipeline.from_single_file(
                        model_to_load,
                        text_encoder=text_encoder,
                        text_encoder_2=text_encoder_2,
                        vae=vae,
                        **kwargs
                    )
                else:
                    # Re-raise if it's a different error
                    raise

        if DEVICE == 'cuda':
            # Use sequential CPU offload - most aggressive memory saving
            # Keeps model in CPU RAM, moves each layer to GPU only during its forward pass
            print('[Flux Service] Enabling sequential CPU offload for 12GB GPU...')

            # Check if transformer is on meta device (shouldn't happen with low_cpu_mem_usage=False)
            try:
                if hasattr(pipeline, 'transformer'):
                    transformer_device = next(pipeline.transformer.parameters()).device.type
                    if transformer_device == 'meta':
                        print('[Flux Service] WARNING: Transformer on meta device, skipping CPU offload')
                        print('[Flux Service] This may cause OOM on 12GB GPUs')
                    else:
                        pipeline.enable_sequential_cpu_offload()
                else:
                    pipeline.enable_sequential_cpu_offload()
            except Exception as e:
                print(f'[Flux Service] WARNING: Could not enable CPU offload: {e}')
                print('[Flux Service] Continuing without CPU offload - may OOM on 12GB GPUs')

            # Additional memory optimizations for inference
            pipeline.enable_attention_slicing(1)  # Maximum slicing
            # Use new VAE methods to avoid deprecation warnings
            if hasattr(pipeline.vae, 'enable_slicing'):
                pipeline.vae.enable_slicing()
            if hasattr(pipeline.vae, 'enable_tiling'):
                pipeline.vae.enable_tiling()

        print('[Flux Service] Model loaded successfully')

        # Debug: Show device placement for each component
        print('[Flux Service] Component device placement:')
        for name in ['transformer', 'text_encoder', 'text_encoder_2', 'vae']:
            if hasattr(pipeline, name):
                component = getattr(pipeline, name)
                if component is not None:
                    try:
                        device = next(component.parameters()).device
                        print(f'[Flux Service]   {name}: {device}')
                    except StopIteration:
                        print(f'[Flux Service]   {name}: no parameters')
                else:
                    print(f'[Flux Service]   {name}: None')

        # Auto-load LoRA if configured
        if FLUX_LORA_PATH:
            try:
                print(f'[Flux Service] Auto-loading configured LoRA: {FLUX_LORA_PATH}')
                load_lora_weights(FLUX_LORA_PATH, LORA_DEFAULT_SCALE)
            except Exception as lora_error:
                print(f'[Flux Service] Warning: Failed to load LoRA, continuing without it: {lora_error}')
                # Continue without LoRA - non-critical failure

        return pipeline

    except Exception as e:
        print(f'[Flux Service] Failed to load model: {e}')
        import traceback
        traceback.print_exc()
        raise


def unload_pipeline():
    """Unload the pipeline to free GPU memory"""
    global pipeline
    import gc

    if pipeline is not None:
        print('[Flux Service] Unloading model...')
        del pipeline
        pipeline = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print('[Flux Service] Model unloaded, GPU memory freed')
        return True
    return False


def load_lora_weights(lora_path: str, lora_scale: float = 1.0):
    """
    Load LoRA weights into the pipeline

    Args:
        lora_path: Path to LoRA .safetensors file
        lora_scale: LoRA strength/weight (0.0 to 2.0, typically 0.7-1.0)

    Returns:
        dict: Status information
    """
    global pipeline, current_lora

    if pipeline is None:
        raise RuntimeError('Pipeline must be loaded before adding LoRA')

    # Validate LoRA file exists and convert to absolute path
    lora_file = Path(lora_path).resolve()
    if not lora_file.exists():
        raise FileNotFoundError(f'LoRA file not found: {lora_path}')

    try:
        print(f'[Flux Service] Loading LoRA from: {lora_file}')
        print(f'[Flux Service] LoRA scale: {lora_scale}')

        # Load LoRA weights using diffusers API
        # For Flux models, LoRAs are typically loaded as adapters
        pipeline.load_lora_weights(str(lora_file))

        # Set LoRA scale if supported
        if hasattr(pipeline, 'set_adapters'):
            # Get the actual adapter names that were loaded
            adapters = list(pipeline.get_list_adapters().keys()) if hasattr(pipeline, 'get_list_adapters') else ['default']
            if not adapters:
                adapters = ['default']
            # For newer diffusers versions with adapter support
            pipeline.set_adapters(adapters, adapter_weights=[lora_scale] * len(adapters))
        elif hasattr(pipeline, 'fuse_lora'):
            # Fuse LoRA into model weights for older API
            pipeline.fuse_lora(lora_scale=lora_scale)

        # Update current LoRA state
        current_lora['path'] = str(lora_path)
        current_lora['scale'] = lora_scale
        current_lora['loaded'] = True

        print('[Flux Service] LoRA loaded successfully')
        return {
            'status': 'loaded',
            'path': str(lora_path),
            'scale': lora_scale
        }

    except Exception as e:
        print(f'[Flux Service] Failed to load LoRA: {e}')
        import traceback
        traceback.print_exc()
        current_lora['loaded'] = False
        raise


def unload_lora():
    """Unload/unfuse LoRA weights from pipeline"""
    global pipeline, current_lora

    if pipeline is None:
        return {'status': 'no_pipeline', 'message': 'Pipeline not loaded'}

    if not current_lora['loaded']:
        return {'status': 'no_lora', 'message': 'No LoRA currently loaded'}

    try:
        print('[Flux Service] Unloading LoRA...')

        # Try different methods to remove LoRA
        if hasattr(pipeline, 'unfuse_lora'):
            pipeline.unfuse_lora()
        elif hasattr(pipeline, 'delete_adapters'):
            pipeline.delete_adapters()
        elif hasattr(pipeline, 'unload_lora_weights'):
            pipeline.unload_lora_weights()

        # Reset LoRA state
        current_lora['path'] = None
        current_lora['loaded'] = False

        print('[Flux Service] LoRA unloaded successfully')
        return {'status': 'unloaded', 'message': 'LoRA removed'}

    except Exception as e:
        print(f'[Flux Service] Failed to unload LoRA: {e}')
        return {'status': 'error', 'message': str(e)}


def load_multiple_loras(loras: List[dict]):
    """
    Load multiple LoRA weights into the pipeline with weighted blending.

    Args:
        loras: List of dicts with 'path' and 'scale' keys
               Example: [{'path': 'style.safetensors', 'scale': 0.8}, ...]

    Returns:
        List of dicts with loaded LoRA info
    """
    global pipeline, current_loras

    if pipeline is None:
        raise RuntimeError('Pipeline must be loaded before adding LoRAs')

    # Handle empty/None loras
    if not loras:
        # Unload any existing LoRAs
        if current_loras and hasattr(pipeline, 'unload_lora_weights'):
            try:
                pipeline.unload_lora_weights()
                print('[Flux Service] LoRA: Unloaded existing LoRAs')
            except Exception as e:
                print(f'[Flux Service] LoRA: Warning during unload: {e}')
        current_loras = []
        return []

    # Limit to MAX_LORAS
    if len(loras) > MAX_LORAS:
        print(f'[Flux Service] LoRA: Limiting to {MAX_LORAS} LoRAs (requested {len(loras)})')
        loras = loras[:MAX_LORAS]

    loaded_loras = []
    adapter_names = []
    adapter_weights = []

    for i, lora_config in enumerate(loras):
        lora_path = lora_config.get('path', '')
        lora_scale = lora_config.get('scale', 1.0)

        # Resolve path - check LORAS_DIR for relative paths
        lora_file = Path(lora_path)
        if not lora_file.is_absolute():
            # Try LORAS_DIR first
            lora_file = Path(LORAS_DIR) / lora_path
            if not lora_file.exists():
                # Try services/loras as fallback
                lora_file = Path('services/loras') / lora_path

        lora_file = lora_file.resolve()

        # Validate file exists
        if not lora_file.exists():
            print(f'[Flux Service] LoRA: File not found: {lora_path} (checked {lora_file})')
            loaded_loras.append({
                'path': str(lora_path),
                'scale': lora_scale,
                'adapter_name': None,
                'loaded': False,
                'error': f'File not found: {lora_file}'
            })
            continue

        # Validate .safetensors format
        if not str(lora_file).endswith('.safetensors'):
            print(f'[Flux Service] LoRA: Invalid format (must be .safetensors): {lora_path}')
            loaded_loras.append({
                'path': str(lora_path),
                'scale': lora_scale,
                'adapter_name': None,
                'loaded': False,
                'error': 'Must be .safetensors format'
            })
            continue

        # Generate unique adapter name
        adapter_name = f'lora_{i}_{lora_file.stem}'

        try:
            print(f'[Flux Service] LoRA: Loading {lora_file} as "{adapter_name}" with scale {lora_scale}')
            pipeline.load_lora_weights(str(lora_file), adapter_name=adapter_name)

            adapter_names.append(adapter_name)
            adapter_weights.append(lora_scale)
            loaded_loras.append({
                'path': str(lora_path),
                'scale': lora_scale,
                'adapter_name': adapter_name,
                'loaded': True
            })
            print(f'[Flux Service] LoRA: Successfully loaded {adapter_name}')

        except Exception as e:
            print(f'[Flux Service] LoRA: Error loading {lora_path}: {e}')
            loaded_loras.append({
                'path': str(lora_path),
                'scale': lora_scale,
                'adapter_name': adapter_name,
                'loaded': False,
                'error': str(e)
            })
            # Continue loading other LoRAs even if one fails

    # Set adapters with weights for blending
    if adapter_names and hasattr(pipeline, 'set_adapters'):
        try:
            pipeline.set_adapters(adapter_names, adapter_weights=adapter_weights)
            print(f'[Flux Service] LoRA: Set {len(adapter_names)} adapters with weights {adapter_weights}')
        except Exception as e:
            print(f'[Flux Service] LoRA: Error setting adapters: {e}')

    current_loras = loaded_loras
    return loaded_loras


@app.get('/loras')
async def list_loras():
    """List available LoRA files in LORAS_DIR"""
    loras = []

    # Ensure LORAS_DIR exists
    loras_path = Path(LORAS_DIR)
    if loras_path.exists():
        for lora_file in loras_path.glob('*.safetensors'):
            try:
                loras.append({
                    'name': lora_file.stem,
                    'path': lora_file.name,
                    'full_path': str(lora_file.resolve()),
                    'size_mb': lora_file.stat().st_size / (1024 * 1024),
                })
            except Exception as e:
                print(f'[Flux Service] Error reading LoRA file {lora_file}: {e}')

    return {
        'loras': loras,
        'loras_dir': str(LORAS_DIR),
        'current_loras': current_loras
    }


@app.get('/health')
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'model': FLUX_MODEL_PATH if MODEL_SOURCE == 'local' else MODEL_NAME,
        'model_source': MODEL_SOURCE,  # 'local' or 'huggingface'
        'model_path': FLUX_MODEL_PATH if MODEL_SOURCE == 'local' else None,
        'device': DEVICE,
        'model_loaded': pipeline is not None,
        'hf_authenticated': HF_TOKEN is not None,
        'lora': {
            'loaded': current_lora['loaded'],
            'path': current_lora['path'],
            'scale': current_lora['scale'],
            'configured': FLUX_LORA_PATH is not None
        },
        'scheduler': {
            'supported': list(SUPPORTED_SCHEDULERS.keys()),
            'default': DEFAULT_SCHEDULER
        }
    }


@app.post('/load')
async def load_model_endpoint():
    """Explicitly load the model (for GPU coordination)"""
    try:
        load_pipeline()
        return {
            'status': 'loaded',
            'model': MODEL_NAME,
            'device': DEVICE
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/unload')
async def unload_model_endpoint():
    """Explicitly unload the model to free GPU memory"""
    if unload_pipeline():
        return {'status': 'unloaded', 'message': 'Model unloaded, GPU memory freed'}
    else:
        return {'status': 'not_loaded', 'message': 'Model was not loaded'}


@app.get('/lora/status')
async def lora_status():
    """Get current LoRA status"""
    return {
        'loaded': current_lora['loaded'],
        'path': current_lora['path'],
        'scale': current_lora['scale'],
        'configured_path': FLUX_LORA_PATH,
        'default_scale': LORA_DEFAULT_SCALE
    }


@app.post('/lora/load')
async def load_lora_endpoint(lora_path: str, lora_scale: float = 1.0):
    """Load a LoRA file into the pipeline"""
    try:
        # Ensure pipeline is loaded first
        if pipeline is None:
            load_pipeline()

        result = load_lora_weights(lora_path, lora_scale)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/lora/unload')
async def unload_lora_endpoint():
    """Unload/remove current LoRA"""
    return unload_lora()


# T5 token limit for Flux models (CLIP 77 token warning is harmless)
# Dev-fp8: 512 tokens (schnell was 256)
MAX_SEQUENCE_LENGTH = 512  # For dev-fp8 model


def truncate_prompt_for_t5(prompt: str, max_tokens: int = 512) -> str:
    """
    Truncate prompt to fit T5's token limit (512 for dev-fp8).
    CLIP's 77 token warning is harmless - T5 is the main encoder for Flux.
    Uses actual T5 tokenization for accurate truncation.
    """
    try:
        from transformers import T5Tokenizer
        tokenizer = T5Tokenizer.from_pretrained('google-t5/t5-base')
        tokens = tokenizer.tokenize(prompt)

        if len(tokens) <= max_tokens:
            return prompt

        # Truncate to max_tokens and decode back to text
        truncated_tokens = tokens[:max_tokens]
        truncated = tokenizer.decode(tokenizer.convert_tokens_to_ids(truncated_tokens), skip_special_tokens=True)
        print(f'[Flux Service] Truncated prompt from {len(tokens)} to {max_tokens} tokens for T5')
        return truncated
    except Exception as e:
        # Fallback to word-based approximation if tokenizer fails
        print(f'[Flux Service] Warning: T5 tokenizer failed ({e}), using word approximation')
        max_words = int(max_tokens / 1.3)
        words = prompt.split()
        if len(words) <= max_words:
            return prompt
        truncated = ' '.join(words[:max_words])
        print(f'[Flux Service] Truncated prompt from {len(words)} to {max_words} words (approximation)')
        return truncated


@app.post('/generate', response_model=GenerationResponse)
async def generate_image(request: GenerationRequest):
    """Generate an image"""
    try:
        # Load pipeline if not loaded
        pipe = load_pipeline()

        # Truncate for T5 encoder (512 tokens for dev-fp8, CLIP warning is harmless)
        prompt = truncate_prompt_for_t5(request.prompt, MAX_SEQUENCE_LENGTH)

        # Set seed for reproducibility
        generator = None
        if request.seed is not None:
            generator = torch.Generator(device=DEVICE).manual_seed(request.seed)

        # Handle request LoRAs (multiple LoRA support)
        lora_info = None
        if request.loras:
            print(f'[Flux Service] Loading {len(request.loras)} LoRAs from request')
            lora_info = load_multiple_loras(request.loras)

        # Handle per-request LoRA scale override (legacy single LoRA support)
        original_scale = None
        if request.lora_scale is not None and current_lora['loaded'] and not request.loras:
            # Temporarily adjust LoRA scale for this generation
            original_scale = current_lora['scale']
            if original_scale != request.lora_scale:
                print(f'[Flux Service] Temporarily adjusting LoRA scale: {original_scale} -> {request.lora_scale}')
                try:
                    if hasattr(pipe, 'set_adapters'):
                        pipe.set_adapters(['default'], adapter_weights=[request.lora_scale])
                    current_lora['scale'] = request.lora_scale
                except Exception as e:
                    print(f'[Flux Service] Warning: Failed to adjust LoRA scale: {e}')

        # Handle scheduler override (for fine-tunes that recommend specific samplers)
        scheduler_to_use = request.scheduler or DEFAULT_SCHEDULER
        original_scheduler = None
        if scheduler_to_use and scheduler_to_use in SUPPORTED_SCHEDULERS:
            original_scheduler = pipe.scheduler
            scheduler_class = SUPPORTED_SCHEDULERS[scheduler_to_use]
            pipe.scheduler = scheduler_class.from_config(pipe.scheduler.config)
            print(f'[Flux Service] Using scheduler: {scheduler_to_use} ({scheduler_class.__name__})')

        # Generate image
        print(f'[Flux Service] Generating: {prompt[:50]}...')

        result = pipe(
            prompt=prompt,
            height=request.height,
            width=request.width,
            num_inference_steps=request.steps,
            guidance_scale=request.guidance,
            generator=generator,
            max_sequence_length=MAX_SEQUENCE_LENGTH,  # Enable T5 long prompts (512 for dev-fp8)
        )

        # Restore original LoRA scale if it was temporarily changed
        if original_scale is not None and original_scale != current_lora['scale']:
            print(f'[Flux Service] Restoring LoRA scale to: {original_scale}')
            try:
                if hasattr(pipe, 'set_adapters'):
                    pipe.set_adapters(['default'], adapter_weights=[original_scale])
                current_lora['scale'] = original_scale
            except Exception as e:
                print(f'[Flux Service] Warning: Failed to restore LoRA scale: {e}')

        # Restore original scheduler if it was temporarily changed
        if original_scheduler is not None:
            pipe.scheduler = original_scheduler

        # Capture base image before face fixing if requested
        base_image_b64 = None
        if request.return_intermediate_images and request.fix_faces:
            import io
            import base64
            buf = io.BytesIO()
            result.images[0].save(buf, format='PNG')
            base_image_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
            print(f'[Flux Service] Captured base image ({len(base_image_b64)} chars base64)')

        # Apply face fixing if requested
        face_fix_info = None
        if request.fix_faces:
            try:
                print(f'[Flux Service] Applying face fixing (restoration_strength={request.restoration_strength}, upscale={request.face_upscale or 1})')
                import time as time_module
                face_fix_start = time_module.time()

                # Load face fixer
                fixer = load_face_fixer()
                if fixer:
                    fixed_image, face_fix_info = fixer.fix_faces(
                        result.images[0],
                        restoration_strength=request.restoration_strength,
                        upscale=request.face_upscale or 1,
                    )
                    result.images[0] = fixed_image
                    face_fix_time = time_module.time() - face_fix_start
                    if face_fix_info:
                        face_fix_info['time'] = face_fix_time
                    print(f'[Flux Service] Face fixing completed in {face_fix_time:.1f}s')
                else:
                    face_fix_info = {
                        'applied': False,
                        'error': 'Face fixing module not available'
                    }
            except Exception as e:
                print(f'[Flux Service] Face fixing failed: {e}')
                face_fix_info = {
                    'applied': False,
                    'error': str(e)
                }

        # Save image to temporary location
        output_dir = Path('output/temp')
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate filename
        import time
        timestamp = int(time.time() * 1000)
        filename = f'flux_{timestamp}.png'
        output_path = output_dir / filename

        result.images[0].save(output_path)

        print(f'[Flux Service] Saved to: {output_path}')

        return GenerationResponse(
            localPath=str(output_path),
            metadata={
                'model': request.model,
                'prompt': request.prompt,
                'height': request.height,
                'width': request.width,
                'steps': request.steps,
                'guidance': request.guidance,
                'seed': request.seed,
                'scheduler': scheduler_to_use,
                'loras': lora_info if lora_info else current_loras if current_loras else None,
                'face_fixing': face_fix_info,
            },
            base_image=base_image_b64
        )

    except Exception as e:
        print(f'[Flux Service] Generation error: {e}')
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/download/status')
async def download_status():
    """Check if model is already downloaded/cached"""
    try:
        from huggingface_hub import try_to_load_from_cache, scan_cache_dir
        import os

        # Check if model files are in HF cache
        cache_dir = os.path.expanduser('~/.cache/huggingface/hub')

        # For diffusion models, check for the model index file
        model_index = try_to_load_from_cache(MODEL_NAME, 'model_index.json')

        if model_index and os.path.exists(str(model_index)):
            # Model is cached, estimate size
            model_cache_name = MODEL_NAME.replace('/', '--')
            model_path = os.path.join(cache_dir, f'models--{model_cache_name}')

            total_size = 0
            if os.path.exists(model_path):
                for dirpath, dirnames, filenames in os.walk(model_path):
                    for f in filenames:
                        fp = os.path.join(dirpath, f)
                        total_size += os.path.getsize(fp)

            size_gb = total_size / (1024**3)

            return {
                'status': 'cached',
                'model': MODEL_NAME,
                'size_gb': round(size_gb, 2),
                'message': f'Model is cached ({size_gb:.1f} GB)'
            }
        else:
            return {
                'status': 'not_downloaded',
                'model': MODEL_NAME,
                'estimated_size_gb': 12,
                'message': 'Model needs to be downloaded (~12 GB, may take 10-30 minutes)'
            }
    except Exception as e:
        return {
            'status': 'unknown',
            'message': f'Could not determine status: {str(e)}'
        }


@app.post('/download')
async def download_model():
    """
    Download the Flux model with progress streaming.
    Returns SSE stream with status updates.
    """
    import json
    import asyncio
    import threading
    from fastapi.responses import StreamingResponse

    async def generate_progress():
        try:
            yield f"data: {json.dumps({'status': 'started', 'message': f'Starting download of {MODEL_NAME}... This may take 10-30 minutes for ~12GB.'})}\n\n"

            # Check if already cached
            from huggingface_hub import try_to_load_from_cache
            model_index = try_to_load_from_cache(MODEL_NAME, 'model_index.json')

            if model_index:
                yield f"data: {json.dumps({'status': 'complete', 'progress': 100, 'message': 'Model already cached!'})}\n\n"
                return

            yield f"data: {json.dumps({'status': 'downloading', 'message': 'Downloading model components... (transformer, VAE, text encoder)'})}\n\n"

            # Download in background thread
            download_complete = threading.Event()
            download_error = [None]

            def download_thread():
                try:
                    # This downloads all model components
                    FluxPipeline.download(
                        MODEL_NAME,
                        token=HF_TOKEN
                    )
                except Exception as e:
                    download_error[0] = str(e)
                finally:
                    download_complete.set()

            thread = threading.Thread(target=download_thread)
            thread.start()

            # Poll for completion with status updates
            dots = 0
            elapsed = 0
            while not download_complete.is_set():
                await asyncio.sleep(5)
                elapsed += 5
                dots = (dots + 1) % 4
                dot_str = '.' * (dots + 1)
                minutes = elapsed // 60
                msg = f'Downloading{dot_str} ({minutes}m elapsed, ~12GB total)'
                yield f"data: {json.dumps({'status': 'downloading', 'elapsed': elapsed, 'message': msg})}\n\n"

            thread.join()

            if download_error[0]:
                yield f"data: {json.dumps({'status': 'error', 'message': f'Download failed: {download_error[0]}'})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'complete', 'progress': 100, 'message': 'Model downloaded successfully! Ready to generate images.'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': f'Error: {str(e)}'})}\n\n"

    return StreamingResponse(
        generate_progress(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    )


if __name__ == '__main__':
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=PORT,
        log_level='info'
    )
