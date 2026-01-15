# Local Services

Python services for running local providers (Flux and Vision).

## Quick Start

### 0. Hugging Face Authentication (Required for Flux)

FLUX.1-dev is a **gated model** - you must authenticate with Hugging Face:

1. **Accept the model license**: https://huggingface.co/black-forest-labs/FLUX.1-dev
2. **Get your token**: https://huggingface.co/settings/tokens
3. **Set the environment variable**:
```bash
export HF_TOKEN=hf_your_token_here
```

Without this, you'll see: `401 Client Error... Cannot access gated repo`

### 1. Install Dependencies

```bash
# Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install requirements
pip install -r requirements.txt
```

### 2. Start Services from UI

The easiest way is to use the web UI:

1. Open http://localhost:3000
2. Click the server icon in the header
3. Click "Start" buttons for services you want to use

Services will run in the background managed by the Node.js server.

### 3. Manual Start (Alternative)

If you prefer to run services manually:

**Flux Image Generation:**
```bash
python3 services/flux_service.py
# Runs on port 8001
```

**Local Vision (CLIP + Aesthetics):**
```bash
python3 services/vision_service.py
# Runs on port 8002
```

## Service Details

### Flux Service (`flux_service.py`)

**Purpose**: Local image generation using Flux/SDXL models

**Requirements**:
- GPU with 12GB+ VRAM (recommended)
- ~12 GB disk space for models
- CUDA toolkit (for GPU acceleration)

**First Run**:
- Model downloads automatically from HuggingFace (~12 GB)
- This can take 30-60 minutes depending on connection
- Models are cached in `~/.cache/huggingface/`

**Configuration**:
```bash
export HF_TOKEN=hf_your_token_here  # REQUIRED for gated models
export FLUX_PORT=8001  # Default port
export FLUX_MODEL=black-forest-labs/FLUX.1-dev  # Model ID (dev-fp8 or standard dev)
```

**Using Custom Flux Models (CivitAI, etc.)**:

You can use locally downloaded Flux models instead of HuggingFace repositories:

