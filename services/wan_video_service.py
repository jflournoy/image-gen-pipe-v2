#!/usr/bin/env python3
"""
WAN Video Generation Service
Modal-based service for WAN2.2-I2V (image-to-video) model
Generates videos from static images with optional prompts.

Usage:
    # Deploy to Modal
    modal deploy wan_video_service.py

    # Run locally for testing
    modal serve wan_video_service.py

    # Call the endpoint
    curl -X POST "https://your-app--generate-video.modal.run/generate-video" \
        -H "Modal-Key: $MODAL_TOKEN_ID" \
        -H "Modal-Secret: $MODAL_TOKEN_SECRET" \
        -H "Content-Type: application/json" \
        -d '{
          "image": "base64_encoded_image",
          "prompt": "a gentle camera pan across the landscape"
        }'
"""

import os
import io
import base64
import time
import json
from pathlib import Path
from typing import Optional, Dict, Any

import torch
import modal
from pydantic import BaseModel, Field

# Default configuration
DEFAULT_GPU = "A10G"  # 24GB - sufficient for FP8 WAN models
APP_NAME = "image-gen-video"
VOLUME_NAME = "video-models"
MODELS_DIR = "/models"
CACHE_DIR = f"{MODELS_DIR}/huggingface"

# Supported models
SUPPORTED_MODELS: Dict[str, Dict[str, Any]] = {
    "wan2.2-i2v-high": {
        "repo": "Wan-AI/Wan2.2-I2V-A14B",
        "pipeline": "wan_i2v",
        "default_steps": 30,
        "default_guidance": 4.0,
        "dtype": "bfloat16",
        "has_image_encoder": True,
        "mode": "i2v",
    },
    "wan2.2-ti2v-5b": {
        "repo": "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
        "pipeline": "wan_unified",
        "default_steps": 50,
        "default_guidance": 5.0,
        "dtype": "bfloat16",
        "has_image_encoder": False,
        "mode": "both",  # Supports both T2V and I2V
    },
    "wan2.2-t2v-14b": {
        "repo": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
        "pipeline": "wan_unified",
        "default_steps": 50,
        "default_guidance": 5.0,
        "default_guidance_2": 3.0,
        "dtype": "bfloat16",
        "has_image_encoder": False,
        "mode": "t2v",
    },
}

# Create Modal app
app = modal.App(APP_NAME)

# Create persistent volume for model storage
model_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# Define the container image with dependencies
diffusion_image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("libgl1", "libglib2.0-0", "ffmpeg")  # ffmpeg for video encoding
    .run_commands(
        "pip install uv",
        "mkdir -p /tmp/project"
    )
    .add_local_file("../pyproject.toml", "/tmp/project/pyproject.toml", copy=True)
    .add_local_file("../uv.lock", "/tmp/project/uv.lock", copy=True)
    .run_commands(
        "cd /tmp/project && uv pip install --system --no-cache .",
        "echo 'Dependencies installed from uv.lock (Python 3.10): 2026-02-25'"
    )
)


# Pydantic models for request/response
class VideoGenerationRequest(BaseModel):
    """Video generation request (I2V or T2V)"""
    mode: str = Field(default="i2v", description="Generation mode: 'i2v' or 't2v'")
    image: Optional[str] = Field(default=None, description="Base64-encoded image data (required for I2V)")
    prompt: Optional[str] = Field(default=None, description="Motion/animation prompt")
    model: str = Field(default="wan2.2-i2v-high", description="Model to use")
    steps: int = Field(default=30, ge=10, le=50, description="Inference steps")
    guidance: float = Field(default=4.0, ge=1.0, le=10.0, description="Guidance scale (high-noise expert)")
    guidance_2: Optional[float] = Field(default=None, ge=1.0, le=10.0, description="Guidance scale for low-noise expert (MoE 14B models only)")
    seed: Optional[int] = Field(default=None, description="Random seed")
    num_frames: int = Field(default=97, ge=17, le=144, description="Number of frames to generate")
    fps: int = Field(default=24, ge=12, le=30, description="Frames per second")
    height: Optional[int] = Field(default=None, description="Video height (T2V mode, default 480)")
    width: Optional[int] = Field(default=None, description="Video width (T2V mode, default 832)")


