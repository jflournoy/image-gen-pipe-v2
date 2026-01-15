# Runtime Provider Switching & Model Management

Complete implementation of runtime provider switching with UI-driven model downloads.

## Overview

Users can now switch between OpenAI API and local providers (Ollama, Flux, Local Vision) at runtime without restarting the server. The system includes automatic model detection and one-click downloads with real-time progress tracking.

## Features Implemented

### 1. Runtime Provider Switching

**API Endpoints** ([src/api/provider-routes.js](../src/api/provider-routes.js))

- `GET /api/providers/status` - Current providers, health, and environment
- `POST /api/providers/switch` - Switch providers with validation
- `GET /api/providers/health` - Health check for all local services

**Key Capabilities:**
- No automatic fallback (user must explicitly choose)
- Service availability validation before switching
- Runtime state management separate from config
- Health checks for Ollama, Flux, and Local Vision

### 2. Model Management & Downloads

**API Endpoints**

- `GET /api/providers/models/status` - Check installed models
- `GET /api/providers/models/recommendations` - Get recommended models
- `POST /api/providers/models/download` - Download with SSE progress

**Supported Downloads:**
- **Ollama Models**: Direct `ollama pull` with progress parsing
- **Flux Models**: Manual setup required (Python service)
- **Local Vision**: Manual setup required (Python service)

**Progress Tracking:**
- Server-Sent Events (SSE) for real-time streaming
- Progress percentage updates
- Status messages (downloading, complete, error)
- Automatic UI refresh after download

### 3. User Interface

**Provider Settings Modal** ([public/demo.html](../public/demo.html:1268-1374))

Located in the header with server icon button:
- Environment detection (Local vs Production)
- Provider selection dropdowns (LLM, Image, Vision)
- Health status indicators (green/red)
- Service availability grid

**Model Management Section**

Only shown in local environment:
- Installed models list
- Recommended models with descriptions
- One-click download buttons
- Real-time progress bars
- Model sizes and setup guides

**Visual Indicators:**
- Header badge: Green (all OpenAI), Orange (local providers)
- Health badges: Green (available), Red (unavailable)
- Progress bars with percentage and messages

### 4. Beam Search Integration

**Worker Updates** ([src/api/beam-search-worker.js](../src/api/beam-search-worker.js:7-140))

- Imports runtime provider selections
- Creates providers using factory with runtime overrides
- Emits provider info in job start message

**How It Works:**
```javascript
const runtimeProviders = getRuntimeProviders();
const providers = {
  llm: createLLMProvider({ provider: runtimeProviders.llm, ... }),
  imageGen: createImageProvider({ provider: runtimeProviders.image, ... }),
  vision: createVisionProvider({ provider: runtimeProviders.vision, ... })
};
```

## Usage Guide

### Opening Provider Settings

1. Click the server icon in the demo page header
2. Modal shows current providers and health status
3. Service control buttons (Start/Stop) for each local service
4. Model management section appears if running locally

### Starting/Stopping Services

**From UI (Recommended):**
1. Open Provider Settings modal
2. Find service in "Local Service Status" section
3. Click "Start" button to launch service
4. Service starts in background (2-3 seconds)
5. Button changes to "Stop" when running
6. Message log shows status updates

**Services Available:**
- **Ollama**: LLM service (requires `ollama` installed)
- **Flux**: Image generation (requires Python deps)
- **Vision**: CLIP + aesthetic scoring (requires Python deps)

**First-Time Setup:**

1. **Install Ollama** (if using local LLM):
   ```bash
   # Visit https://ollama.ai and follow installation instructions
   # Or on macOS: brew install ollama
   # Or on Linux: curl -fsSL https://ollama.ai/install.sh | sh
   ```

2. **Install Python dependencies** (for Flux and Vision):
   ```bash
   pip install -r services/requirements.txt
   ```

3. **Automatic Model Downloads**:
   - Ollama models: Download via UI or `ollama pull <model-name>`
   - Flux downloads ~12 GB on first start (automatic)
   - Vision downloads ~600 MB on first start (automatic)

See [services/README.md](../services/README.md) for detailed setup instructions.

### Switching Providers

1. Select desired provider from dropdowns
   - LLM: OpenAI (GPT-5) or Ollama (Local)
   - Image: OpenAI (DALL-E) or Flux (Local)
   - Vision: OpenAI (GPT-5) or Local (CLIP)