1. **Download a model** from [CivitAI](https://civitai.com/search/models?baseModel=Flux.1%20D) or elsewhere
2. **Set the path** using `FLUX_MODEL_PATH` environment variable:

```bash
# Use local model file instead of HuggingFace repo
export FLUX_MODEL_PATH=/path/to/your/flux-model.safetensors

# Start the service
python3 services/flux_service.py
```

**Example: Using a CivitAI Model**
```bash
# 1. Download model to your preferred location
#    Example: ~/models/flux/custom-style-flux.safetensors

# 2. Set the path
export FLUX_MODEL_PATH=~/models/flux/custom-style-flux.safetensors

# 3. Start service (or configure via UI Settings)
cd services && .venv/bin/python flux_service.py
```

**Notes:**
- `FLUX_MODEL_PATH` takes precedence over `FLUX_MODEL`
- No HuggingFace token needed for local models
- Path must be absolute or relative to services directory
- Service validates path exists before loading
- Use the UI Settings modal to configure without restarting

**API Endpoints**:
- `GET /health` - Health check
- `POST /generate` - Generate image
- `POST /load` - Explicitly load model
- `POST /unload` - Unload model (free GPU memory)

### LLM Service (`llm_service.py`)

**Purpose**: Local language model inference for prompt refinement using llama-cpp-python

**Requirements**:
- GPU with 8GB+ VRAM (32 layers on GPU)
- ~4 GB disk space for GGUF model
- Can run on CPU (slower)

**First Run**:
- Model downloads automatically from HuggingFace (~4 GB)
- GGUF format is more memory-efficient than full models
- Models are cached in `~/.cache/huggingface/`

**Configuration**:
```bash
export LLM_PORT=8003  # Default port
export LLM_MODEL_REPO=TheBloke/Mistral-7B-Instruct-v0.2-GGUF  # Model repo
export LLM_MODEL_FILE=*Q4_K_M.gguf  # Model file pattern
export LLM_GPU_LAYERS=32  # Layers on GPU (-1 = all)
export LLM_CONTEXT_SIZE=2048  # Context window
```

**API Endpoints**:
- `GET /health` - Health check
- `POST /v1/completions` - OpenAI-compatible completions API
- `POST /load` - Explicitly load model
- `POST /unload` - Unload model (free GPU memory)

### VLM Service (`vlm_service.py`)

**Purpose**: Local Vision-Language Model for pairwise image comparison using llama-cpp-python

**Requirements**:
- GPU with 8GB+ VRAM (5-7GB for LLaVA 7B Q4)
- ~5 GB disk space for model
- Requires Flux to be unloaded (model coordinator handles this)

**First Run**:
- Model downloads automatically from HuggingFace (~5 GB)
- CLIP projector downloads separately (~500 MB)
- Models are cached in `~/.cache/huggingface/`

**Configuration**:
```bash
export VLM_PORT=8004  # Default port
export VLM_MODEL_REPO=jartine/llava-v1.6-mistral-7b-gguf  # Model repo
export VLM_MODEL_FILE=*Q4_K_M.gguf  # Model file pattern
export VLM_GPU_LAYERS=-1  # -1 = all layers on GPU
export VLM_CONTEXT_SIZE=4096  # Context window
```

**API Endpoints**:
- `GET /health` - Health check
- `POST /compare` - Pairwise image comparison
- `POST /load` - Explicitly load model
- `POST /unload` - Unload model (free GPU memory)

### Vision Service (`vision_service.py`)

**Purpose**: Local image analysis using CLIP + aesthetic scoring

**Requirements**:
- GPU with 4GB+ VRAM (recommended)
- ~1 GB disk space for models
- Can run on CPU (slower)

**First Run**:
- CLIP model downloads automatically (~600 MB)
- Takes 5-10 minutes depending on connection
- Models are cached in `~/.cache/huggingface/`

**Configuration**:
```bash
export LOCAL_VISION_PORT=8002  # Default port
export CLIP_MODEL=openai/clip-vit-base-patch32  # Model ID
```

**API Endpoints**:
- `GET /health` - Health check
- `POST /analyze` - Analyze image

## Troubleshooting

### "CUDA out of memory"

**Flux Service**: Reduce image size or use CPU
```python
# Edit flux_service.py line 30:
DEVICE = 'cpu'  # Force CPU mode
```

**Vision Service**: Model is small enough for most GPUs
```python
# Edit vision_service.py line 22:
DEVICE = 'cpu'  # Force CPU mode if needed
```

### "401 Client Error... Cannot access gated repo"

This means FLUX.1-dev requires authentication:

1. Accept the license: https://huggingface.co/black-forest-labs/FLUX.1-dev
2. Get a token: https://huggingface.co/settings/tokens
3. Set the token:
```bash
export HF_TOKEN=hf_your_token_here
```
4. Restart the Flux service

### "Failed to download model"

Check internet connection and HuggingFace status:
```bash
# Test HuggingFace connection
curl -I https://huggingface.co
```

### "Port already in use"

Change port in environment variables or code:
```bash
# Use different ports
export FLUX_PORT=8101
export LOCAL_VISION_PORT=8102
```

### "Module not found"

Ensure all dependencies are installed:
```bash
pip install -r requirements.txt
```

## Performance Tips

### GPU Acceleration

**NVIDIA GPUs**: Install CUDA toolkit
```bash
# Check CUDA availability
python3 -c "import torch; print(torch.cuda.is_available())"
```

**AMD GPUs**: Use ROCm (advanced)
```bash
# Install ROCm version of PyTorch
pip install torch --index-url https://download.pytorch.org/whl/rocm5.6
```

### Memory Optimization

**Flux Service** (already enabled):
- Attention slicing (reduces VRAM usage)
- VAE slicing (reduces peak memory)

**Additional optimizations**:
```bash
# Install xformers for memory-efficient attention
pip install xformers

# Enable in flux_service.py:
pipeline.enable_xformers_memory_efficient_attention()
```

### CPU Mode

Both services work on CPU (slower):
- Flux: 2-5 minutes per image
- Vision: 10-20 seconds per image

## Development

### Testing Services

**Flux:**
```bash
curl -X POST http://localhost:8001/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "flux-dev",
    "prompt": "a beautiful sunset",
    "height": 1024,
    "width": 1024,
    "steps": 25,
    "guidance": 3.5
  }'
```

**Vision:**
```bash
curl -X POST http://localhost:8002/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "imagePath": "/path/to/image.png",
    "prompt": "a beautiful sunset"
  }'
```

### Logs

Services log to stdout:
```bash
# View Flux logs
python3 services/flux_service.py 2>&1 | tee flux.log

# View Vision logs
python3 services/vision_service.py 2>&1 | tee vision.log
```

## Architecture

```
┌─────────────────┐
│  Node.js Server │
│   (port 3000)   │
└────────┬────────┘
         │
    ┌────┴─────┬──────────────┬───────────┐
    │          │              │           │
┌───▼───┐  ┌──▼───┐     ┌────▼────┐  ┌───▼───┐
│  LLM  │  │ Flux │     │ Vision  │  │  VLM  │
│ :8003 │  │:8001 │     │  :8002  │  │ :8004 │
└───────┘  └──────┘     └─────────┘  └───────┘
```

**GPU Memory Management**: The model coordinator ensures only one heavy model (Flux or VLM) is loaded at a time on a 12GB GPU. Vision/CLIP is small enough to coexist.

## Security

- Services bind to `0.0.0.0` (all interfaces)
- **Production**: Use firewall to restrict access
- No authentication required (local use only)
- Don't expose to public internet

## License

Services use the following models:
- **Flux**: Apache 2.0 license
- **CLIP**: MIT license
- Check model cards on HuggingFace for details

## Support

For issues:
1. Check logs for error messages
2. Verify GPU/CUDA installation
3. Test with CPU mode first
4. Report issues with full error trace