class VideoGenerationResponse(BaseModel):
    """Video generation response metadata"""
    format: str = Field(default="mp4", description="Video format")
    num_frames: int = Field(..., description="Total frames generated")
    fps: int = Field(..., description="Frames per second")
    duration_seconds: float = Field(..., description="Total video duration")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Generation metadata")


# Try to get HuggingFace secret if it exists
try:
    _hf_secret = modal.Secret.from_name("huggingface-secret")
    _secrets = [_hf_secret]
except Exception:
    _secrets = []


@app.cls(
    image=diffusion_image,
    gpu=DEFAULT_GPU,
    scaledown_window=300,
    secrets=_secrets,
    volumes={MODELS_DIR: model_volume},
)
class VideoGenerationService:
    """Modal class for WAN I2V inference"""

    pipeline: Any = None
    current_model: str = None
    device: str = "cuda"

    @modal.enter()
    def load_model(self):
        """Load default model on container startup"""
        import torch

        print(f"[WAN Video] Container starting on GPU: {DEFAULT_GPU}")
        print(f"[WAN Video] CUDA available: {torch.cuda.is_available()}")
        print(f"[WAN Video] Models directory: {MODELS_DIR}")
        print(f"[WAN Video] HuggingFace cache: {CACHE_DIR}")

        if torch.cuda.is_available():
            print(f"[WAN Video] GPU: {torch.cuda.get_device_name(0)}")
            print(f"[WAN Video] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

        # Ensure directories exist
        Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)

        # Pre-load default model for faster first inference
        self._load_pipeline("wan2.2-i2v-high")

    def _get_model_config(self, model_name: str) -> Dict[str, Any]:
        """Get model configuration"""
        if model_name not in SUPPORTED_MODELS:
            raise ValueError(
                f"Unknown model: {model_name}. "
                f"Available: {list(SUPPORTED_MODELS.keys())}"
            )
        return SUPPORTED_MODELS[model_name]

    def _load_pipeline(self, model_name: str):
        """Load the appropriate WAN pipeline based on model type"""
        import torch
        from diffusers import WanImageToVideoPipeline, WanPipeline, AutoencoderKLWan
        from transformers import CLIPVisionModel
        from huggingface_hub import login

        model_config = self._get_model_config(model_name)

        if self.current_model == model_name and self.pipeline is not None:
            print(f"[WAN Video] Model {model_name} already loaded")
            return

        # Authenticate with HuggingFace if needed
        hf_token = os.environ.get("HF_TOKEN")
        if hf_token:
            login(token=hf_token)
            print("[WAN Video] Authenticated with HuggingFace")

        # Clear existing pipeline to free memory
        if self.pipeline is not None:
            del self.pipeline
            torch.cuda.empty_cache()

        print(f"[WAN Video] Loading {model_name}...")
        start_time = time.time()

        repo = model_config["repo"]
        pipeline_type = model_config["pipeline"]
        has_image_encoder = model_config.get("has_image_encoder", False)
        print(f"[WAN Video] Loading from {repo} (pipeline={pipeline_type}, cache={CACHE_DIR})")

        # VAE must be float32 for proper decoding
        print("[WAN Video] Loading VAE (float32)...")
        vae = AutoencoderKLWan.from_pretrained(
            repo,
            subfolder="vae",
            torch_dtype=torch.float32,
            cache_dir=CACHE_DIR,
        )

        if pipeline_type == "wan_i2v":
            # WanImageToVideoPipeline: requires image_encoder (CLIP)
            print("[WAN Video] Loading image encoder (CLIP)...")
            image_encoder = CLIPVisionModel.from_pretrained(
                repo,
                subfolder="image_encoder",
                torch_dtype=torch.float32,
                cache_dir=CACHE_DIR,
            )

            print("[WAN Video] Loading WanImageToVideoPipeline (bfloat16)...")
            self.pipeline = WanImageToVideoPipeline.from_pretrained(
                repo,
                vae=vae,
                image_encoder=image_encoder,
                torch_dtype=torch.bfloat16,
                cache_dir=CACHE_DIR,
            )
        elif pipeline_type == "wan_unified":
            # WanPipeline: unified T2V + I2V (TI2V-5B, T2V-14B)
            print("[WAN Video] Loading WanPipeline (bfloat16)...")
            self.pipeline = WanPipeline.from_pretrained(
                repo,
                vae=vae,
                torch_dtype=torch.bfloat16,
                cache_dir=CACHE_DIR,
            )
        else:
            raise ValueError(f"Unknown pipeline type: {pipeline_type}")

        # Store pipeline type for generate() to know how to call it
        self.pipeline_type = pipeline_type

        # Apply memory optimizations for A10G (24GB)
        if self.device == "cuda":
            print("[WAN Video] Enabling model CPU offload for A10G...")
            try:
                self.pipeline.enable_model_cpu_offload()
                print("[WAN Video] Model CPU offload enabled")
            except Exception as e:
                print(f"[WAN Video] Warning: Could not enable CPU offload: {e}")

        # Commit volume changes (cached models)
        model_volume.commit()

        self.current_model = model_name
        load_time = time.time() - start_time
        print(f"[WAN Video] Loaded {model_name} in {load_time:.1f}s")

    def _decode_image(self, image_base64: str):
        """Decode base64 image to PIL Image"""
        from PIL import Image

        try:
            image_data = base64.b64decode(image_base64)
            image = Image.open(io.BytesIO(image_data)).convert("RGB")
            return image
        except Exception as e:
            raise ValueError(f"Failed to decode image: {e}")

    def generate(
        self,
        image_base64: Optional[str] = None,
        prompt: Optional[str] = None,
        mode: str = "i2v",
        model: str = "wan2.2-i2v-high",
        steps: int = 30,
        guidance: float = 4.0,
        guidance_2: Optional[float] = None,
        seed: Optional[int] = None,
        num_frames: int = 97,
        fps: int = 24,
        height: Optional[int] = None,
        width: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Generate a video from an image (I2V) or text prompt (T2V)"""
        import torch

        # Load model if different from current
        self._load_pipeline(model)

        model_config = self._get_model_config(model)

        # Decode input image for I2V modes
        image = None
        if mode == "i2v" and image_base64:
            image = self._decode_image(image_base64)
            print(f"[WAN Video] Input image: {image.size}")
        elif mode == "i2v" and not image_base64:
            raise ValueError("Image is required for I2V mode")

        # Use model defaults if not specified
        if steps is None:
            steps = model_config.get("default_steps", 30)
        if guidance is None:
            guidance = model_config.get("default_guidance", 4.0)
        if guidance_2 is None:
            guidance_2 = model_config.get("default_guidance_2")

        # Set up generator for reproducibility
        generator = None
        if seed is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)
        else:
            seed = torch.randint(0, 2**32, (1,)).item()
            generator = torch.Generator(device=self.device).manual_seed(seed)

        prompt_info = f'prompt="{prompt}"' if prompt else "prompt=None"
        guidance_info = f"guidance={guidance}"
        if guidance_2 is not None:
            guidance_info += f", guidance_2={guidance_2}"
        print(f"[WAN Video] Generating: mode={mode}, model={model}, steps={steps}, {guidance_info}, num_frames={num_frames}, {prompt_info}")
        start_time = time.time()

        try:
            # Build pipeline kwargs
            pipeline_kwargs = {
                "prompt": prompt or "",
                "negative_prompt": "",
                "num_inference_steps": steps,
                "guidance_scale": guidance,
                "generator": generator,
                "num_frames": num_frames,
            }

            # Add guidance_scale_2 for MoE models (only if set)
            if guidance_2 is not None:
                pipeline_kwargs["guidance_scale_2"] = guidance_2

            # Add image for I2V mode
            if image is not None:
                pipeline_kwargs["image"] = image

            # Add height/width for T2V mode (no image to infer size from)
            if mode == "t2v":
                pipeline_kwargs["height"] = height or 480
                pipeline_kwargs["width"] = width or 832

            # Generate video frames
            result = self.pipeline(**pipeline_kwargs)

            # result.frames is a list of PIL Images
            frames = result.frames[0] if isinstance(result.frames, list) and isinstance(result.frames[0], list) else result.frames

            inference_time = time.time() - start_time
            print(f"[WAN Video] Generated {len(frames)} frames in {inference_time:.1f}s")

            # Convert frames to video bytes (MP4)
            video_bytes = self._frames_to_mp4(frames, fps)

            result_dict = {
                "video_bytes": video_bytes,
                "num_frames": len(frames),
                "fps": fps,
                "duration_seconds": len(frames) / fps,
                "metadata": {
                    "seed": seed,
                    "inference_time": inference_time,
                    "mode": mode,
                    "model": model,
                    "steps": steps,
                    "guidance": guidance,
                    "guidance_2": guidance_2,
                    "prompt": prompt,
                    "num_frames": num_frames,
                }
            }

            return result_dict

        except Exception as e:
            print(f"[WAN Video] Generation error: {e}")
            import traceback
            traceback.print_exc()
            raise

        finally:
            # Clear GPU cache
            torch.cuda.empty_cache()

    def _frames_to_mp4(self, frames: list, fps: int = 24) -> bytes:
        """Convert PIL Image frames to MP4 video bytes"""
        import subprocess
        import tempfile
        from pathlib import Path

        # Create temporary directory for frame images
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            # Save frames as PNG sequence
            print(f"[WAN Video] Saving {len(frames)} frames...")
            for i, frame in enumerate(frames):
                frame_path = tmpdir_path / f"frame_{i:06d}.png"
                frame.save(frame_path)

            # Use ffmpeg to create MP4
            video_path = tmpdir_path / "output.mp4"
            frame_pattern = str(tmpdir_path / "frame_%06d.png")

            print(f"[WAN Video] Encoding video with ffmpeg (fps={fps})...")
            cmd = [
                "ffmpeg",
                "-framerate", str(fps),
                "-i", frame_pattern,
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-crf", "23",  # Quality (lower = better, 23 is default)
                "-preset", "fast",
                str(video_path),
                "-y",  # Overwrite output
            ]

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300,  # 5 minute timeout
                )

                if result.returncode != 0:
                    print(f"[WAN Video] ffmpeg error: {result.stderr}")
                    raise RuntimeError(f"ffmpeg encoding failed: {result.stderr}")

                # Read MP4 bytes
                with open(video_path, 'rb') as f:
                    video_bytes = f.read()

                file_size_mb = len(video_bytes) / (1024 * 1024)
                print(f"[WAN Video] Encoded video: {file_size_mb:.1f}MB")

                return video_bytes

            except subprocess.TimeoutExpired:
                raise RuntimeError("Video encoding timeout (5 minutes exceeded)")
            except Exception as e:
                print(f"[WAN Video] Video encoding error: {e}")
                raise

    @modal.fastapi_endpoint(method="POST")
    def generate_video_endpoint(self, body: dict) -> dict:
        """HTTP endpoint for video generation (I2V or T2V)"""
        request = VideoGenerationRequest(**body)

        # Validate: image required for I2V mode
        if request.mode == "i2v" and not request.image:
            return {"error": "image is required for I2V mode"}

        result = self.generate(
            image_base64=request.image,
            prompt=request.prompt,
            mode=request.mode,
            model=request.model,
            steps=request.steps,
            guidance=request.guidance,
            guidance_2=request.guidance_2,
            seed=request.seed,
            num_frames=request.num_frames,
            fps=request.fps,
            height=request.height,
            width=request.width,
        )

        # Return video as binary in response
        return {
            "video": base64.b64encode(result["video_bytes"]).decode("utf-8"),
            "format": "mp4",
            "num_frames": result["num_frames"],
            "fps": result["fps"],
            "duration_seconds": result["duration_seconds"],
            "metadata": result.get("metadata"),
        }

    @modal.fastapi_endpoint(method="GET")
    def health(self) -> dict:
        """Health check endpoint"""
        return {
            "status": "healthy",
            "model": self.current_model or "wan2.2-i2v-high",
            "gpu": DEFAULT_GPU,
            "container_ready": self.pipeline is not None,
            "available_models": list(SUPPORTED_MODELS.keys()),
        }

    @modal.fastapi_endpoint(method="GET", label="video-models")
    def models_endpoint(self) -> dict:
        """List available models endpoint"""
        models = []
        for name, config in SUPPORTED_MODELS.items():
            models.append({
                "name": name,
                "repo": config["repo"],
                "default_steps": config.get("default_steps", 30),
                "default_guidance": config.get("default_guidance", 4.0),
            })
        return {"models": models}


# Entrypoint for modal serve/run
@app.local_entrypoint()
def main():
    """Local entrypoint for testing"""
    print("WAN Video Generation Service")
    print(f"Supported models: {list(SUPPORTED_MODELS.keys())}")
    print(f"Default GPU: {DEFAULT_GPU}")
    print(f"Volume: {VOLUME_NAME}")
    print("\nTo deploy: modal deploy wan_video_service.py")
    print("To serve locally: modal serve wan_video_service.py")
