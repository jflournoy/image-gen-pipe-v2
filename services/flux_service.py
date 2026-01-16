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
from diffusers import FluxPipeline
from huggingface_hub import login

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

# Authenticate with Hugging Face if token is available
if HF_TOKEN:
    print('[Flux Service] Authenticating with Hugging Face...')
    login(token=HF_TOKEN)
else:
    print('[Flux Service] ⚠️ HF_TOKEN not set - gated models will fail to load')


@asynccontextmanager
async def lifespan(app):
    """Lifespan event handler for startup/shutdown"""
    print(f'[Flux Service] Starting on port {PORT}')
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

# Global LoRA state
current_lora = {
    'path': None,
    'scale': LORA_DEFAULT_SCALE,
    'loaded': False
}


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


class GenerationResponse(BaseModel):
    """Image generation response"""
    localPath: str
    metadata: dict


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
                # If missing components (e.g., text_encoder, text_encoder_2, vae), load them from HuggingFace
                error_str = str(e).lower()
                if any(x in error_str for x in ['missing', 'cliptextmodel', 't5encoder', 'autoencoder']):
                    print(f'[Flux Service] Custom model missing components, loading from HuggingFace: {e}')
                    from transformers import CLIPTextModel, T5EncoderModel
                    from diffusers import AutoencoderKL

                    # Load all potentially missing components
                    print('[Flux Service] Loading text_encoder (CLIP) from HuggingFace...')
                    text_encoder = CLIPTextModel.from_pretrained(
                        'openai/clip-vit-large-patch14',
                        torch_dtype=kwargs['torch_dtype']
                    )

                    print('[Flux Service] Loading text_encoder_2 (T5) from HuggingFace...')
                    text_encoder_2 = T5EncoderModel.from_pretrained(
                        'google-t5/t5-base',
                        torch_dtype=kwargs['torch_dtype']
                    )

                    print('[Flux Service] Loading vae (AutoencoderKL) from HuggingFace...')
                    vae = AutoencoderKL.from_pretrained(
                        'black-forest-labs/FLUX.1-dev',
                        subfolder='vae',
                        torch_dtype=kwargs['torch_dtype']
                    )

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
            pipeline.enable_sequential_cpu_offload()

            # Additional memory optimizations for inference
            pipeline.enable_attention_slicing(1)  # Maximum slicing
            # Use new VAE methods to avoid deprecation warnings
            if hasattr(pipeline.vae, 'enable_slicing'):
                pipeline.vae.enable_slicing()
            if hasattr(pipeline.vae, 'enable_tiling'):
                pipeline.vae.enable_tiling()

        print('[Flux Service] Model loaded with sequential CPU offload')

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

        # Handle per-request LoRA scale override
        original_scale = None
        if request.lora_scale is not None and current_lora['loaded']:
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
            }
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
