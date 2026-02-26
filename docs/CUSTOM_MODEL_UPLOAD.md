# Custom Model Upload Guide

Upload custom Chroma, WAN, and other models to Modal for image/video generation.

## Overview

The `modal_model_manager.py` tool manages custom models stored on Modal persistent volumes. Supports:
- **Image models**: Flux, SDXL, SDXL-Flow, SD3, Chroma
- **Video models**: WAN2.2 I2V

## Quick Start

### 1. Upload a Local Model

```bash
cd services

# Chroma image model
python modal_model_manager.py upload /path/to/chroma-custom.safetensors \
  --name my-chroma \
  --pipeline chroma \
  --steps 20 \
  --guidance 7.5

# WAN video model
python modal_model_manager.py upload /path/to/wan-custom.safetensors \
  --name my-video \
  --pipeline wan_i2v \
  --steps 30 \
  --guidance 4.0
```

### 2. Download from CivitAI

```bash
python modal_model_manager.py download-civitai \
  https://civitai.com/api/download/models/12345 \
  --name my-civitai-model \
  --pipeline chroma \
  --api-key YOUR_CIVITAI_API_KEY
```

### 3. List Uploaded Models

```bash
python modal_model_manager.py list
```

Output:
```
=== Custom Models ===
  my-chroma: chroma (my-chroma.safetensors)
  my-video: wan_i2v (my-video.safetensors)

=== Model Files ===
  my-chroma.safetensors: 12.5 GB
  my-video.safetensors: 14.0 GB

=== HuggingFace Cache ===
  Size: 0.00 GB
```

## Uploading Chroma Models

### From Local File

```bash
# Download model from CivitAI first
# https://civitai.com/search/models?baseModel=Chroma%201

python modal_model_manager.py upload ~/Downloads/chroma-custom.safetensors \
  --name chroma-photorealistic \
  --pipeline chroma \
  --steps 20 \
  --guidance 7.5
```

### From CivitAI URL

