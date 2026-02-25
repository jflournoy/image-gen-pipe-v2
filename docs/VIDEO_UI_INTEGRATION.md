# Video Generation UI Integration Guide

Add WAN video generation UI controls to your application.

## Overview

The video provider is already configured in the factory and ready to use. This guide covers:
1. Creating API routes to expose video generation
2. Adding UI controls for video generation
3. Displaying video results

## Step 1: Create API Routes

Add a new route file `src/api/video-routes.js`:

```javascript
/**
 * Video Generation Routes
 * Handles image-to-video generation requests
 */

const express = require('express');
const fs = require('fs').promises;
const { createVideoProvider } = require('../factory/provider-factory');
const { getLogger } = require('../utils/debug-logger');

const router = express.Router();
const logger = getLogger('VideoRoutes');

/**
 * POST /api/video/generate
 * Generate a video from an image
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      imageData,      // base64 image data
      imagePath,      // OR path to local image file
      prompt,         // motion description
      sessionId,
      outputDir,
      model,
      steps,
      guidance,
      fps,
      num_frames,
      seed
    } = req.body;

    logger.debug('Video generation request', {
      prompt: prompt?.substring(0, 50),
      model,
      steps,
      guidance
    });

    // Get image buffer
    let imageBuffer;
    if (imageData) {
      imageBuffer = Buffer.from(imageData, 'base64');
    } else if (imagePath) {
      imageBuffer = await fs.readFile(imagePath);
    } else {
      return res.status(400).json({ error: 'imageData or imagePath required' });
    }

    // Create video provider
    const videoProvider = createVideoProvider({
      sessionId: sessionId || 'api-session',
      outputDir: outputDir || 'output'
    });

    // Generate video
    const result = await videoProvider.generateVideo(
      imageBuffer,
      prompt,
      {
        model,
        steps,
        guidance,
        fps,
        num_frames,
        seed
      }
    );

    logger.info('Video generated successfully', {
      videoPath: result.videoPath,
      duration: result.metadata.duration_seconds
    });

    res.json({
      success: true,
      videoPath: result.videoPath,
      format: result.format,
      duration_seconds: result.metadata.duration_seconds,
      metadata: result.metadata
    });

  } catch (error) {
    logger.error('Video generation failed', error);
    res.status(500).json({
      error: error.message,
      type: error.constructor.name
    });
  }
});

/**
 * GET /api/video/health
 * Check video service health
 */
router.get('/health', async (req, res) => {
  try {
    const videoProvider = createVideoProvider();
    const health = await videoProvider.healthCheck();

    res.json(health);
  } catch (error) {
    res.status(500).json({
      available: false,
      error: error.message
    });
  }
});

module.exports = router;
```

Register the routes in `src/api/server.js`:

```javascript
// Add this with other route imports
const videoRoutes = require('./video-routes');

// Add this with other route registrations
app.use('/api/video', videoRoutes);
```

## Step 2: Create UI Component (React Example)

Create `public/components/VideoGenerator.jsx`:

