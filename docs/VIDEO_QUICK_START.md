# Video Generation Quick Start

Complete setup in 5 steps.

## 1️⃣ Deploy WAN Service to Modal

```bash
cd services
modal deploy wan_video_service.py
```

Copy the endpoint URL from output:
```
✓ Endpoint URL: https://your-workspace--generate-video.modal.run
```

## 2️⃣ Set Environment Variables

```bash
export MODAL_TOKEN_ID="token_xxx"
export MODAL_TOKEN_SECRET="secret_xxx"
export MODAL_VIDEO_ENDPOINT_URL="https://your-workspace--generate-video.modal.run"
```

Or add to `.env`:
```env
MODAL_VIDEO_ENDPOINT_URL=https://your-workspace--generate-video.modal.run
MODAL_TOKEN_ID=token_xxx
MODAL_TOKEN_SECRET=secret_xxx
```

## 3️⃣ Upload Custom Models (Optional)

Upload Chroma image models or custom WAN video models:

```bash
# Chroma from CivitAI
python modal_model_manager.py download-civitai \
  https://civitai.com/api/download/models/12345 \
  --name my-chroma \
  --pipeline chroma

# Local WAN model
python modal_model_manager.py upload ./my-wan-model.safetensors \
  --name my-wan \
  --pipeline wan_i2v
```

List your models:
```bash
python modal_model_manager.py list
```

## 4️⃣ Add UI Controls

Create basic video generation UI:

1. Copy code from [VIDEO_UI_INTEGRATION.md](./VIDEO_UI_INTEGRATION.md)
2. Create `src/api/video-routes.js` (API endpoints)
3. Create `public/components/VideoGenerator.jsx` (React component)
4. Register routes in `src/api/server.js`
5. Add component to your main page

**Minimal example:**

```javascript
// In your code
const videoProvider = createVideoProvider({
  sessionId: 'my-session'
});

// Generate
const result = await videoProvider.generateVideo(
  imageBuffer,
  'a gentle camera pan',
  { steps: 30, fps: 24, num_frames: 97 }
);

console.log('Video saved to:', result.videoPath);
```

## 5️⃣ Test It

```bash
# Check service health
curl http://localhost:3000/api/video/health

# Generate video (with image)
curl -X POST http://localhost:3000/api/video/generate \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "base64_encoded_image_data",
    "prompt": "a gentle camera pan",
    "steps": 30
  }'
```

Or run the example:
```bash
node examples/video-generation-example.js
```

---

## What You Now Have

✅ **Backend:**
- WAN video service deployed to Modal
- Video provider factory (`createVideoProvider()`)
- Configuration system for video settings
- Custom model upload system

✅ **API:**
- POST `/api/video/generate` - Generate videos
- GET `/api/video/health` - Check service status

✅ **Frontend:**
- React component for video generation
- HTML5 video player for results
- Configuration UI for generation settings

✅ **Custom Models:**
- Upload Chroma image models from CivitAI
- Upload WAN video models from local files
- Manage models with modal_model_manager.py

---

## Common Tasks

### Generate a Video Programmatically

```javascript
const { createVideoProvider } = require('./src/factory/provider-factory');

const videoProvider = createVideoProvider({
  sessionId: 'batch-001'
});

const result = await videoProvider.generateVideo(
  imageBuffer,
  'smooth zoom out revealing scenery',
  {
    steps: 30,
    guidance: 4.0,
    fps: 24,
    num_frames: 97,
    seed: 12345  // For reproducibility
  }
);
```

### Use a Custom Model

```javascript
const videoProvider = createVideoProvider({
  model: 'my-wan-custom'  // Your uploaded model
});
```

### Change Generation Defaults

Edit `.env`:
```env
MODAL_VIDEO_STEPS=25
MODAL_VIDEO_GUIDANCE=3.5
MODAL_VIDEO_FPS=30
MODAL_VIDEO_FRAMES=60
```

### Monitor GPU Usage

```bash
# Check Modal service status
modal ps image-gen-video

# View logs
modal logs image-gen-video -f
```

---

## Architecture Overview

```
Your Application
    ↓
createVideoProvider()  (factory)
    ↓
ModalVideoProvider    (JS client)
    ↓
HTTP POST /generate-video
    ↓
Modal Cloud GPU (A10G)
    ↓
WAN2.2-I2V-A14B      (14GB FP8)
    ↓
ffmpeg MP4 encoding
    ↓
Binary stream response
    ↓
output/sessions/{sessionId}/video-*.mp4
```

---

## File Reference

| File | Purpose |
|------|---------|
| `services/wan_video_service.py` | Modal service (backend) |
| `src/providers/modal-video-provider.js` | Video client (frontend) |
| `src/factory/provider-factory.js` | Factory function |
| `src/config/provider-config.js` | Configuration |
| `src/api/video-routes.js` | API endpoints |
| `public/components/VideoGenerator.jsx` | React component |
| `services/modal_model_manager.py` | Model upload tool |
| `docs/WAN_VIDEO_SETUP.md` | Detailed setup |
| `docs/CUSTOM_MODEL_UPLOAD.md` | Model management |
| `docs/VIDEO_UI_INTEGRATION.md` | UI implementation |

---

## Troubleshooting

**Service won't deploy**
```bash
# Check dependencies
modal up wan_video_service.py

# Check logs
modal logs image-gen-video
```

**Generation timeout**
- First request may take 60-120s (cold start)
- Reduce `num_frames` for testing

**Model not found**
```bash
# Verify model exists
python modal_model_manager.py list

# Redeploy service to load custom models
modal deploy wan_video_service.py
```

**CUDA out of memory**
- Shouldn't happen with FP8 on A10G
- Reduce `steps` or `num_frames`
- Upgrade to A100 if needed

---

## Next Steps

1. ✅ Deploy Modal service (Step 1)
2. ✅ Set environment variables (Step 2)
3. ✅ Upload custom models (Step 3)
4. ✅ Add UI controls (Step 4)
5. ✅ Test functionality (Step 5)

**Then:**
- [ ] Integrate with beam search results
- [ ] Add video quality evaluation (VLM)
- [ ] Implement batch video generation
- [ ] Create video comparison UI
- [ ] Setup video storage/archival

---

## Support

- 📖 Full docs: See `docs/` directory
- 🔧 Setup help: `docs/WAN_VIDEO_SETUP.md`
- 📤 Model uploads: `docs/CUSTOM_MODEL_UPLOAD.md`
- 🎨 UI guide: `docs/VIDEO_UI_INTEGRATION.md`
- 💬 Example code: `examples/video-generation-example.js`
- 🧪 Tests: `test/providers/modal-video-provider.test.js`

---

## Quick Links

- [WAN Model Card](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B)
- [Modal Docs](https://modal.com/docs)
- [CivitAI Models](https://civitai.com)
- [Diffusers WAN Pipeline](https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/wan/)
