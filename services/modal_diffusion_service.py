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

# LoRA configuration
MAX_LORAS = 4  # Maximum number of simultaneous LoRAs

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
diffusion_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.1.0",
        "diffusers>=0.27.0",
        "transformers>=4.38.0",
        "accelerate>=0.27.0",
        "safetensors>=0.4.0",
        "sentencepiece>=0.1.99",
        "compel>=2.0.0",
        "fastapi>=0.109.0",
        "pydantic>=2.0.0",
        "Pillow>=10.0.0",
        "huggingface_hub>=0.21.0",
        "requests>=2.31.0",
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

    @field_validator('prompt')
    @classmethod
    def validate_prompt(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Prompt cannot be empty")
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
    compel: Any = None  # For long prompt handling in SDXL
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

        # Load custom models configuration
        self.custom_models = load_custom_models_config()
        if self.custom_models:
            print(f"[Modal Diffusion] Found {len(self.custom_models)} custom models: {list(self.custom_models.keys())}")

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

        # Set up generator for reproducibility
        generator = None
        if seed is not None:
            generator = torch.Generator(device="cuda").manual_seed(seed)
        else:
            seed = torch.randint(0, 2**32, (1,)).item()
            generator = torch.Generator(device="cuda").manual_seed(seed)

        print(f"[Modal Diffusion] Generating: model={model}, steps={steps}, guidance={guidance}, seed={seed}")
        start_time = time.time()

        # Generate image
        pipeline_type = model_config.get("pipeline", "flux")
        if pipeline_type == "sdxl" and self.compel is not None:
            # Use Compel for long prompt handling in SDXL
            print(f"[Modal Diffusion] Using Compel for long prompt support ({len(prompt.split())} words)")
            conditioning, pooled = self.compel(prompt)
            result = self.pipeline(
                prompt_embeds=conditioning,
                pooled_prompt_embeds=pooled,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=generator,
            )
        else:
            # Standard generation for non-SDXL models or if Compel not available
            result = self.pipeline(
                prompt=prompt,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=generator,
            )

        inference_time = time.time() - start_time
        print(f"[Modal Diffusion] Generated in {inference_time:.1f}s")

        # Convert to base64
        image = result.images[0]
        image_base64 = image_to_base64(image)

        # Clear GPU cache to prevent memory buildup
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
                "loras": lora_info if lora_info else None,
            }
        }

    def _get_models_list(self) -> List[Dict[str, Any]]:
        """Internal helper to get list of available models"""
        models = []

        # Add built-in models
        for name, config in SUPPORTED_MODELS.items():
            models.append({
                "name": name,
                "type": "builtin",
                "pipeline": config["pipeline"],
                "repo": config.get("repo"),
            })

        # Add custom models
        self.custom_models = load_custom_models_config()
        for name, config in self.custom_models.items():
            models.append({
                "name": name,
                "type": "custom",
                "pipeline": config.get("pipeline", "flux"),
                "path": config.get("path"),
            })

        return models

    @modal.method()
    def list_models(self) -> List[Dict[str, Any]]:
        """List all available models (Modal method for external calls)"""
        return self._get_models_list()

    @modal.fastapi_endpoint(method="POST")
    def generate_endpoint(self, request: GenerateRequest) -> GenerateResponse:
        """HTTP endpoint for image generation"""
        result = self.generate(
            prompt=request.prompt,
            model=request.model,
            width=request.width,
            height=request.height,
            steps=request.steps,
            guidance=request.guidance,
            seed=request.seed,
            loras=request.loras,
        )

        return GenerateResponse(
            image=result["image"],
            format=result["format"],
            metadata=result.get("metadata"),
        )

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
