#!/usr/bin/env python3
"""
Local VLM Service using llama-cpp-python
FastAPI service for vision-language model inference using multimodal GGUF models.
Supports pairwise image comparison for beam search ranking.
"""

import os
import gc
import time
import base64
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Service configuration
PORT = int(os.getenv('VLM_PORT', '8004'))

# Model configuration - multimodal GGUF models
# LLaVA 1.6 7B Q4 is ~5GB, fits well with 12GB GPU when Flux is unloaded
MODEL_REPO = os.getenv('VLM_MODEL_REPO', 'mys/ggml_llava-v1.6-mistral-7b')
MODEL_FILE = os.getenv('VLM_MODEL_FILE', '*Q4_K_M.gguf')
CLIP_MODEL_FILE = os.getenv('VLM_CLIP_FILE', 'mmproj-model-f16.gguf')
MODEL_PATH = os.getenv('VLM_MODEL_PATH', None)  # Override for local file

# GPU layers: -1 = all layers on GPU, 0 = CPU only
N_GPU_LAYERS = int(os.getenv('VLM_GPU_LAYERS', '-1'))
N_CTX = int(os.getenv('VLM_CONTEXT_SIZE', '4096'))

# Global model reference
llm = None
chat_handler = None


@asynccontextmanager
async def lifespan(app):
    """Lifespan event handler for startup/shutdown"""
    print(f'[VLM Service] Starting on port {PORT}')
    if MODEL_PATH:
        print(f'[VLM Service] Model path: {MODEL_PATH}')
    else:
        print(f'[VLM Service] Model repo: {MODEL_REPO}')
        print(f'[VLM Service] Model file: {MODEL_FILE}')
    print(f'[VLM Service] GPU layers: {N_GPU_LAYERS}')
    print(f'[VLM Service] Context size: {N_CTX}')
    yield
    # Cleanup on shutdown
    global llm, chat_handler
    if llm is not None:
        print('[VLM Service] Closing model...')
        llm.close()
        llm = None
        chat_handler = None
        gc.collect()
    print('[VLM Service] Shutdown complete')


# Initialize FastAPI with lifespan
app = FastAPI(title='Local VLM Service (llama.cpp)', version='1.0.0', lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


class CompareRequest(BaseModel):
    """Pairwise image comparison request"""
    image_a: str  # Path to first image
    image_b: str  # Path to second image
    prompt: str   # The prompt to evaluate images against


class CompareResponse(BaseModel):
    """Pairwise image comparison response"""
    choice: str        # 'A', 'B', or 'TIE'
    explanation: str   # Reasoning for the choice
    confidence: float  # 0.0-1.0 confidence score


def encode_image(image_path: str) -> str:
    """Encode image to base64 data URI"""
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f'Image not found: {image_path}')

    with open(path, 'rb') as f:
        data = f.read()

    # Determine mime type
    suffix = path.suffix.lower()
    mime_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    }
    mime = mime_types.get(suffix, 'image/png')

    return f'data:{mime};base64,{base64.b64encode(data).decode()}'


def load_model():
    """Load the VLM model using llama-cpp-python with vision support"""
    global llm, chat_handler

    if llm is not None:
        return llm

    try:
        from llama_cpp import Llama
        from llama_cpp.llama_chat_format import Llava15ChatHandler
    except ImportError:
        raise RuntimeError(
            "llama-cpp-python not installed. Install with: "
            "pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121"
        )

    print(f'[VLM Service] Loading model...')
    print(f'[VLM Service] GPU layers: {N_GPU_LAYERS}')

    try:
        from huggingface_hub import hf_hub_download
        import fnmatch

        if MODEL_PATH and Path(MODEL_PATH).exists():
            # Load from local file
            model_path = MODEL_PATH
            clip_path = os.getenv('VLM_CLIP_PATH')
        else:
            # Download from HuggingFace Hub
            print(f'[VLM Service] Downloading from HuggingFace: {MODEL_REPO}')

            # Resolve model file glob pattern
            model_file = MODEL_FILE
            if '*' in MODEL_FILE:
                from huggingface_hub import list_repo_files
                files = list(list_repo_files(MODEL_REPO))
                matches = [f for f in files if fnmatch.fnmatch(f, MODEL_FILE)]
                if matches:
                    model_file = matches[0]
                    print(f'[VLM Service] Found model: {model_file}')

            model_path = hf_hub_download(repo_id=MODEL_REPO, filename=model_file)

            # Download CLIP projector
            clip_path = hf_hub_download(repo_id=MODEL_REPO, filename=CLIP_MODEL_FILE)

        print(f'[VLM Service] Model path: {model_path}')
        print(f'[VLM Service] CLIP path: {clip_path}')

        # Create chat handler for vision
        chat_handler = Llava15ChatHandler(clip_model_path=clip_path, verbose=False)

        # Load model with vision chat handler
        llm = Llama(
            model_path=model_path,
            chat_handler=chat_handler,
            n_ctx=N_CTX,
            n_gpu_layers=N_GPU_LAYERS,
            verbose=False
        )

        print('[VLM Service] Model loaded successfully')
        return llm

    except Exception as e:
        print(f'[VLM Service] Failed to load model: {e}')
        import traceback
        traceback.print_exc()
        raise