```jsx
import React, { useState } from 'react';
import './VideoGenerator.css';

export default function VideoGenerator() {
  const [image, setImage] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoPath, setVideoPath] = useState(null);
  const [error, setError] = useState(null);

  // Generation settings
  const [settings, setSettings] = useState({
    steps: 30,
    guidance: 4.0,
    fps: 24,
    num_frames: 97,
    seed: null
  });

  // Handle image selection
  const handleImageSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Convert to base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result.split(',')[1];
      setImage({ file, base64 });
    };
    reader.readAsDataURL(file);
  };

  // Handle generation
  const handleGenerate = async () => {
    if (!image || !prompt.trim()) {
      setError('Please select an image and enter a prompt');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: image.base64,
          prompt,
          ...settings,
          sessionId: `web-${Date.now()}`
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const result = await response.json();
      setVideoPath(result.videoPath);
      console.log('Video generated:', result);

    } catch (err) {
      setError(err.message);
      console.error('Generation error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="video-generator">
      <h2>📹 Video Generation</h2>

      {/* Image Upload */}
      <div className="section">
        <label>Select Image</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          disabled={loading}
        />
        {image && <p className="info">✓ {image.file.name} selected</p>}
      </div>

      {/* Motion Prompt */}
      <div className="section">
        <label>Motion Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., 'a gentle camera pan across the landscape'"
          rows={3}
          disabled={loading}
        />
        <p className="hint">Describe the motion/animation desired</p>
      </div>

      {/* Settings */}
      <div className="section">
        <h3>Generation Settings</h3>

        <div className="grid">
          <div className="control">
            <label>Steps</label>
            <input
              type="number"
              min="10"
              max="50"
              value={settings.steps}
              onChange={(e) => setSettings({...settings, steps: parseInt(e.target.value)})}
              disabled={loading}
            />
            <span className="hint">{settings.steps} steps</span>
          </div>

          <div className="control">
            <label>Guidance</label>
            <input
              type="range"
              min="1"
              max="10"
              step="0.5"
              value={settings.guidance}
              onChange={(e) => setSettings({...settings, guidance: parseFloat(e.target.value)})}
              disabled={loading}
            />
            <span className="hint">{settings.guidance.toFixed(1)}</span>
          </div>

          <div className="control">
            <label>FPS</label>
            <input
              type="number"
              min="12"
              max="30"
              value={settings.fps}
              onChange={(e) => setSettings({...settings, fps: parseInt(e.target.value)})}
              disabled={loading}
            />
          </div>

          <div className="control">
            <label>Frames</label>
            <input
              type="number"
              min="17"
              max="144"
              value={settings.num_frames}
              onChange={(e) => setSettings({...settings, num_frames: parseInt(e.target.value)})}
              disabled={loading}
            />
            <span className="hint">≈ {(settings.num_frames / settings.fps).toFixed(1)}s</span>
          </div>
        </div>

        <div className="control full">
          <label>Seed (optional)</label>
          <input
            type="number"
            value={settings.seed || ''}
            onChange={(e) => setSettings({...settings, seed: e.target.value ? parseInt(e.target.value) : null})}
            placeholder="Leave empty for random"
            disabled={loading}
          />
        </div>
      </div>

      {/* Error */}
      {error && <div className="error">❌ {error}</div>}

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={loading || !image || !prompt}
        className="primary"
      >
        {loading ? '⏳ Generating... (1-2 min)' : '🚀 Generate Video'}
      </button>

      {/* Video Result */}
      {videoPath && (
        <div className="section result">
          <h3>✅ Video Generated!</h3>
          <video
            controls
            width="100%"
            style={{ maxWidth: '600px', borderRadius: '8px' }}
          >
            <source src={videoPath} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
          <p className="info">Saved to: <code>{videoPath}</code></p>
          <a href={videoPath} download className="button secondary">
            ⬇️ Download Video
          </a>
        </div>
      )}
    </div>
  );
}
```

Create CSS `public/components/VideoGenerator.css`:

