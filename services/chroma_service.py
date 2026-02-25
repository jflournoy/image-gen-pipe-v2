#!/usr/bin/env python3
"""
Chroma1-HD Image Generation Service
FastAPI service for Chroma1-HD image generation
"""

import os
import sys
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
from diffusers import DiffusionPipeline
from huggingface_hub import login

# Service configuration
PORT = int(os.getenv('CHROMA_PORT', '8004'))

# Model configuration
MODEL_NAME = os.getenv('CHROMA_MODEL', 'lodestones/Chroma1-HD')
CHROMA_MODEL_PATH = os.getenv('CHROMA_MODEL_PATH')  # e.g., /path/to/checkpoint.safetensors

# Determine model source and validate
if CHROMA_MODEL_PATH:
    MODEL_SOURCE = 'local'
    model_path = Path(CHROMA_MODEL_PATH).resolve()
    if not model_path.exists():
        print(f'[Chroma Service] ⚠️ WARNING: CHROMA_MODEL_PATH does not exist: {CHROMA_MODEL_PATH}')
        print(f'[Chroma Service] Falling back to HuggingFace model: {MODEL_NAME}')
        MODEL_SOURCE = 'huggingface'
        CHROMA_MODEL_PATH = None
    else:
        CHROMA_MODEL_PATH = str(model_path)
        print(f'[Chroma Service] Using local model: {CHROMA_MODEL_PATH}')
else:
    MODEL_SOURCE = 'huggingface'
    print(f'[Chroma Service] Using HuggingFace model: {MODEL_NAME}')

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
HF_TOKEN = os.getenv('HF_TOKEN')

# Authenticate with Hugging Face if needed
if HF_TOKEN and MODEL_SOURCE == 'huggingface':
    print('[Chroma Service] Authenticating with Hugging Face...')
    try:
        login(token=HF_TOKEN)
    except Exception as e:
        print(f'[Chroma Service] ⚠️ HuggingFace login failed: {e}')
elif MODEL_SOURCE == 'local':
    print('[Chroma Service] Using local model - HuggingFace authentication not required')


@asynccontextmanager
async def lifespan(app):
    """Lifespan event handler for startup/shutdown"""
    print(f'[Chroma Service] Starting on port {PORT}')
    if MODEL_SOURCE == 'local':
        print(f'[Chroma Service] Model source: LOCAL')
        print(f'[Chroma Service] Model path: {CHROMA_MODEL_PATH}')
    else:
        print(f'[Chroma Service] Model source: HuggingFace')
        print(f'[Chroma Service] Model: {MODEL_NAME}')
    print(f'[Chroma Service] Device: {DEVICE}')
    yield
    print('[Chroma Service] Shutting down')


# Initialize FastAPI with lifespan
app = FastAPI(title='Chroma1-HD Image Generation Service', version='1.0.0', lifespan=lifespan)

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


class GenerationRequest(BaseModel):
    """Image generation request"""
    model: str
    prompt: str
    height: int = 768
    width: int = 768
    steps: int = 20
    guidance: float = 7.5
    seed: Optional[int] = None
    negativePrompt: Optional[str] = None


class GenerationResponse(BaseModel):
    """Image generation response"""
    localPath: str
    metadata: dict


def load_pipeline():
    """Load the Chroma1-HD pipeline with memory optimizations"""
    global pipeline

    if pipeline is not None:
        return pipeline

    # Determine which model to load
    model_to_load = CHROMA_MODEL_PATH if MODEL_SOURCE == 'local' else MODEL_NAME
    print(f'[Chroma Service] Loading model from {MODEL_SOURCE}: {model_to_load}')
    print(f'[Chroma Service] Device: {DEVICE}')

    # Clear GPU memory before loading
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        import gc
        gc.collect()
        free_mem = torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated(0)
        print(f'[Chroma Service] Available GPU memory: {free_mem / 1024**3:.1f} GB')

    try:
        kwargs = {
            'torch_dtype': torch.float16 if DEVICE == 'cuda' else torch.float32,
            'low_cpu_mem_usage': True,
        }

        if MODEL_SOURCE == 'huggingface':
            kwargs['token'] = HF_TOKEN
            pipeline = DiffusionPipeline.from_pretrained(
                model_to_load,
                **kwargs
            )
        else:
            # Local .safetensors file
            pipeline = DiffusionPipeline.from_single_file(
                model_to_load,
                **kwargs
            )

        if DEVICE == 'cuda':
            # Use sequential CPU offload for memory efficiency
            print('[Chroma Service] Enabling sequential CPU offload for 12GB GPU...')
            try:
                pipeline.enable_sequential_cpu_offload()
                pipeline.enable_attention_slicing(1)
                if hasattr(pipeline.vae, 'enable_slicing'):
                    pipeline.vae.enable_slicing()
                if hasattr(pipeline.vae, 'enable_tiling'):
                    pipeline.vae.enable_tiling()
            except Exception as e:
                print(f'[Chroma Service] WARNING: Could not enable CPU offload: {e}')

        print('[Chroma Service] Model loaded successfully')

        return pipeline

    except Exception as e:
        print(f'[Chroma Service] Failed to load model: {e}')
        import traceback
        traceback.print_exc()
        raise


def unload_pipeline():
    """Unload the pipeline to free GPU memory"""
    global pipeline
    import gc

    if pipeline is not None:
        print('[Chroma Service] Unloading model...')
        del pipeline
        pipeline = None
        gc.collect()
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
            free_mem = torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated(0)
            print(f'[Chroma Service] Model unloaded. Free GPU memory: {free_mem / 1024**3:.1f} GB')
        else:
            print('[Chroma Service] Model unloaded, GPU memory freed')
        return True
    return False


@app.get('/health')
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'model': CHROMA_MODEL_PATH if MODEL_SOURCE == 'local' else MODEL_NAME,
        'model_source': MODEL_SOURCE,
        'device': DEVICE,
        'model_loaded': pipeline is not None,
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


@app.post('/generate', response_model=GenerationResponse)
async def generate_image(request: GenerationRequest):
    """Generate an image"""
    try:
        # Load pipeline if not loaded
        pipe = load_pipeline()

        # Set seed for reproducibility
        generator = None
        if request.seed is not None:
            generator = torch.Generator(device=DEVICE).manual_seed(request.seed)

        # Generate image
        print(f'[Chroma Service] Generating: {request.prompt[:50]}...')

        result = pipe(
            prompt=request.prompt,
            negative_prompt=request.negativePrompt or '',
            height=request.height,
            width=request.width,
            num_inference_steps=request.steps,
            guidance_scale=request.guidance,
            generator=generator,
        )

        # Save image to temporary location
        output_dir = Path('output/temp')
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate filename
        import time
        timestamp = int(time.time() * 1000)
        filename = f'chroma_{timestamp}.png'
        output_path = output_dir / filename

        result.images[0].save(output_path)

        print(f'[Chroma Service] Saved to: {output_path}')

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
                'negativePrompt': request.negativePrompt,
            }
        )

    except Exception as e:
        print(f'[Chroma Service] Generation error: {e}')
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == '__main__':
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=PORT,
        log_level='info'
    )