def unload_model():
    """Unload the model to free GPU memory"""
    global llm, chat_handler

    if llm is not None:
        print('[VLM Service] Unloading model...')
        llm.close()
        llm = None
        chat_handler = None
        gc.collect()
        # Try to clear CUDA cache if available
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
        print('[VLM Service] Model unloaded, GPU memory freed')
        return True
    return False


@app.get('/health')
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'model_repo': MODEL_REPO,
        'model_file': MODEL_FILE,
        'gpu_layers': N_GPU_LAYERS,
        'context_size': N_CTX,
        'model_loaded': llm is not None
    }


@app.post('/load')
async def load_model_endpoint():
    """Explicitly load the model (for GPU coordination)"""
    try:
        load_model()
        return {
            'status': 'loaded',
            'model_repo': MODEL_REPO,
            'gpu_layers': N_GPU_LAYERS
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/unload')
async def unload_model_endpoint():
    """Explicitly unload the model to free GPU memory"""
    if unload_model():
        return {'status': 'unloaded', 'message': 'Model unloaded, GPU memory freed'}
    else:
        return {'status': 'not_loaded', 'message': 'Model was not loaded'}


@app.post('/compare', response_model=CompareResponse)
async def compare_images(request: CompareRequest):
    """
    Compare two images against a prompt.
    Returns which image (A or B) better matches the prompt.
    """
    try:
        # Load model if not loaded
        model = load_model()

        # Encode images
        try:
            image_a_uri = encode_image(request.image_a)
            image_b_uri = encode_image(request.image_b)
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Create comparison prompt
        comparison_prompt = f"""You are an image evaluation expert. Compare these two images (A and B) against this prompt:

PROMPT: "{request.prompt}"

Evaluate both images and determine which one better matches the prompt. Consider:
1. How well does each image capture the subject matter described?
2. How well does each image capture the style/mood described?
3. Overall quality and coherence of each image

Respond ONLY with a JSON object in this exact format:
{{"choice": "A" or "B" or "TIE", "explanation": "brief reason", "confidence": 0.0-1.0}}"""

        print(f'[VLM Service] Comparing images for: {request.prompt[:50]}...')
        start_time = time.time()

        # Create chat completion with images
        response = model.create_chat_completion(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": comparison_prompt},
                        {"type": "image_url", "image_url": {"url": image_a_uri}},
                        {"type": "image_url", "image_url": {"url": image_b_uri}}
                    ]
                }
            ],
            max_tokens=200,
            temperature=0.1  # Low temperature for consistent evaluations
        )

        elapsed = time.time() - start_time
        print(f'[VLM Service] Comparison completed in {elapsed:.1f}s')

        # Parse response
        response_text = response['choices'][0]['message']['content']

        # Try to extract JSON from response
        import json
        import re

        # Find JSON in response
        json_match = re.search(r'\{[^}]+\}', response_text)
        if json_match:
            try:
                result = json.loads(json_match.group())
                choice = result.get('choice', 'TIE').upper()
                if choice not in ('A', 'B', 'TIE'):
                    choice = 'TIE'
                return CompareResponse(
                    choice=choice,
                    explanation=result.get('explanation', response_text),
                    confidence=float(result.get('confidence', 0.5))
                )
            except json.JSONDecodeError:
                pass

        # Fallback: look for A or B in response
        if 'image a' in response_text.lower() or response_text.strip().upper().startswith('A'):
            return CompareResponse(choice='A', explanation=response_text, confidence=0.6)
        elif 'image b' in response_text.lower() or response_text.strip().upper().startswith('B'):
            return CompareResponse(choice='B', explanation=response_text, confidence=0.6)
        else:
            return CompareResponse(choice='TIE', explanation=response_text, confidence=0.4)

    except HTTPException:
        raise
    except Exception as e:
        print(f'[VLM Service] Comparison error: {e}')
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/download/status')
async def download_status():
    """Check if model is already downloaded/cached"""
    import fnmatch

    try:
        from huggingface_hub import try_to_load_from_cache, list_repo_files

        # Resolve glob pattern to actual filename
        actual_filename = MODEL_FILE
        if '*' in MODEL_FILE:
            try:
                files = list(list_repo_files(MODEL_REPO))
                matches = [f for f in files if fnmatch.fnmatch(f, MODEL_FILE)]
                if matches:
                    actual_filename = matches[0]
            except Exception:
                pass

        # Check if the model file is in cache
        cached_path = try_to_load_from_cache(MODEL_REPO, actual_filename)

        if cached_path and str(cached_path) != 'None':
            return {
                'status': 'cached',
                'path': str(cached_path),
                'filename': actual_filename,
                'message': 'Model is already downloaded'
            }
        else:
            return {
                'status': 'not_downloaded',
                'repo': MODEL_REPO,
                'file': actual_filename,
                'message': 'Model needs to be downloaded (~5GB for LLaVA 7B Q4)'
            }
    except ImportError:
        return {
            'status': 'unknown',
            'message': 'huggingface_hub not installed'
        }
    except Exception as e:
        return {
            'status': 'error',
            'message': str(e)
        }


if __name__ == '__main__':
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=PORT,
        log_level='info'
    )
