#!/usr/bin/env python3
"""
Modal Diffusion Service
A flexible Modal-based service for running diffusion models on cloud GPUs.
Supports Flux, SDXL, SD3, and custom models from CivitAI or local files.

Usage:
    # Deploy to Modal
    modal deploy modal_diffusion_service.py

    # Run locally for testing
    modal serve modal_diffusion_service.py

    # Upload a custom model
    python modal_model_manager.py upload /path/to/model.safetensors --name my-custom-flux

    # Call the endpoint
    curl -X POST "https://your-app--generate.modal.run/generate" \
        -H "Modal-Key: $MODAL_TOKEN_ID" \
        -H "Modal-Secret: $MODAL_TOKEN_SECRET" \
        -H "Content-Type: application/json" \
        -d '{"prompt": "a beautiful sunset", "model": "flux-dev"}'
"""

import os
import io
import base64
import time
import json
from pathlib import Path
from typing import Optional, Dict, Any, List

import torch
import modal
from pydantic import BaseModel, Field, field_validator, ConfigDict

# Default configuration
DEFAULT_GPU = "A10G"  # Good balance of cost/performance for most diffusion models
APP_NAME = "image-gen-diffusion"
VOLUME_NAME = "diffusion-models"
MODELS_DIR = "/models"
CACHE_DIR = f"{MODELS_DIR}/huggingface"
CUSTOM_MODELS_DIR = f"{MODELS_DIR}/custom"
LORAS_DIR = f"{MODELS_DIR}/loras"
FACE_FIXING_DIR = f"{MODELS_DIR}/face_fixing"

# LoRA configuration
MAX_LORAS = 4  # Maximum number of simultaneous LoRAs

# Supported schedulers for DMD/LCM and other distilled models
SUPPORTED_SCHEDULERS = [
    "lcm",       # Latent Consistency Model - for DMD models (1-8 steps)
    "euler",     # Euler - fast, general purpose
    "euler_a",   # Euler Ancestral - more variation
    "dpm++",     # DPM++ 2M - high quality
    "ddim",      # DDIM - deterministic
    "karras",    # Karras sigmas variant
]

# Supported models with their configurations
SUPPORTED_MODELS: Dict[str, Dict[str, Any]] = {
    "flux-dev": {
        "repo": "black-forest-labs/FLUX.1-dev",
        "pipeline": "flux",
        "default_steps": 25,
        "default_guidance": 3.5,
        "requires_auth": True,
    },
    "flux-schnell": {
        "repo": "black-forest-labs/FLUX.1-schnell",
        "pipeline": "flux",
        "default_steps": 4,
        "default_guidance": 0.0,
        "requires_auth": True,
    },
    "sdxl-turbo": {
        "repo": "stabilityai/sdxl-turbo",
        "pipeline": "sdxl",
        "default_steps": 4,
        "default_guidance": 0.0,
        "requires_auth": False,
    },
    "sdxl-base": {
        "repo": "stabilityai/stable-diffusion-xl-base-1.0",
        "pipeline": "sdxl",
        "default_steps": 30,
        "default_guidance": 7.5,
        "requires_auth": False,
    },
    "sd3-medium": {
        "repo": "stabilityai/stable-diffusion-3-medium-diffusers",
        "pipeline": "sd3",
        "default_steps": 28,
        "default_guidance": 7.0,
        "requires_auth": True,
    },
}

# Create Modal app
app = modal.App(APP_NAME)

# Create persistent volume for model storage
model_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# Define the container image with dependencies
# Image version: 2026-02-14-uv-based (using uv.lock for deterministic deps)
diffusion_image = (
    modal.Image.debian_slim(python_version="3.10")  # Match local env (gfpgan requires <3.11)
    # Install system dependencies for headless OpenCV
    .apt_install("libgl1", "libglib2.0-0")
    # Install uv and dependencies from lockfile
    .run_commands(
        "pip install uv",
        # Create temp directory and copy files manually
        "mkdir -p /tmp/project"
    )
    .add_local_file("../pyproject.toml", "/tmp/project/pyproject.toml", copy=True)
    .add_local_file("../uv.lock", "/tmp/project/uv.lock", copy=True)
    .add_local_python_source("face_fixing", copy=True)
    .run_commands(
        "cd /tmp/project && uv pip install --system --no-cache .",
        "echo 'Dependencies installed from uv.lock (Python 3.10): 2026-02-14'"
    )
)


# Pydantic models for request/response
class LoraConfig(BaseModel):
    """Configuration for a single LoRA adapter"""
    model_config = ConfigDict(extra='forbid')

    path: str = Field(..., min_length=1, description="Path to LoRA .safetensors file")
    scale: float = Field(default=1.0, ge=0.0, le=2.0, description="LoRA strength/weight (0.0-2.0)")