```css
.video-generator {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.section {
  margin: 24px 0;
  padding: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.section h3 {
  margin-top: 0;
  margin-bottom: 16px;
  color: #333;
}

label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
}

input[type="text"],
input[type="number"],
input[type="file"],
textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: inherit;
  font-size: 14px;
}

input[type="file"] {
  padding: 8px 0;
}

textarea {
  resize: vertical;
  font-family: 'Monaco', 'Courier New', monospace;
}

input:disabled,
textarea:disabled {
  background-color: #f5f5f5;
  color: #999;
  cursor: not-allowed;
}

.hint {
  margin-top: 4px;
  font-size: 12px;
  color: #666;
}

.info {
  margin: 8px 0;
  color: #4caf50;
  font-size: 14px;
}

.error {
  padding: 12px;
  background-color: #ffebee;
  border-left: 4px solid #f44336;
  color: #c62828;
  margin: 16px 0;
  border-radius: 4px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.control {
  display: flex;
  flex-direction: column;
}

.control.full {
  grid-column: 1 / -1;
}

input[type="range"] {
  width: 100%;
  margin: 8px 0;
}

button {
  padding: 12px 24px;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

button.primary {
  background-color: #2196f3;
  color: white;
}

button.primary:hover:not(:disabled) {
  background-color: #1976d2;
}

button.primary:disabled {
  background-color: #bdbdbd;
  cursor: not-allowed;
}

button.secondary {
  background-color: #f5f5f5;
  color: #333;
  margin-top: 12px;
}

button.secondary:hover {
  background-color: #e0e0e0;
}

.result {
  background-color: #f0f7ff;
  border-color: #2196f3;
}

.result code {
  background-color: #e3f2fd;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 12px;
}

video {
  margin: 16px 0;
}
```

## Step 3: Add to Main UI

In your main page (e.g., `public/demo.html`):

```html
<div id="video-generator"></div>

<script>
  // Import and render the component
  import VideoGenerator from './components/VideoGenerator.jsx';

  ReactDOM.render(
    <VideoGenerator />,
    document.getElementById('video-generator')
  );
</script>
```

## Step 4: Add to Modal/Settings

If using a settings modal, add video generation as a tab:

```jsx
<Tabs>
  <Tab label="Image Generation">
    <ImageSettings />
  </Tab>
  <Tab label="Video Generation">
    <VideoGenerator />
  </Tab>
  <Tab label="Settings">
    <AppSettings />
  </Tab>
</Tabs>
```

## Example: Add to Beam Search UI

If you have a beam search UI showing generated images, add a "Generate Video" button:

```jsx
function ImageCard({ image, onGenerateVideo }) {
  return (
    <div className="image-card">
      <img src={image.localPath} alt="Generated" />
      <button onClick={() => onGenerateVideo(image)}>
        📹 Make Video
      </button>
    </div>
  );
}
```

When clicked, pre-fill the VideoGenerator with the selected image:

```jsx
const [selectedImage, setSelectedImage] = useState(null);

// In VideoGenerator
useEffect(() => {
  if (selectedImage) {
    // Read file and convert to base64
    // Pre-fill the prompt field
    setPrompt('a smooth camera pan');
  }
}, [selectedImage]);
```

## Testing

### Test API Route Locally

```bash
# Start server
npm start

# Test health endpoint
curl http://localhost:3000/api/video/health

# Test generation (requires image)
curl -X POST http://localhost:3000/api/video/generate \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "base64_encoded_image",
    "prompt": "a gentle pan",
    "steps": 30
  }'
```

### Test UI Component

In browser console:
```javascript
// Check health
fetch('/api/video/health').then(r => r.json()).then(console.log);

// Try generation
fetch('/api/video/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageData: 'base64_data',
    prompt: 'test prompt',
    steps: 30
  })
}).then(r => r.json()).then(console.log);
```

## Troubleshooting

**"Video service not available"**
- Check `MODAL_VIDEO_ENDPOINT_URL` is set
- Verify Modal service is deployed: `modal ps image-gen-video`

**"Generation taking too long"**
- First request has cold start (~60-120s)
- Reduce `num_frames` or `steps` for faster testing

**Video player not showing**
- Check browser supports HTML5 video
- Verify `videoPath` is correct
- Check video file exists: `ls -lh output/sessions/*/video-*.mp4`

**CORS errors**
- Add to server if needed:
  ```javascript
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });
  ```

## See Also

- [WAN Video Setup](./WAN_VIDEO_SETUP.md)
- [Custom Model Upload](./CUSTOM_MODEL_UPLOAD.md)
- [API Reference](../src/api/video-routes.js)