2. Click "Apply Changes"
3. System validates service availability
4. If successful, providers switch immediately
5. Next beam search job uses new providers

### Downloading Models

**Ollama Models:**
1. Open Provider Settings
2. Scroll to "Ollama LLM Models" section
3. Click "Download" on desired model
4. Watch progress bar (real-time updates)
5. Model appears in installed list when complete

**Recommended Models:**
- `capybarahermes-2.5-mistral-7b` (4.1 GB) - RECOMMENDED
  - Fast 7B model, good for prompt refinement
- `llama3.2` (2.0 GB)
  - Latest Llama 3.2, general purpose
- `mistral` (4.1 GB)
  - Balanced speed and quality

### Service Management API

**New Endpoints:**
- `POST /api/providers/services/start` - Start a service
- `POST /api/providers/services/stop` - Stop a service
- `GET /api/providers/services/status` - Get service status

**Start Service Request:**
```json
POST /api/providers/services/start
{
  "service": "ollama"  // or "flux" or "vision"
}
```

**Response:**
```json
{
  "status": "started",
  "service": "ollama",
  "port": 11434,
  "pid": 12345,
  "message": "ollama service started successfully"
}
```

### Manual Service Start (Alternative)

If you prefer not to use the UI:

**Flux Image Generation:**
```bash
python3 services/flux_service.py
# Runs on http://localhost:8001
```

**Local Vision:**
```bash
python3 services/vision_service.py
# Runs on http://localhost:8002
```

**Ollama:**
```bash
ollama serve
# Runs on http://localhost:11434
```

## Architecture

### Provider State Management

**Config vs Runtime:**
```javascript
// Config defaults (from .env)
providerConfig.llm.provider = 'openai'

// Runtime overrides (from user selection)
runtimeProviders.llm = 'ollama'

// Resolution
getRuntimeProviders().llm // Returns 'ollama'
```

**State Persistence:**
- Runtime providers stored in module-level variable
- Survives across requests until server restart
- No persistence to disk (intentional)

### Health Check Flow

1. User opens provider modal
2. Frontend calls `/api/providers/status`
3. Backend checks each local service:
   - Ollama: HTTP GET to `/api/tags` for model list
   - Flux: HTTP GET to `/health` endpoint
   - Local Vision: HTTP GET to `/health` endpoint
4. Returns aggregated health data
5. UI updates indicators and enables/disables options

### Model Download Flow

1. User clicks "Download" button
2. Frontend POSTs to `/api/providers/models/download`
3. Backend sets SSE headers for streaming
4. For Ollama: spawns `ollama pull <model>` subprocess
5. Parses stdout for progress (e.g., "pulling manifest... 45%")
6. Streams progress updates via SSE
7. Frontend updates progress bar in real-time
8. On completion, refreshes model status

## Implementation Details

### Server-Sent Events (SSE)

**Why SSE over WebSocket:**
- One-way communication (server → client)
- Simpler than WebSocket for progress updates
- Automatic reconnection on connection loss
- Standard HTTP/HTTPS (no protocol upgrade)

**Message Format:**
```
data: {"status":"downloading","progress":45,"message":"Downloading model: 45%"}

data: {"status":"complete","progress":100,"message":"Successfully downloaded model"}
```

### Progress Parsing

Ollama output format:
```
pulling manifest
pulling 8eeb52dfb3bb... 100% ▕████████████████▏ 4.4 GB
pulling fa956ab37b8c... 100% ▕████████████████▏  108 B
```

Parser extracts percentage:
```javascript
const progressMatch = output.match(/(\d+)%/);
if (progressMatch) {
  const progress = parseInt(progressMatch[1], 10);
  sendProgress({ status: 'downloading', progress });
}
```

### Error Handling

**Service Unavailable:**
- Provider switch returns HTTP 503
- Error message: "Ollama service not available"
- Guidance: "Start Ollama service before switching"

**Download Failures:**
- Progress bar turns red
- Error message displayed for 5 seconds
- User can retry download

**Network Errors:**
- SSE connection handles reconnection automatically
- Frontend shows generic error if stream breaks

## Testing

### Test Provider Switching

1. Start server: `npm run dev`
2. Open http://localhost:3000
3. Click server icon → open provider settings
4. Try switching to Ollama without service:
   - Should show error: "Ollama service not available"
5. Start Ollama: `ollama serve`
6. Try switching again → should succeed

### Test Model Downloads