Get the model's download URL from CivitAI:
1. Go to model page (e.g., https://civitai.com/models/...)
2. Click "Download"
3. Copy the download link

```bash
python modal_model_manager.py download-civitai \
  https://civitai.com/api/download/models/12345 \
  --name chroma-anime \
  --pipeline chroma \
  --steps 20 \
  --guidance 7.5
```

### Using the Uploaded Chroma Model

In your application:

```javascript
const { createImageProvider } = require('./src/factory/provider-factory');

const imageProvider = createImageProvider({
  provider: 'modal',
  apiUrl: process.env.MODAL_ENDPOINT_URL,
  model: 'chroma-photorealistic',  // Your custom model name
  sessionId: 'test-session'
});

const result = await imageProvider.generateImage('a beautiful landscape');
```

Or in the service directly:

```python
# modal_diffusion_service.py automatically loads custom models from models.json
# Just specify the model name in your request
```

## Uploading WAN Video Models

### From Local File

```bash
# Download WAN variant from HuggingFace
# https://huggingface.co/Wan-AI/

python modal_model_manager.py upload ~/Downloads/wan2.2-i2v-custom.safetensors \
  --name wan-custom-style \
  --pipeline wan_i2v \
  --steps 30 \
  --guidance 4.0
```

### Using the Uploaded WAN Model

In your application:

```javascript
const { createVideoProvider } = require('./src/factory/provider-factory');

const videoProvider = createVideoProvider({
  provider: 'modal',
  apiUrl: process.env.MODAL_VIDEO_ENDPOINT_URL,
  model: 'wan-custom-style',  // Your custom model name
  sessionId: 'test-session'
});

const result = await videoProvider.generateVideo(
  imageBuffer,
  'a smooth camera pan',
  { steps: 30 }
);
```

## Pipeline Types

### Image Pipelines

| Pipeline | Best For | Steps | Guidance | Notes |
|----------|----------|-------|----------|-------|
| **flux** | High quality, flexibility | 20-50 | 1.0-5.0 | Fastest for quality |
| **sdxl** | Quality, control | 20-40 | 5.0-10.0 | Good balance |
| **sdxl_flow** | Quality, fast | 10-30 | 3.0-7.0 | Flow matching support |
| **sd3** | Detail, accuracy | 25-50 | 5.0-10.0 | Most accurate |
| **chroma** | Speed, consistency | 15-30 | 5.0-10.0 | Balanced |

### Video Pipelines

| Pipeline | Best For | Steps | Guidance | Frames | Notes |
|----------|----------|-------|----------|--------|-------|
| **wan_i2v** | I2V animation | 25-40 | 3.0-5.0 | 25-145 | Motion prompts recommended |

## Default Settings

Settings are stored with the model and used as defaults:

```bash
# Upload with custom defaults
python modal_model_manager.py upload my-model.safetensors \
  --name my-model \
  --pipeline sdxl \
  --steps 30 \
  --guidance 8.0
```

These can be overridden per-request:

```javascript
const result = await imageProvider.generateImage(prompt, {
  steps: 40,        // Override default (30)
  guidance: 9.0     // Override default (8.0)
});
```

## Model Storage Structure

```
/models/
├── huggingface/          # HuggingFace model cache
│   ├── hub/
│   └── ...
└── custom/               # Your uploaded models
    ├── models.json       # Configuration
    ├── my-chroma.safetensors
    ├── my-video.safetensors
    └── ...
```

The `models.json` file contains metadata for all custom models:

```json
{
  "my-chroma": {
    "path": "my-chroma.safetensors",
    "pipeline": "chroma",
    "custom": true,
    "default_steps": 20,
    "default_guidance": 7.5,
    "source": "civitai",
    "source_url": "https://..."
  },
  "my-video": {
    "path": "my-video.safetensors",
    "pipeline": "wan_i2v",
    "custom": true,
    "default_steps": 30,
    "default_guidance": 4.0,
    "source": "civitai",
    "source_url": "https://..."
  }
}
```

## Service Integration

### Image Services

Services automatically load custom models:

**modal_diffusion_service.py**:
```python
# In your request
{
  "model": "my-chroma",  # Loads from custom models
  "prompt": "...",
  "steps": 25
}
```

**Local Chroma Service**:
```bash
# Use UI or directly
CHROMA_MODEL_PATH=/models/custom/my-chroma.safetensors python services/chroma_service.py
```

### Video Services

**wan_video_service.py**:
```python
# In your request
{
  "model": "wan-custom-style",  # Loads from custom models
  "image": "...",
  "prompt": "...",
  "steps": 30
}
```

## Storage Management

### Check Volume Usage

```bash
python modal_model_manager.py usage
```

Output:
```
=== Volume Usage ===
Total: 50.0 GB (3 files)

Breakdown:
  custom: 26.5 GB (2 files)
  huggingface: 23.5 GB (142 files)
```

### Delete a Model

```bash
python modal_model_manager.py delete my-chroma
```

This removes the model file and config entry.

## CivitAI Integration

### Getting API Key

1. Go to https://civitai.com/user/account
2. Create API token
3. Set environment variable:
   ```bash
   export CIVIT_API_KEY="your_key_here"
   ```

### Finding Model URLs

On CivitAI:
1. Find model (e.g., Chroma variant)
2. Click "Download"
3. Copy API URL (should end with `/download/models/123456`)

Example:
```bash
python modal_model_manager.py download-civitai \
  https://civitai.com/api/download/models/298765 \
  --name chroma-vibrant \
  --pipeline chroma
```

## Troubleshooting

### "Model file not found"

Make sure path exists and is absolute:
```bash
# ✅ Correct
python modal_model_manager.py upload /home/user/models/my-model.safetensors ...

# ❌ Wrong
python modal_model_manager.py upload ~/models/my-model.safetensors ...
```

### "Failed to download from CivitAI"

1. Verify URL is correct (should have `/api/download/models/`)
2. Check if API key is needed and provided
3. Try downloading URL directly in browser first

### "Volume full" error

Delete unused models to free space:
```bash
python modal_model_manager.py delete old-model
python modal_model_manager.py usage
```

### Model not appearing in service

1. Verify `models.json` was updated:
   ```bash
   python modal_model_manager.py list
   ```

2. Redeploy service to load latest config:
   ```bash
   modal deploy wan_video_service.py
   # or
   modal deploy modal_diffusion_service.py
   ```

3. Check volume was committed:
   ```bash
   modal volume ls diffusion-models
   ```

## Best Practices

1. **Use descriptive names**:
   ```bash
   --name chroma-photorealistic  # Good
   --name chroma1               # Vague
   ```

2. **Document sources**:
   ```bash
   # Save CivitAI URL for reference
   python modal_model_manager.py download-civitai https://... \
     --name my-model  # Check source_url in models.json
   ```

3. **Test locally first**:
   ```bash
   # Try model locally before uploading to Modal
   python services/chroma_service.py  # With CHROMA_MODEL_PATH set
   ```

4. **Monitor storage**:
   ```bash
   # Check volume size regularly
   python modal_model_manager.py usage
   ```

5. **Use reasonable defaults**:
   ```bash
   # Set defaults that work well for the model
   --steps 25 --guidance 7.0  # Don't use extremes
   ```

## See Also

- [Modal Documentation](https://modal.com/docs)
- [CivitAI](https://civitai.com)
- [WAN Model Card](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B)
- [Chroma Model Card](https://huggingface.co/digiplay/Chroma-1-HD)
- [WAN Video Setup](./WAN_VIDEO_SETUP.md)
- [Local Services](./LOCAL_SERVICES.md)
