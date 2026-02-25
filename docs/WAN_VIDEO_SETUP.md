# WAN Video Generation Setup

This guide covers setting up WAN2.2-I2V (image-to-video) generation on Modal.

## Overview

WAN2.2-I2V is a diffusion-based image-to-video model that generates smooth video animations from static images with optional motion prompts.

**Model specs:**
- Input: Single image + text prompt (optional)
- Output: MP4 video (97 frames @ 24fps = ~4 seconds by default)
- Checkpoint size: ~14GB (FP8 quantized)
- GPU requirement: A10G (24GB) or larger
- Generation time: 30-90 seconds

## Deployment to Modal

### Prerequisites

1. Modal account (https://modal.com)
2. Modal CLI installed: `pip install modal`
3. Modal token configured: `modal token new`

### Step 1: Deploy the WAN Video Service

```bash
# Navigate to services directory
cd services

# Deploy the service to Modal
modal deploy wan_video_service.py
```

This will:
- Create a Modal app called `image-gen-video`
- Build the container with dependencies
- Deploy to Modal cloud infrastructure
- Display your endpoint URL

Expected output:
```
✓ App created successfully: image-gen-video
✓ Endpoint URL: https://your-workspace--generate-video.modal.run
```

### Step 2: Get Modal Credentials

If not already configured:

```bash
# Get your Modal token credentials
modal token show

# Set environment variables
export MODAL_TOKEN_ID="token_xxx"
export MODAL_TOKEN_SECRET="secret_xxx"
export MODAL_VIDEO_ENDPOINT_URL="https://your-workspace--generate-video.modal.run"
```

### Step 3: Update Configuration

Add to your `.env` file:

```bash
# Modal credentials
MODAL_TOKEN_ID=token_xxx
MODAL_TOKEN_SECRET=secret_xxx

# Video endpoint (different from image endpoint if both deployed)
MODAL_VIDEO_ENDPOINT_URL=https://your-workspace--generate-video.modal.run

# Optional: customize generation defaults
MODAL_VIDEO_MODEL=wan2.2-i2v-high
MODAL_VIDEO_STEPS=30
MODAL_VIDEO_GUIDANCE=4.0
MODAL_VIDEO_FPS=24
MODAL_VIDEO_FRAMES=97
MODAL_VIDEO_TIMEOUT=600000  # 10 minutes
```

## Usage

### JavaScript/Node.js

```javascript
const { createVideoProvider } = require('./src/factory/provider-factory');

// Create provider
const videoProvider = createVideoProvider({
  provider: 'modal',
  apiUrl: process.env.MODAL_VIDEO_ENDPOINT_URL,
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
  model: 'wan2.2-i2v-high',
  sessionId: 'my-session',
  outputDir: 'output'
});

// Load an image
const fs = require('fs');
const imageBuffer = fs.readFileSync('input-image.png');

// Generate video
try {
  const result = await videoProvider.generateVideo(
    imageBuffer,
    'a gentle camera pan across the landscape',
    {
      steps: 30,
      guidance: 4.0,
      fps: 24,
      num_frames: 97,
      seed: 42
    }
  );

  console.log('Video generated:', result.videoPath);
  console.log('Duration:', result.metadata.duration_seconds, 'seconds');
  console.log('Inference time:', result.metadata.inference_time, 'seconds');
} catch (error) {
  console.error('Video generation failed:', error.message);
}
```

### Health Check

```javascript
const health = await videoProvider.healthCheck();
console.log(health);
// Output: { available: true, status: 'healthy', model: 'wan2.2-i2v-high', gpu: 'A10G', container_ready: true }
```

## Configuration Reference

### Generation Settings

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| `steps` | 30 | 10-50 | Higher = better quality, slower |
| `guidance` | 4.0 | 1.0-10.0 | Higher = follow prompt more strictly |
| `fps` | 24 | 12-30 | Frames per second |
| `num_frames` | 97 | 17-144 | Total frames in video |
| `seed` | random | 0-2^32 | Reproducibility |

### Prompt Tips

Good prompts describe motion/animation:
- ✅ "a slow zoom out revealing a cityscape"
- ✅ "camera pans left across rolling hills"
- ✅ "gentle fade with subtle color shift"
- ❌ "a beautiful sunset" (too static)
- ❌ "photorealistic" (WAN handles visuals from image)

### Frame Count vs Duration

```
frames = 97, fps = 24 → duration = 97/24 ≈ 4.0 seconds
frames = 145, fps = 24 → duration = 145/24 ≈ 6.0 seconds
frames = 17, fps = 24  → duration = 17/24 ≈ 0.7 seconds
```

## Troubleshooting

### "Cannot reach Modal service" error

1. Check endpoint URL is correct:
   ```bash
   echo $MODAL_VIDEO_ENDPOINT_URL
   ```

2. Verify service is deployed:
   ```bash
   modal ps image-gen-video
   ```

3. Check authentication:
   ```bash
   modal token show
   ```

### "Request timed out" error

1. Container cold start can take 60-120s first request
   - Wait and retry
   - Try smaller `num_frames` to reduce generation time

2. Check Modal resource availability
   - May be rate limited or out of A10G capacity
   - Try again after a few minutes

### "VRAM exhausted" error

This shouldn't happen with FP8 quantized model on A10G, but if it does:

1. Reduce `num_frames` (default 97)
2. Reduce `steps` (default 30, minimum 10)
3. Contact Modal support

### Video file is corrupted

1. Check video file exists:
   ```bash
   ls -lh output/sessions/[sessionId]/
   ```

2. Verify with ffprobe:
   ```bash
   ffprobe output/sessions/[sessionId]/video-*.mp4
   ```

3. If corrupt, regenerate with same seed for reproducibility

## Performance

Typical generation times on A10G:

| Frames | Steps | Time |
|--------|-------|------|
| 25 | 20 | ~30s |
| 50 | 25 | ~45s |
| 97 | 30 | ~60s |
| 145 | 30 | ~90s |

With sequential CPU offload enabled (automatic).

## Cost

Modal A10G pricing (varies by region):
- ~$0.35/hour on-demand
- Single 60-second generation costs ~$0.006-0.01

## Architecture

```
┌──────────────────┐
│  Your App        │
│ (Node.js client) │
└────────┬─────────┘
         │ HTTP/JSON
         ↓
┌──────────────────────────────────┐
│      Modal Cloud                 │
│  ┌────────────────────────────┐  │
│  │  WAN Video Service         │  │
│  │  - Load WAN2.2-I2V (14GB)  │  │
│  │  - Sequential CPU offload  │  │
│  │  - Generate frames         │  │
│  │  - Encode to MP4           │  │
│  └────────────────────────────┘  │
│             ↓                     │
│  A10G GPU (24GB VRAM)            │
└──────────────────────────────────┘
         │ Binary MP4
         ↓
┌──────────────────┐
│ Client Downloads │
│ & Saves to disk  │
└──────────────────┘
```

## Advanced

### Using Different Models

Currently supported:
- `wan2.2-i2v-high` (14GB, recommended)

To add new models, edit `wan_video_service.py`:

```python
SUPPORTED_MODELS = {
    "wan2.2-i2v-low": {
        "repo": "Wan-AI/Wan2.2-I2V-A8B",
        "default_steps": 25,
        ...
    },
}
```

Then redeploy:
```bash
modal deploy wan_video_service.py
```

### Custom Seeds for Reproducibility

```javascript
// Same image + prompt + seed = identical video
const result1 = await videoProvider.generateVideo(imageBuffer, prompt, { seed: 12345 });
const result2 = await videoProvider.generateVideo(imageBuffer, prompt, { seed: 12345 });
// result1 ≈ result2 (exact same frames)
```

### Batch Generation

For multiple videos, reuse provider instance to avoid reloading model:

```javascript
const videos = [];
for (const { image, prompt } of imagePromptPairs) {
  const result = await videoProvider.generateVideo(image, prompt);
  videos.push(result);
}
```

## Support

For issues:
1. Check logs: `modal logs image-gen-video`
2. Check Modal status: https://status.modal.com
3. Review this guide's troubleshooting section
4. Report issues with: `modal logs image-gen-video -f`

## See Also

- [Modal Documentation](https://modal.com/docs)
- [WAN Model Card](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B)
- [Local Flux Image Generation](./LOCAL_SERVICES.md)
- [Provider Configuration](../src/config/provider-config.js)