**Prerequisites:**
- Ollama installed and running
- ~5 GB disk space for test model

**Steps:**
1. Open provider settings
2. Check installed models list
3. Click "Download" on recommended model
4. Observe progress bar updating
5. Wait for completion
6. Model should appear in installed list

**Expected Progress:**
```
0% - Starting download...
15% - Downloading model: pulling manifest
45% - Downloading model: pulling 8eeb52dfb3bb... 45%
100% - Successfully downloaded model
```

## Configuration

### Environment Variables

**Provider Defaults:**
```bash
# LLM Provider
LLM_PROVIDER=openai
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=capybarahermes-2.5-mistral-7b

# Image Provider
IMAGE_PROVIDER=dalle
FLUX_API_URL=http://localhost:8001
FLUX_MODEL=flux-schnell

# Vision Provider
VISION_PROVIDER=gpt-vision
LOCAL_VISION_API_URL=http://localhost:8002
```

**Runtime Overrides:**
Users can override these via UI without changing .env

### Model Recommendations

Configured in `/api/providers/models/recommendations`:
- Model names (must match Ollama naming)
- Descriptions and sizes
- "Recommended" badges
- Setup guides for manual installations

## Security Considerations

1. **No API Key Exposure**: Local providers don't require API keys
2. **Command Injection Prevention**: Model names validated before spawning processes
3. **Service Validation**: Health checks before allowing provider switch
4. **No Elevated Privileges**: Downloads run as current user
5. **Disk Space**: No automatic disk space checking (user responsibility)

## Performance

**Provider Switching:**
- Instant (no server restart required)
- Next request uses new providers
- Health checks complete in < 2 seconds

**Model Downloads:**
- Ollama: Network-bound (depends on connection)
- Progress updates: ~10/second
- UI remains responsive during download

**Memory Impact:**
- Runtime state: negligible (~1 KB)
- SSE connections: ~4 KB per active download
- No memory leak (connections closed on completion)

## Future Enhancements

Potential improvements not yet implemented:

1. **Disk Space Checking**
   - Check available space before download
   - Warn if insufficient space for model

2. **Model Size Estimation**
   - Show accurate download sizes
   - Calculate ETA based on progress

3. **Parallel Downloads**
   - Download multiple models simultaneously
   - Queue system for sequential downloads

4. **Model Deletion**
   - UI button to remove models
   - Free up disk space

5. **Automatic Updates**
   - Check for model updates
   - One-click update button

6. **Advanced Flux Setup**
   - UI-driven Python service setup
   - Automatic dependency installation
   - Model download with progress

## Troubleshooting

### "Ollama is not installed" or "spawn ollama ENOENT"

**Cause:** Ollama command-line tool is not installed on your system

**Fix:**
```bash
# Visit https://ollama.ai and follow installation instructions

# macOS (via Homebrew):
brew install ollama

# Linux (via install script):
curl -fsSL https://ollama.ai/install.sh | sh

# Verify installation:
ollama --version
```

After installation, you can start the service from the UI or run `ollama serve` manually.

### "Ollama service not available"

**Cause:** Ollama is installed but not running, or wrong URL configured

**Fix:**
```bash
# Start Ollama
ollama serve

# Or specify custom URL
export OLLAMA_BASE_URL=http://your-host:11434
```

### "Model download failed"

**Cause:** Network error, disk full, or invalid model name

**Fix:**
1. Check internet connection
2. Verify disk space: `df -h`
3. Check model name: `ollama list` for available models
4. Retry download

### "Progress bar stuck at 0%"

**Cause:** Ollama output format changed or parsing failed

**Fix:**
1. Check server logs for actual Ollama output
2. Update progress parsing regex if needed
3. Manual download: `ollama pull <model-name>`

### "Provider switch reverted"

**Cause:** Service became unavailable after switch

**Fix:**
- Provider switches are not persistent across restarts
- Restart local services if they crashed
- Re-apply provider settings in UI

## Related Documentation

- [Local Providers Summary](./LOCAL_PROVIDERS_SUMMARY.md) - TDD implementation details
- [Model Selection Guide](./MODEL_SELECTION_GUIDE.md) - OpenAI model pricing
- [Architecture](./streaming-parallel-architecture.md) - System design

## Support

For issues or questions:
- Check logs: Server console shows detailed progress
- Verify health: `/api/providers/health` endpoint
- Test manually: `curl http://localhost:11434/api/tags`
- Report issues: GitHub issues with logs