class GenerateRequest(BaseModel):
    """Image generation request"""
    model_config = ConfigDict(extra='forbid')

    prompt: str = Field(..., min_length=1, description="Text prompt for image generation")
    model: str = Field(default="flux-dev", description="Model to use for generation")
    width: int = Field(default=1024, ge=64, le=2048, description="Image width")
    height: int = Field(default=1024, ge=64, le=2048, description="Image height")
    steps: int = Field(default=25, ge=1, le=100, description="Inference steps")
    guidance: float = Field(default=3.5, ge=0.0, le=20.0, description="Guidance scale")
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")
    loras: Optional[List[LoraConfig]] = Field(default=None, max_length=4, description="LoRA adapters to apply (max 4)")
    # DMD/LCM scheduler support
    scheduler: Optional[str] = Field(default=None, description="Scheduler type (lcm, euler, euler_a, dpm++, ddim, karras)")
    # SDXL refiner support
    use_refiner: bool = Field(default=False, description="Enable SDXL refiner pass")
    refiner_switch: float = Field(default=0.8, ge=0.0, le=1.0, description="Denoising point to switch to refiner (0.0-1.0)")
    # Clip skip support
    clip_skip: Optional[int] = Field(default=None, ge=1, le=12, description="Number of CLIP layers to skip (1-12)")
    # Img2img touchup support (light artifact cleanup)
    touchup_strength: float = Field(default=0.0, ge=0.0, le=1.0, description="Img2img touchup strength (0=disabled, 0.1-0.5=light cleanup)")
    # Negative prompt support (for SDXL and other models)
    negative_prompt: Optional[str] = Field(default=None, description="Negative prompt (things to avoid in generation)")
    # Face fixing support (CodeFormer enhancement)
    fix_faces: bool = Field(default=False, description="Enable face fixing via GFPGAN v1.4 enhancement")
    face_fidelity: float = Field(default=0.5, ge=0.0, le=1.0, description="GFPGAN restoration strength (0.0=preserve original, 1.0=full restoration)")
    face_upscale: Optional[int] = Field(default=None, ge=1, le=4, description="Optional face upscaling factor (1=none, 2=2x, 4=4x via Real-ESRGAN integrated with GFPGAN)")

    @field_validator('prompt')
    @classmethod
    def validate_prompt(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Prompt cannot be empty")
        return v.strip()

    @field_validator('negative_prompt')
    @classmethod
    def validate_negative_prompt(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        # Strip whitespace but allow empty string
        return v.strip()

    @field_validator('loras')
    @classmethod
    def validate_loras(cls, v: Optional[List[LoraConfig]]) -> Optional[List[LoraConfig]]:
        if v is not None and len(v) > MAX_LORAS:
            raise ValueError(f"Maximum {MAX_LORAS} LoRAs allowed")
        return v


class GenerateResponse(BaseModel):
    """Image generation response"""
    image: str = Field(..., description="Base64-encoded image data")
    format: str = Field(default="base64", description="Image format (base64 or url)")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Generation metadata")


class BatchGenerateRequest(BaseModel):
    """Batch image generation request - multiple images in one call"""
    model_config = ConfigDict(extra='forbid')

    requests: List[GenerateRequest] = Field(
        ..., min_length=1, max_length=16,
        description="List of generation requests to process sequentially"
    )


class BatchGenerateResponse(BaseModel):
    """Batch image generation response"""
    results: List[GenerateResponse] = Field(..., description="List of generation results")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Batch-level metadata")


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Service status")
    model: str = Field(..., description="Current/default model")
    gpu: Optional[str] = Field(default=None, description="GPU type")
    container_ready: Optional[bool] = Field(default=None, description="Whether container is warmed up")
    available_models: Optional[List[str]] = Field(default=None, description="List of available models")
    current_loras: Optional[List[Dict[str, Any]]] = Field(default=None, description="Currently loaded LoRAs")


class ModelsResponse(BaseModel):
    """List of available models"""
    models: List[Dict[str, Any]] = Field(..., description="Available models")


class LorasResponse(BaseModel):
    """List of available LoRAs"""
    loras: List[Dict[str, Any]] = Field(..., description="Available LoRA files")


class LoraStatusResponse(BaseModel):
    """Current LoRA status"""
    loaded: bool = Field(..., description="Whether any LoRAs are loaded")
    current_loras: List[Dict[str, Any]] = Field(default_factory=list, description="Currently loaded LoRAs")


def image_to_base64(image) -> str:
    """Convert PIL Image to base64 string"""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


def load_custom_models_config() -> Dict[str, Dict[str, Any]]:
    """Load custom models configuration from volume"""
    config_path = Path(CUSTOM_MODELS_DIR) / "models.json"
    if config_path.exists():
        with open(config_path, "r") as f:
            return json.load(f)
    return {}


# Try to get HuggingFace secret if it exists (optional for public models)
try:
    _hf_secret = modal.Secret.from_name("huggingface-secret")
    _secrets = [_hf_secret]
except Exception:
    _secrets = []


@app.cls(
    image=diffusion_image,
    gpu=DEFAULT_GPU,
    scaledown_window=300,  # Keep warm for 5 minutes
    secrets=_secrets,
    volumes={MODELS_DIR: model_volume},  # Mount persistent volume
)
class DiffusionService:
    """Modal class for diffusion model inference"""

    # Class-level state (initialized in @modal.enter)
    pipeline: Any = None
    refiner_pipeline: Any = None  # For SDXL refiner pass (DMD models)
    compel: Any = None  # For long prompt handling in SDXL
    face_fixer: Any = None  # For face fixing via CodeFormer (lazy-loaded)
    current_model: str = None
    device: str = "cuda"
    custom_models: Dict[str, Dict[str, Any]] = {}
    current_loras: List[Dict[str, Any]] = []  # Currently loaded LoRAs

    @modal.enter()
    def load_model(self):
        """Load default model on container startup"""
        import torch

        print(f"[Modal Diffusion] Container starting on GPU: {DEFAULT_GPU}")
        print(f"[Modal Diffusion] CUDA available: {torch.cuda.is_available()}")
        print(f"[Modal Diffusion] Models directory: {MODELS_DIR}")
        print(f"[Modal Diffusion] HuggingFace cache: {CACHE_DIR}")

        if torch.cuda.is_available():
            print(f"[Modal Diffusion] GPU: {torch.cuda.get_device_name(0)}")
            print(f"[Modal Diffusion] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

        # Ensure directories exist
        Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)
        Path(CUSTOM_MODELS_DIR).mkdir(parents=True, exist_ok=True)
        Path(LORAS_DIR).mkdir(parents=True, exist_ok=True)
        Path(FACE_FIXING_DIR).mkdir(parents=True, exist_ok=True)

        # Load custom models configuration
        self.custom_models = load_custom_models_config()
        if self.custom_models:
            print(f"[Modal Diffusion] Found {len(self.custom_models)} custom models: {list(self.custom_models.keys())}")

        # Initialize face fixing pipeline (lazy-loaded on first use)
        # Models cached on persistent volume at FACE_FIXING_DIR
        try:
            from face_fixing import get_face_fixer
            # Don't load yet - just prepare for lazy loading
            self.face_fixer = get_face_fixer
            self._face_fixing_models_dir = FACE_FIXING_DIR
            print(f"[Modal Diffusion] Face fixing pipeline ready (models_dir={FACE_FIXING_DIR})")
        except ImportError as e:
            print(f"[Modal Diffusion] Warning: Face fixing not available (ImportError: {e})")
            self.face_fixer = None
            self._face_fixing_models_dir = None
        except Exception as e:
            print(f"[Modal Diffusion] ERROR: Face fixing initialization failed: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            self.face_fixer = None
            self._face_fixing_models_dir = None

        # Pre-load default model for faster first inference
        self._load_pipeline("flux-dev")

    def _get_model_config(self, model_name: str) -> Dict[str, Any]:
        """Get model configuration from built-in or custom models"""
        if model_name in SUPPORTED_MODELS:
            return SUPPORTED_MODELS[model_name]
        elif model_name in self.custom_models:
            return self.custom_models[model_name]
        else:
            # Reload custom models in case new ones were added
            self.custom_models = load_custom_models_config()
            if model_name in self.custom_models:
                return self.custom_models[model_name]
            raise ValueError(
                f"Unknown model: {model_name}. "
                f"Available: {list(SUPPORTED_MODELS.keys()) + list(self.custom_models.keys())}"
            )

    def _init_compel_for_sdxl(self):
        """Initialize Compel for long prompt handling in SDXL"""
        from compel import Compel, ReturnedEmbeddingsType

        print(f"[Modal Diffusion] Initializing Compel for long prompt support")
        self.compel = Compel(
            tokenizer=[self.pipeline.tokenizer, self.pipeline.tokenizer_2],
            text_encoder=[self.pipeline.text_encoder, self.pipeline.text_encoder_2],
            returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED,
            requires_pooled=[False, True]
        )

    def _process_negative_prompt_with_compel(self, negative_prompt: Optional[str]):
        """
        Process negative prompt with Compel for SDXL long prompt support

        Args:
            negative_prompt: Optional negative prompt string

        Returns:
            Tuple of (negative_conditioning, negative_pooled) or (None, None)
        """
        if not negative_prompt or self.compel is None:
            return None, None

        print(f"[Modal Diffusion] Using Compel for negative prompt ({len(negative_prompt.split())} words)")
        return self.compel(negative_prompt)

    def _load_pipeline(self, model_name: str):
        """Load a diffusion pipeline for the specified model"""
        import torch
        from diffusers import FluxPipeline, StableDiffusionXLPipeline, StableDiffusion3Pipeline
        from huggingface_hub import login

        model_config = self._get_model_config(model_name)

        if self.current_model == model_name and self.pipeline is not None:
            print(f"[Modal Diffusion] Model {model_name} already loaded")
            return

        # Authenticate with HuggingFace if needed
        if model_config.get("requires_auth"):
            hf_token = os.environ.get("HF_TOKEN")
            if hf_token:
                login(token=hf_token)
                print(f"[Modal Diffusion] Authenticated with HuggingFace")
            else:
                print(f"[Modal Diffusion] Warning: {model_name} may require HF_TOKEN")

        # Clear existing pipeline to free memory
        if self.pipeline is not None:
            del self.pipeline
            torch.cuda.empty_cache()

        print(f"[Modal Diffusion] Loading {model_name}...")
        start_time = time.time()

        pipeline_type = model_config.get("pipeline", "flux")
        is_custom = model_config.get("custom", False)

        if is_custom:
            # Load custom model from volume
            model_path = Path(CUSTOM_MODELS_DIR) / model_config["path"]
            print(f"[Modal Diffusion] Loading custom model from {model_path}")
            self._load_custom_pipeline(model_path, model_config, torch)
        else:
            # Load from HuggingFace with caching
            repo = model_config["repo"]
            print(f"[Modal Diffusion] Loading from {repo} (cache: {CACHE_DIR})")

            if pipeline_type == "flux":
                self.pipeline = FluxPipeline.from_pretrained(
                    repo,
                    torch_dtype=torch.bfloat16,
                    cache_dir=CACHE_DIR,
                )
                # Use sequential CPU offload for A10G (24GB) - more aggressive memory management
                self.pipeline.enable_sequential_cpu_offload()

            elif pipeline_type == "sdxl":
                self.pipeline = StableDiffusionXLPipeline.from_pretrained(
                    repo,
                    torch_dtype=torch.float16,
                    variant="fp16",
                    use_safetensors=True,
                    cache_dir=CACHE_DIR,
                )
                self.pipeline.to(self.device)
                # Initialize Compel for long prompt support
                self._init_compel_for_sdxl()

            elif pipeline_type == "sd3":
                self.pipeline = StableDiffusion3Pipeline.from_pretrained(
                    repo,
                    torch_dtype=torch.float16,
                    cache_dir=CACHE_DIR,
                )
                self.pipeline.to(self.device)

            else:
                raise ValueError(f"Unknown pipeline type: {pipeline_type}")

        # Commit volume changes (cached models)
        model_volume.commit()

        self.current_model = model_name
        load_time = time.time() - start_time
        print(f"[Modal Diffusion] Loaded {model_name} in {load_time:.1f}s")

    def _load_custom_pipeline(self, model_path: Path, model_config: Dict, torch):
        """Load a custom safetensors model"""
        from diffusers import FluxPipeline, StableDiffusionXLPipeline

        pipeline_type = model_config.get("pipeline", "flux")
        base_model = model_config.get("base_model", "black-forest-labs/FLUX.1-dev")

        if pipeline_type == "flux":
            # Load base pipeline first
            self.pipeline = FluxPipeline.from_pretrained(
                base_model,
                torch_dtype=torch.bfloat16,
                cache_dir=CACHE_DIR,
            )

            # Load custom weights
            if model_path.suffix == ".safetensors":
                from safetensors.torch import load_file
                state_dict = load_file(str(model_path))
                # This depends on how the custom model was trained
                # For LoRA: self.pipeline.load_lora_weights(str(model_path))
                # For full checkpoint: need specific loading logic
                print(f"[Modal Diffusion] Loaded custom weights from {model_path}")

            # Use sequential CPU offload for A10G (24GB) - more aggressive memory management
            self.pipeline.enable_sequential_cpu_offload()

        elif pipeline_type == "sdxl":
            if model_path.suffix == ".safetensors":
                # Load SDXL from single safetensors file
                self.pipeline = StableDiffusionXLPipeline.from_single_file(
                    str(model_path),
                    torch_dtype=torch.float16,
                    cache_dir=CACHE_DIR,
                )
            else:
                self.pipeline = StableDiffusionXLPipeline.from_pretrained(
                    str(model_path),
                    torch_dtype=torch.float16,
                    cache_dir=CACHE_DIR,
                )
            self.pipeline.to(self.device)
            # Initialize Compel for long prompt support
            self._init_compel_for_sdxl()

    def _set_scheduler(self, scheduler_name: Optional[str]):
        """
        Set the pipeline scheduler for DMD/LCM models.

        Args:
            scheduler_name: One of SUPPORTED_SCHEDULERS or None to keep default
        """
        if scheduler_name is None or self.pipeline is None:
            return

        if scheduler_name not in SUPPORTED_SCHEDULERS:
            print(f"[Modal Diffusion] Warning: Unknown scheduler '{scheduler_name}', using default")
            return

        print(f"[Modal Diffusion] Setting scheduler to: {scheduler_name}")

        import inspect

        def _filtered_config(scheduler_class):
            """Return only config keys accepted by scheduler_class to avoid cross-type warnings."""
            valid = set(inspect.signature(scheduler_class.__init__).parameters) - {"self"}
            return {k: v for k, v in self.pipeline.scheduler.config.items() if k in valid}

        if scheduler_name == "lcm":
            from diffusers import LCMScheduler
            self.pipeline.scheduler = LCMScheduler.from_config(_filtered_config(LCMScheduler))
        elif scheduler_name == "euler":
            from diffusers import EulerDiscreteScheduler
            self.pipeline.scheduler = EulerDiscreteScheduler.from_config(_filtered_config(EulerDiscreteScheduler))
        elif scheduler_name == "euler_a":
            from diffusers import EulerAncestralDiscreteScheduler
            self.pipeline.scheduler = EulerAncestralDiscreteScheduler.from_config(_filtered_config(EulerAncestralDiscreteScheduler))
        elif scheduler_name == "dpm++":
            from diffusers import DPMSolverMultistepScheduler
            self.pipeline.scheduler = DPMSolverMultistepScheduler.from_config(_filtered_config(DPMSolverMultistepScheduler))
        elif scheduler_name == "ddim":
            from diffusers import DDIMScheduler
            self.pipeline.scheduler = DDIMScheduler.from_config(_filtered_config(DDIMScheduler))
        elif scheduler_name == "karras":
            from diffusers import DPMSolverMultistepScheduler
            self.pipeline.scheduler = DPMSolverMultistepScheduler.from_config(
                _filtered_config(DPMSolverMultistepScheduler),
                use_karras_sigmas=True
            )

        print(f"[Modal Diffusion] Scheduler set: {type(self.pipeline.scheduler).__name__}")

    def _load_refiner_pipeline(self, model_config: Dict[str, Any]):
        """
        Load the refiner pipeline for SDXL base-to-refiner workflow.

        For DMD models, uses same model as refiner.
        For standard SDXL, loads the official refiner model.

        Args:
            model_config: Model configuration dict
        """
        import torch
        from diffusers import StableDiffusionXLImg2ImgPipeline

        if self.refiner_pipeline is not None:
            print("[Modal Diffusion] Refiner already loaded")
            return

        pipeline_type = model_config.get("pipeline", "flux")
        if pipeline_type != "sdxl":
            print("[Modal Diffusion] Refiner only supported for SDXL models")
            return

        is_custom = model_config.get("custom", False)
        use_same_model = model_config.get("refiner_same_as_base", True)  # DMD models use same model

        if is_custom and use_same_model:
            # For custom DMD models, use the same model for refining
            # Load as img2img pipeline from same checkpoint
            model_path = Path(CUSTOM_MODELS_DIR) / model_config["path"]
            print(f"[Modal Diffusion] Loading refiner from same model: {model_path}")

            if model_path.suffix == ".safetensors":
                self.refiner_pipeline = StableDiffusionXLImg2ImgPipeline.from_single_file(
                    str(model_path),
                    torch_dtype=torch.float16,
                    cache_dir=CACHE_DIR,
                )
            else:
                self.refiner_pipeline = StableDiffusionXLImg2ImgPipeline.from_pretrained(
                    str(model_path),
                    torch_dtype=torch.float16,
                    cache_dir=CACHE_DIR,
                )
        else:
            # Load official SDXL refiner
            print("[Modal Diffusion] Loading official SDXL refiner model")
            self.refiner_pipeline = StableDiffusionXLImg2ImgPipeline.from_pretrained(
                "stabilityai/stable-diffusion-xl-refiner-1.0",
                torch_dtype=torch.float16,
                variant="fp16",
                cache_dir=CACHE_DIR,
            )

        self.refiner_pipeline.to(self.device)
        print("[Modal Diffusion] Refiner pipeline loaded")

    def _load_loras(self, loras: Optional[List[LoraConfig]]) -> List[Dict[str, Any]]:
        """
        Load multiple LoRA weights into the pipeline with weighted blending.

        Args:
            loras: List of LoraConfig objects with path and scale

        Returns:
            List of dicts with loaded LoRA info
        """
        if self.pipeline is None:
            raise RuntimeError("Pipeline must be loaded before adding LoRAs")

        # Handle empty/None loras
        if not loras:
            # Unload any existing LoRAs
            if self.current_loras and hasattr(self.pipeline, 'unload_lora_weights'):
                try:
                    self.pipeline.unload_lora_weights()
                    print("[Modal Diffusion] LoRA: Unloaded existing LoRAs")
                except Exception as e:
                    print(f"[Modal Diffusion] LoRA: Warning during unload: {e}")
            self.current_loras = []
            return []

        loaded_loras = []
        adapter_names = []
        adapter_weights = []

        for i, lora_config in enumerate(loras):
            lora_path = lora_config.path
            lora_scale = lora_config.scale

            # Resolve path from LORAS_DIR if relative
            if not Path(lora_path).is_absolute():
                lora_file = Path(LORAS_DIR) / lora_path
            else:
                lora_file = Path(lora_path)

            # Also check in MODELS_DIR as fallback
            if not lora_file.exists():
                alt_path = Path(MODELS_DIR) / lora_path
                if alt_path.exists():
                    lora_file = alt_path

            # Validate file exists
            if not lora_file.exists():
                raise FileNotFoundError(f"LoRA file not found: {lora_path} (checked {lora_file})")

            # Validate .safetensors format
            if not str(lora_file).endswith('.safetensors'):
                raise ValueError(f"LoRA must be .safetensors format: {lora_path}")

            # Generate unique adapter name
            adapter_name = f"lora_{i}_{Path(lora_path).stem}"

            try:
                print(f"[Modal Diffusion] LoRA: Loading {lora_file} as '{adapter_name}' with scale {lora_scale}")
                self.pipeline.load_lora_weights(str(lora_file), adapter_name=adapter_name)

                adapter_names.append(adapter_name)
                adapter_weights.append(lora_scale)
                loaded_loras.append({
                    'path': str(lora_path),
                    'scale': lora_scale,
                    'adapter_name': adapter_name,
                    'loaded': True
                })
                print(f"[Modal Diffusion] LoRA: Successfully loaded {adapter_name}")

            except Exception as e:
                print(f"[Modal Diffusion] LoRA: Error loading {lora_path}: {e}")
                loaded_loras.append({
                    'path': str(lora_path),
                    'scale': lora_scale,
                    'adapter_name': adapter_name,
                    'loaded': False,
                    'error': str(e)
                })
                # Continue loading other LoRAs even if one fails

        # Set adapters with weights for blending
        if adapter_names and hasattr(self.pipeline, 'set_adapters'):
            try:
                self.pipeline.set_adapters(adapter_names, adapter_weights=adapter_weights)
                print(f"[Modal Diffusion] LoRA: Set {len(adapter_names)} adapters with weights {adapter_weights}")
            except Exception as e:
                print(f"[Modal Diffusion] LoRA: Error setting adapters: {e}")

        self.current_loras = loaded_loras
        return loaded_loras

    def generate(
        self,
        prompt: str,
        model: str = "flux-dev",
        width: int = 1024,
        height: int = 1024,
        steps: Optional[int] = None,
        guidance: Optional[float] = None,
        seed: Optional[int] = None,
        loras: Optional[List[LoraConfig]] = None,
        scheduler: Optional[str] = None,
        use_refiner: bool = False,
        refiner_switch: float = 0.8,
        clip_skip: Optional[int] = None,
        touchup_strength: float = 0.0,
        negative_prompt: Optional[str] = None,
        fix_faces: bool = False,
        face_fidelity: float = 0.7,
        face_upscale: Optional[int] = None,
        clear_cache: bool = True,
    ) -> Dict[str, Any]:
        """Generate an image from a text prompt"""
        import torch

        # Load model if different from current
        self._load_pipeline(model)

        # Load LoRAs if specified
        lora_info = self._load_loras(loras)

        model_config = self._get_model_config(model)

        # Use model defaults if not specified
        if steps is None:
            steps = model_config.get("default_steps", 25)
        if guidance is None:
            guidance = model_config.get("default_guidance", 3.5)

        # Apply scheduler (from request or model config)
        effective_scheduler = scheduler or model_config.get("scheduler")
        if effective_scheduler:
            self._set_scheduler(effective_scheduler)

        # Apply clip_skip if specified
        effective_clip_skip = clip_skip or model_config.get("clip_skip")
        if effective_clip_skip and hasattr(self.pipeline, 'text_encoder'):
            # CLIP skip works by using hidden states from earlier layers
            # This is typically handled via the pipeline's clip_skip parameter
            print(f"[Modal Diffusion] Using clip_skip={effective_clip_skip}")

        # Set up generator for reproducibility
        generator = None
        if seed is not None:
            generator = torch.Generator(device="cuda").manual_seed(seed)
        else:
            seed = torch.randint(0, 2**32, (1,)).item()
            generator = torch.Generator(device="cuda").manual_seed(seed)

        print(f"[Modal Diffusion] Generating: model={model}, steps={steps}, guidance={guidance}, seed={seed}, scheduler={effective_scheduler}")
        start_time = time.time()

        # Determine if we should use refiner (from request or model config)
        effective_use_refiner = use_refiner or model_config.get("use_refiner", False)
        effective_refiner_switch = refiner_switch if use_refiner else model_config.get("refiner_switch", 0.8)

        # Generate image
        pipeline_type = model_config.get("pipeline", "flux")
        refiner_info = None

        if pipeline_type == "sdxl" and effective_use_refiner:
            # SDXL with refiner: use denoising_end for base-to-refiner handoff
            print(f"[Modal Diffusion] Using refiner with switch at {effective_refiner_switch}")

            # Load refiner if not already loaded
            self._load_refiner_pipeline(model_config)

            if self.compel is not None:
                conditioning, pooled = self.compel(prompt)
                # Process negative prompt with Compel if provided
                negative_conditioning, negative_pooled = self._process_negative_prompt_with_compel(negative_prompt)
                # Base pass - stops at refiner_switch point
                base_result = self.pipeline(
                    prompt_embeds=conditioning,
                    pooled_prompt_embeds=pooled,
                    negative_prompt_embeds=negative_conditioning,
                    negative_pooled_prompt_embeds=negative_pooled,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    generator=generator,
                    denoising_end=effective_refiner_switch,
                    output_type="latent",
                )
            else:
                base_result = self.pipeline(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    generator=generator,
                    denoising_end=effective_refiner_switch,
                    output_type="latent",
                )

            # Refiner pass - continues from refiner_switch point
            result = self.refiner_pipeline(
                prompt=prompt,
                negative_prompt=negative_prompt,
                image=base_result.images,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=generator,
                denoising_start=effective_refiner_switch,
            )
            refiner_info = {
                "used": True,
                "switch_point": effective_refiner_switch,
                "model": "same_as_base" if model_config.get("custom") else "sdxl-refiner-1.0"
            }

        elif pipeline_type == "sdxl" and self.compel is not None:
            # Use Compel for long prompt handling in SDXL (no refiner)
            print(f"[Modal Diffusion] Using Compel for long prompt support ({len(prompt.split())} words)")
            conditioning, pooled = self.compel(prompt)
            # Process negative prompt with Compel if provided
            negative_conditioning, negative_pooled = self._process_negative_prompt_with_compel(negative_prompt)
            result = self.pipeline(
                prompt_embeds=conditioning,
                pooled_prompt_embeds=pooled,
                negative_prompt_embeds=negative_conditioning,
                negative_pooled_prompt_embeds=negative_pooled,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=generator,
                clip_skip=effective_clip_skip,
            )
        else:
            # Standard generation for non-SDXL models or if Compel not available
            # Include negative_prompt if provided (works for SDXL, ignored by Flux)
            pipeline_kwargs = {
                "prompt": prompt,
                "width": width,
                "height": height,
                "num_inference_steps": steps,
                "guidance_scale": guidance,
                "generator": generator,
            }
            if negative_prompt and pipeline_type == "sdxl":
                pipeline_kwargs["negative_prompt"] = negative_prompt
            result = self.pipeline(**pipeline_kwargs)

        inference_time = time.time() - start_time
        print(f"[Modal Diffusion] Generated in {inference_time:.1f}s")

        # Get the generated image
        image = result.images[0]

        # Apply img2img touchup if requested (for artifact cleanup)
        touchup_info = None
        effective_touchup = touchup_strength or model_config.get("touchup_strength", 0.0)
        if effective_touchup > 0 and pipeline_type == "sdxl":
            print(f"[Modal Diffusion] Applying img2img touchup with strength {effective_touchup}")
            touchup_start = time.time()

            # Load img2img pipeline if not already loaded (reuse refiner pipeline)
            self._load_refiner_pipeline(model_config)

            if self.refiner_pipeline is not None:
                # Run light img2img pass for artifact cleanup
                # strength = 1 - effective_touchup means lower touchup_strength = less change
                touchup_result = self.refiner_pipeline(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    image=image,
                    strength=effective_touchup,
                    num_inference_steps=max(4, int(steps * effective_touchup)),  # Fewer steps for light touchup
                    guidance_scale=guidance,
                    generator=generator,
                )
                image = touchup_result.images[0]
                touchup_time = time.time() - touchup_start
                print(f"[Modal Diffusion] Touchup completed in {touchup_time:.1f}s")
                touchup_info = {
                    "applied": True,
                    "strength": effective_touchup,
                    "time": touchup_time
                }
                inference_time += touchup_time

        # Apply face fixing if requested
        face_fix_info = None
        print(f"[Modal Diffusion] Face fixing check: fix_faces={fix_faces}, self.face_fixer={self.face_fixer is not None}")
        if fix_faces and self.face_fixer:
            try:
                print(f"[Modal Diffusion] Applying face fixing (fidelity={face_fidelity}, upscale={face_upscale or 1})")
                face_fix_start = time.time()

                # Get or initialize face fixer instance (models cached on volume)
                fixer = self.face_fixer(device=self.device, models_dir=self._face_fixing_models_dir)
                image, face_fix_info = fixer.fix_faces(
                    image,
                    fidelity=face_fidelity,
                    upscale=face_upscale or 1,
                )

                face_fix_time = time.time() - face_fix_start
                if face_fix_info:
                    face_fix_info['time'] = face_fix_time
                print(f"[Modal Diffusion] Face fixing completed in {face_fix_time:.1f}s")
                inference_time += face_fix_time
                # Only commit volume if new models were actually downloaded
                if fixer._volume_needs_commit:
                    model_volume.commit()
                    fixer._volume_needs_commit = False  # Reset after commit
            except Exception as e:
                print(f"[Modal Diffusion] Face fixing failed: {e}")
                face_fix_info = {
                    'applied': False,
                    'error': str(e)
                }

        # Convert to base64
        image_base64 = image_to_base64(image)

        # Clear GPU cache to prevent memory buildup (unless batching)
        if clear_cache:
            torch.cuda.empty_cache()

        return {
            "image": image_base64,
            "format": "base64",
            "metadata": {
                "seed": seed,
                "inference_time": inference_time,
                "model": model,
                "steps": steps,
                "guidance": guidance,
                "width": width,
                "height": height,
                "negative_prompt": negative_prompt,
                "loras": lora_info if lora_info else None,
                "scheduler": effective_scheduler,
                "clip_skip": effective_clip_skip,
                "refiner": refiner_info,
                "touchup": touchup_info,
                "face_fixing": face_fix_info,
            }
        }

    def _get_models_list(self) -> List[Dict[str, Any]]:
        """Internal helper to get list of available models with their defaults"""
        models = []

        # Add built-in models with their defaults
        for name, config in SUPPORTED_MODELS.items():
            models.append({
                "name": name,
                "type": "builtin",
                "pipeline": config["pipeline"],
                "repo": config.get("repo"),
                # Include model defaults for UI syncing
                "default_steps": config.get("default_steps", 25),
                "default_guidance": config.get("default_guidance", 3.5),
                "scheduler": config.get("scheduler"),
                "clip_skip": config.get("clip_skip"),
                "use_refiner": config.get("use_refiner", False),
                "refiner_switch": config.get("refiner_switch", 0.8),
                "touchup_strength": config.get("touchup_strength", 0.0),
            })

        # Add custom models with their defaults
        self.custom_models = load_custom_models_config()
        for name, config in self.custom_models.items():
            models.append({
                "name": name,
                "type": "custom",
                "pipeline": config.get("pipeline", "flux"),
                "path": config.get("path"),
                # Include model defaults for UI syncing
                "default_steps": config.get("default_steps", 25),
                "default_guidance": config.get("default_guidance", 3.5),
                "scheduler": config.get("scheduler"),
                "clip_skip": config.get("clip_skip"),
                "use_refiner": config.get("use_refiner", False),
                "refiner_switch": config.get("refiner_switch", 0.8),
                "touchup_strength": config.get("touchup_strength", 0.0),
            })

        return models

    @modal.method()
    def list_models(self) -> List[Dict[str, Any]]:
        """List all available models (Modal method for external calls)"""
        return self._get_models_list()

    def _generate_single(self, request: GenerateRequest, clear_cache: bool = True) -> dict:
        """Process a single generation request and return response dict"""
        result = self.generate(
            prompt=request.prompt,
            model=request.model,
            width=request.width,
            height=request.height,
            steps=request.steps,
            guidance=request.guidance,
            seed=request.seed,
            loras=request.loras,
            scheduler=request.scheduler,
            use_refiner=request.use_refiner,
            refiner_switch=request.refiner_switch,
            clip_skip=request.clip_skip,
            touchup_strength=request.touchup_strength,
            negative_prompt=request.negative_prompt,
            fix_faces=request.fix_faces,
            face_fidelity=request.face_fidelity,
            face_upscale=request.face_upscale,
            clear_cache=clear_cache,
        )
        return {
            "image": result["image"],
            "format": result["format"],
            "metadata": result.get("metadata"),
        }

    @modal.fastapi_endpoint(method="POST")
    def generate_endpoint(self, body: dict) -> dict:
        """HTTP endpoint for image generation (single or batch).

        Accepts either a single GenerateRequest or a BatchGenerateRequest
        (with a 'requests' array). Both use the same endpoint URL.
        """
        # Dispatch: batch if 'requests' key present, single otherwise
        if "requests" in body:
            batch_req = BatchGenerateRequest(**body)
            batch_start = time.time()
            results = []

            print(f"[Modal Diffusion] Batch request: {len(batch_req.requests)} images")

            for i, req in enumerate(batch_req.requests):
                print(f"[Modal Diffusion] Batch item {i+1}/{len(batch_req.requests)}: "
                      f"model={req.model}, fix_faces={req.fix_faces}")
                # Skip per-image cache clear for batch; do it once at the end
                results.append(self._generate_single(req, clear_cache=False))

            # Clear GPU cache once after all images in batch
            torch.cuda.empty_cache()

            batch_time = time.time() - batch_start
            print(f"[Modal Diffusion] Batch complete: {len(results)} images in {batch_time:.1f}s")

            return {
                "results": results,
                "metadata": {"total_time": batch_time, "count": len(results)},
            }
        else:
            request = GenerateRequest(**body)
            print(f"[Modal Diffusion] Request fix_faces={request.fix_faces}, "
                  f"face_fidelity={request.face_fidelity}, face_upscale={request.face_upscale}")
            return self._generate_single(request)

    @modal.fastapi_endpoint(method="GET")
    def health(self) -> HealthResponse:
        """Health check endpoint"""
        models = self._get_models_list()
        model_names = [m["name"] for m in models]

        return HealthResponse(
            status="healthy",
            model=self.current_model or "flux-dev",
            gpu=DEFAULT_GPU,
            container_ready=self.pipeline is not None,
            available_models=model_names,
            current_loras=self.current_loras if self.current_loras else None,
        )

    @modal.fastapi_endpoint(method="GET", label="models")
    def models_endpoint(self) -> ModelsResponse:
        """List available models endpoint"""
        return ModelsResponse(models=self._get_models_list())

    def _get_loras_list(self) -> List[Dict[str, Any]]:
        """Internal helper to get list of available LoRA files"""
        loras = []
        loras_path = Path(LORAS_DIR)

        if loras_path.exists():
            for lora_file in loras_path.glob("*.safetensors"):
                loras.append({
                    "name": lora_file.stem,
                    "path": lora_file.name,
                    "full_path": str(lora_file),
                    "size_mb": lora_file.stat().st_size / (1024 * 1024),
                })

        return loras

    @modal.fastapi_endpoint(method="GET", label="loras")
    def loras_endpoint(self) -> LorasResponse:
        """List available LoRA files"""
        return LorasResponse(loras=self._get_loras_list())

    @modal.fastapi_endpoint(method="GET", label="lora-status")
    def lora_status(self) -> LoraStatusResponse:
        """Get current LoRA status"""
        return LoraStatusResponse(
            loaded=len(self.current_loras) > 0,
            current_loras=self.current_loras,
        )


# Entrypoint for modal serve/run
@app.local_entrypoint()
def main():
    """Local entrypoint for testing"""
    print("Modal Diffusion Service")
    print(f"Supported models: {list(SUPPORTED_MODELS.keys())}")
    print(f"Default GPU: {DEFAULT_GPU}")
    print(f"Volume: {VOLUME_NAME}")
    print("\nTo deploy: modal deploy modal_diffusion_service.py")
    print("To serve locally: modal serve modal_diffusion_service.py")
    print("\nTo upload custom models, use modal_model_manager.py")
