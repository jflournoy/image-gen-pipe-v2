#!/usr/bin/env python3
"""
Local Vision Service
FastAPI service for CLIP + Aesthetic scoring
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
from PIL import Image
import requests
from io import BytesIO

# Service configuration
PORT = int(os.getenv('LOCAL_VISION_PORT', '8002'))
CLIP_MODEL = os.getenv('CLIP_MODEL', 'openai/clip-vit-base-patch32')
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'


@asynccontextmanager
async def lifespan(app):
    """Lifespan event handler for startup/shutdown"""
    # Startup
    print(f'[Vision Service] Starting on port {PORT}')
    print(f'[Vision Service] CLIP Model: {CLIP_MODEL}')
    print(f'[Vision Service] Device: {DEVICE}')
    yield
    # Shutdown (if needed)
    print('[Vision Service] Shutting down')


# Initialize FastAPI with lifespan
app = FastAPI(title='Local Vision Service', version='1.0.0', lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Global models (loaded on first request)
clip_model = None
clip_processor = None
aesthetic_model = None


class AnalysisRequest(BaseModel):
    """Image analysis request"""
    imageUrl: Optional[str] = None
    imagePath: Optional[str] = None
    prompt: str
    options: dict = {}


class AnalysisResponse(BaseModel):
    """Image analysis response"""
    alignmentScore: float  # 0-100
    aestheticScore: float  # 0-10
    analysis: str
    strengths: List[str]
    weaknesses: List[str]


def load_models():
    """Load CLIP and aesthetic models"""
    global clip_model, clip_processor, aesthetic_model

    if clip_model is not None:
        return

    print(f'[Vision Service] Loading CLIP model: {CLIP_MODEL}')
    print(f'[Vision Service] Device: {DEVICE}')

    try:
        from transformers import CLIPProcessor, CLIPModel

        clip_processor = CLIPProcessor.from_pretrained(CLIP_MODEL)
        clip_model = CLIPModel.from_pretrained(CLIP_MODEL)

        if DEVICE == 'cuda':
            clip_model = clip_model.to('cuda')

        print('[Vision Service] CLIP model loaded successfully')

        # Aesthetic model is optional
        # For now, we'll use a simple heuristic

    except Exception as e:
        print(f'[Vision Service] Failed to load models: {e}')
        raise


def unload_models():
    """Unload models to free GPU memory"""
    global clip_model, clip_processor, aesthetic_model
    import gc

    if clip_model is not None:
        print('[Vision Service] Unloading models...')
        del clip_model
        clip_model = None

    if clip_processor is not None:
        del clip_processor
        clip_processor = None

    if aesthetic_model is not None:
        del aesthetic_model
        aesthetic_model = None

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    print('[Vision Service] Models unloaded, GPU memory freed')
    return True


def load_image(image_url: Optional[str], image_path: Optional[str]) -> Image.Image:
    """Load image from URL or local path"""
    try:
        if image_url:
            response = requests.get(image_url, timeout=10)
            response.raise_for_status()
            return Image.open(BytesIO(response.content)).convert('RGB')
        elif image_path:
            return Image.open(image_path).convert('RGB')
        else:
            raise ValueError('Either imageUrl or imagePath must be provided')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'Failed to load image: {e}')


def calculate_clip_score(image: Image.Image, prompt: str) -> float:
    """Calculate CLIP alignment score (0-100)"""
    load_models()

    try:
        # Process image and text
        inputs = clip_processor(
            text=[prompt],
            images=image,
            return_tensors='pt',
            padding=True
        )

        if DEVICE == 'cuda':
            inputs = {k: v.to('cuda') for k, v in inputs.items()}

        # Get embeddings
        with torch.no_grad():
            outputs = clip_model(**inputs)

        # Calculate similarity (cosine similarity normalized to 0-100)
        logits_per_image = outputs.logits_per_image
        score = float(logits_per_image[0][0])

        # Convert to 0-100 scale (CLIP scores are typically -10 to +10)
        normalized_score = max(0, min(100, (score + 10) * 5))

        return normalized_score

    except Exception as e:
        print(f'[Vision Service] CLIP scoring error: {e}')
        return 50.0  # Fallback score


def calculate_aesthetic_score(image: Image.Image) -> float:
    """Calculate aesthetic quality score (0-10)"""
    # Simple heuristic based on image properties
    # In production, use a trained aesthetic predictor model

    try:
        width, height = image.size
        aspect_ratio = width / height

        # Prefer standard aspect ratios
        standard_ratios = [1.0, 4/3, 16/9, 3/2]
        ratio_score = min([abs(aspect_ratio - r) for r in standard_ratios])

        # Prefer larger images
        size_score = min(1.0, (width * height) / (1024 * 1024))

        # Combined score
        aesthetic = 5.0 + (1 - ratio_score) * 2.5 + size_score * 2.5

        return max(0, min(10, aesthetic))

    except Exception as e:
        print(f'[Vision Service] Aesthetic scoring error: {e}')
        return 5.0  # Fallback score


def generate_analysis(alignment_score: float, aesthetic_score: float, prompt: str) -> tuple:
    """Generate analysis, strengths, and weaknesses"""

    strengths = []
    weaknesses = []

    # Alignment analysis
    if alignment_score >= 70:
        strengths.append('Strong alignment with prompt')
    elif alignment_score < 50:
        weaknesses.append('Poor alignment with prompt requirements')

    # Aesthetic analysis
    if aesthetic_score >= 7:
        strengths.append('High aesthetic quality')
    elif aesthetic_score < 5:
        weaknesses.append('Low aesthetic appeal')

    # Generate overall analysis
    if alignment_score >= 70 and aesthetic_score >= 7:
        analysis = 'Excellent image with strong prompt alignment and high aesthetic quality'
    elif alignment_score >= 50 and aesthetic_score >= 5:
        analysis = 'Good image that reasonably matches the prompt'
    else:
        analysis = 'Image has room for improvement in alignment or aesthetics'

    return analysis, strengths, weaknesses


@app.get('/health')
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'device': DEVICE,
        'models': ['clip-vit-base-patch32', 'aesthetic-heuristic'],
        'model_loaded': clip_model is not None
    }


@app.post('/load')
async def load_model_endpoint():
    """Explicitly load models (for GPU coordination)"""
    try:
        load_models()
        return {
            'status': 'loaded',
            'device': DEVICE,
            'model': CLIP_MODEL
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/unload')
async def unload_model_endpoint():
    """Explicitly unload models to free GPU memory"""
    if clip_model is not None:
        unload_models()
        return {'status': 'unloaded', 'message': 'Models unloaded, GPU memory freed'}
    else:
        return {'status': 'not_loaded', 'message': 'Models were not loaded'}


@app.post('/analyze', response_model=AnalysisResponse)
async def analyze_image(request: AnalysisRequest):
    """Analyze an image"""
    try:
        # Load image
        image = load_image(request.imageUrl, request.imagePath)

        print(f'[Vision Service] Analyzing image for prompt: {request.prompt[:50]}...')

        # Calculate scores
        alignment_score = calculate_clip_score(image, request.prompt)
        aesthetic_score = calculate_aesthetic_score(image)

        # Generate analysis
        analysis, strengths, weaknesses = generate_analysis(
            alignment_score,
            aesthetic_score,
            request.prompt
        )

        print(f'[Vision Service] Scores - Alignment: {alignment_score:.1f}, Aesthetic: {aesthetic_score:.1f}')

        return AnalysisResponse(
            alignmentScore=alignment_score,
            aestheticScore=aesthetic_score,
            analysis=analysis,
            strengths=strengths,
            weaknesses=weaknesses
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f'[Vision Service] Analysis error: {e}')
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == '__main__':
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=PORT,
        log_level='info'
    )
