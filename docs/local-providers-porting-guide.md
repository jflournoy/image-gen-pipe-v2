# Local Providers Porting Guide

**Status**: Existing implementations found in `~/code/diffusion-python`
**Date**: 2026-01-08

## Overview

Complete local provider implementations exist in the `diffusion-python` project and need to be ported to the provider architecture in `image-gen-pipe-v2`.

## Existing Implementations

### 1. LLM Provider (Ollama/llama-cpp-python)

**Source**: `diffusion-python/generate-candidates.py` (lines 333-541)

**Current Implementation**:
```python
# LLM setup with llama-cpp-python
from llama_cpp import Llama

llm = Llama.from_pretrained(
    repo_id="TheBloke/CapybaraHermes-2.5-Mistral-7B-GGUF",
    filename="*Q5_K_M.gguf",
    n_ctx=2048,
    n_gpu_layers=32
)

# Prompt expansion (lines 463-476)
def expand_prompt(llm, prompt, version='what'|'how'):
    # Expands terse prompts into detailed descriptions
    # Supports separate 'what' (content) and 'how' (style) expansion

# Prompt refinement (lines 506-541)
def refine_prompt(llm, prompt, caption, clip_score, aes_score, user_prompt, version):
    # Critique-based iterative refinement
    # Uses CLIP score for 'what', aesthetic score for 'how'

# Prompt combination (lines 478-504)
def combine_how_what(llm, prompt_what, prompt_how):
    # Combines content + style prompts intelligently
```

**Interface Needed** (`src/providers/ollama-llm-provider.js`):
```javascript
class OllamaLLMProvider {
  async refinePrompt(prompt, options = {}) {
    // options.dimension: 'what' or 'how'
    // options.previousResult: for critique-based refinement
  }

  async combinePrompts(whatPrompt, howPrompt) {
    // Intelligent combination of content + style
  }

  async generateText(prompt, options = {}) {
    // General-purpose text generation
  }
}
```

**Porting Strategy**:
- Use HTTP API wrapper around Python subprocess
- FastAPI service exposing the LLM functions
- Alternative: Direct Node.js bindings if available

### 2. Image Provider (Flux/SDXL)

**Source**: `diffusion-python/generate-candidates.py` (lines 585-871)

**Current Implementation**:
```python
from diffusers import (
    StableDiffusionXLPipeline,
    StableDiffusionXLImg2ImgPipeline,
    DPMSolverMultistepScheduler
)

# Text-to-image generation
pipe = StableDiffusionXLPipeline.from_pretrained(
    unpacked_dir,
    torch_dtype=torch.float16,
    low_cpu_mem_usage=True
)

# Weighted prompt embeddings (lines 712-730)
from sd_embed.embedding_funcs import get_weighted_text_embeddings_sdxl
prompt_embeds, negative_embeds, pooled_embeds, negative_pooled = \
    get_weighted_text_embeddings_sdxl(pipe, prompt, neg_prompt)

# LoRA support (lines 762-791)
pipe.load_lora_weights(lora_path, adapter_name=adapter)
pipe.set_adapters(adapters, weights_list)

# Generation (lines 806-839)
images = pipe(
    prompt_embeds=prompt_embeds,
    negative_prompt_embeds=negative_embeds,
    pooled_prompt_embeds=pooled_embeds,
    negative_pooled_prompt_embeds=negative_pooled,
    height=896, width=1152,
    num_inference_steps=30,
    guidance_scale=7.5,
    generator=generator,
    output_type="latent"
).images

# Two-stage refinement (lines 841-871)
refined = refine_pipe(
    prompt_embeds=prompt_embeds,
    image=latent,
    num_inference_steps=10,
    strength=0.3,
    guidance_scale=7.5
).images[0]
```

**Interface Needed** (`src/providers/flux-image-provider.js`):
```javascript
class FluxImageProvider {
  async generateImage(prompt, options = {}) {
    // options.height, width, steps, guidance, seed
    // options.lora: LoRA configuration
    // options.negativePrompt
    // Returns: { localPath, metadata }
  }
}
```

**Porting Strategy**:
- FastAPI service wrapping the SDXL pipeline
- HTTP endpoints for generation
- Stream progress updates via SSE
- File-based return (local paths)

### 3. Vision Provider (CLIP + Aesthetics)

**Source**: `diffusion-python/generate-candidates.py` (lines 287-317, 883-917)

**Current Implementation**:
```python
from transformers import CLIPProcessor, CLIPModel
from aesthetic_predictor_v2_5 import convert_v2_5_from_siglip

# CLIP for semantic alignment (lines 307-308, 903-907)
clip_proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")

clip_inputs = clip_proc(images=img, text=prompt, return_tensors="pt")
image_embeds = clip_model.get_image_features(clip_inputs.pixel_values)
text_embeds = clip_model.get_text_features(clip_inputs.input_ids)
clip_score = (image_embeds / image_embeds.norm() *
              text_embeds / text_embeds.norm()).sum().item() * 100

# Aesthetic scoring (lines 289-292, 910-917)
aes_model, aes_preprocessor = convert_v2_5_from_siglip(
    low_cpu_mem_usage=True,
    trust_remote_code=True
)
aes_inputs = aes_preprocessor(images=img, return_tensors="pt")
aes_score = aes_model(aes_inputs.pixel_values).logits.squeeze().item()

# Captioning for critique (lines 302-305, 883-900)
from transformers import VisionEncoderDecoderModel, ViTImageProcessor
cap_model = VisionEncoderDecoderModel.from_pretrained(
    "nlpconnect/vit-gpt2-image-captioning"
)
caption = cap_model.generate(image_features)
```

**Interface Needed** (`src/providers/local-vision-provider.js`):
```javascript
class LocalVisionProvider {
  async analyzeImage(imageUrl, prompt, options = {}) {
    // Returns:
    // {
    //   alignmentScore: 0-100,  // CLIP score
    //   aestheticScore: 0-10,    // Aesthetic predictor
    //   analysis: string,        // Caption for critique
    //   strengths: string[],
    //   weaknesses: string[]
    // }
  }
}
```

**Porting Strategy**:
- FastAPI service with all three models loaded
- Single HTTP endpoint accepting image + prompt
- Returns combined scoring

## Architecture Integration

### Provider Factory Updates

**File**: `src/factory/provider-factory.js`

Add cases for local providers:

```javascript
function createLLMProvider(options = {}) {
  const mode = options.mode || config.mode;
  if (mode === 'mock') return new MockLLMProvider();

  const provider = options.provider || config.llm.provider;
  switch (provider) {
    case 'openai':
      return new OpenAILLMProvider(apiKey, {...options});
    case 'ollama':
      return new OllamaLLMProvider({
        baseUrl: config.ollama.baseUrl,
        model: config.ollama.model,
        ...options
      });
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

function createImageProvider(options = {}) {
  const mode = options.mode || config.mode;
  if (mode === 'mock') return new MockImageProvider();

  const provider = options.provider || config.image.provider;
  switch (provider) {
    case 'openai':
      return new OpenAIImageProvider(apiKey, {...options});
    case 'flux':
      return new FluxImageProvider({
        apiUrl: config.flux.apiUrl,
        ...options
      });
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }
}

function createVisionProvider(options = {}) {
  const mode = options.mode || config.mode;
  if (mode === 'mock') return new MockVisionProvider();

  const provider = options.provider || config.vision.provider;
  switch (provider) {
    case 'openai':
      return new OpenAIVisionProvider(apiKey, {...options});
    case 'local':
      return new LocalVisionProvider({
        apiUrl: config.localVision.apiUrl,
        ...options
      });
    default:
      throw new Error(`Unknown vision provider: ${provider}`);
  }
}
```

### Configuration Updates

**File**: `src/config/provider-config.js`

Add local provider configuration:

```javascript
module.exports = {
  mode: process.env.PROVIDER_MODE || 'real',

  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    // ... existing OpenAI config ...
  },

  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'capybarahermes-2.5-mistral-7b',
  },

  image: {
    provider: process.env.IMAGE_PROVIDER || 'openai',
    // ... existing OpenAI config ...
  },

  flux: {
    apiUrl: process.env.FLUX_API_URL || 'http://localhost:8001',
    model: process.env.FLUX_MODEL || 'auraRENDERXL_v30',
    loras: process.env.FLUX_LORAS ? JSON.parse(process.env.FLUX_LORAS) : [],
  },

  vision: {
    provider: process.env.VISION_PROVIDER || 'openai',
    // ... existing OpenAI config ...
  },

  localVision: {
    apiUrl: process.env.LOCAL_VISION_API_URL || 'http://localhost:8002',
    clipModel: process.env.CLIP_MODEL || 'openai/clip-vit-base-patch32',
    aestheticModel: process.env.AESTHETIC_MODEL || 'aesthetic_predictor_v2_5',
  },
};
```

## Python Service Wrappers

### Option 1: FastAPI HTTP Services (Recommended)

Create three FastAPI services:

1. **LLM Service** (`python-services/llm-service.py`)
2. **Image Generation Service** (`python-services/flux-service.py`)
3. **Vision Service** (`python-services/vision-service.py`)

Each service:
- Loads models on startup
- Exposes HTTP endpoints
- Handles concurrent requests
- GPU memory management

### Option 2: Direct Subprocess Integration

Call Python scripts directly from Node.js:
- Simpler but less efficient
- No persistent model loading
- Higher latency per request

**Recommendation**: Use FastAPI services for production, subprocess for development.

## Implementation Plan

### Phase 1: Vision Provider (Lowest Risk)
1. Port CLIP + aesthetic scoring to FastAPI service
2. Create `LocalVisionProvider` class
3. Add factory and config support
4. Test with existing beam search

### Phase 2: LLM Provider (Medium Risk)
1. Port LLM functions to FastAPI service
2. Create `OllamaLLMProvider` class
3. Update factory and config
4. Test prompt expansion/refinement

### Phase 3: Image Provider (Highest Risk)
1. Port SDXL pipeline to FastAPI service
2. Create `FluxImageProvider` class
3. Handle image streaming/storage
4. LoRA support and configuration

### Phase 4: Integration Testing
1. Run full beam search with local providers
2. Performance benchmarking
3. Cost comparison (GPU time vs API costs)
4. Documentation

## Dependencies

### Python Service Requirements
```txt
torch>=2.1.0
diffusers>=0.25.0
transformers>=4.36.0
accelerate>=0.25.0
llama-cpp-python>=0.2.0
fastapi>=0.108.0
uvicorn>=0.25.0
pillow>=10.1.0
```

### Node.js Requirements
```json
{
  "axios": "^1.6.0",
  "form-data": "^4.0.0"
}
```

## Configuration Example

```env
# Local provider mode
PROVIDER_MODE=real
LLM_PROVIDER=ollama
IMAGE_PROVIDER=flux
VISION_PROVIDER=local

# Ollama/LLM config
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=capybarahermes-2.5-mistral-7b

# Flux/Image config
FLUX_API_URL=http://localhost:8001
FLUX_MODEL=auraRENDERXL_v30
FLUX_LORAS='[{"path":"models/lora/fr4z3tt4.safetensors","trigger":"fr4z3tt4, frazetta style","weights":[0.3,0.7]}]'

# Local vision config
LOCAL_VISION_API_URL=http://localhost:8002
CLIP_MODEL=openai/clip-vit-base-patch32
```

## Performance Considerations

### GPU Memory Requirements
- **SDXL Pipeline**: ~8-12GB VRAM
- **LLM (7B quantized)**: ~4-6GB VRAM
- **CLIP + Aesthetics**: ~2GB VRAM
- **Total**: 14-20GB VRAM minimum

**Strategy**: Sequential loading or multi-GPU setup

### Latency Expectations
- **OpenAI API**: 2-5 seconds per image
- **Local SDXL**: 10-30 seconds per image (depending on GPU)
- **LLM Operations**: 1-3 seconds
- **Vision Analysis**: <1 second

### Cost Comparison
- **OpenAI**: $0.04-0.08 per image + $0.002 per LLM call
- **Local**: GPU electricity + hardware depreciation
- **Break-even**: ~500-1000 images/month

## References

- **Source Project**: `~/code/diffusion-python/`
- **Main Implementation**: `generate-candidates.py` (1020 lines)
- **LLM Integration**: `llm-test.py` (276 lines)
- **HITL Ranking**: `rank.py` (442 lines)
- **Simple Pipeline**: `diffusion-pipeline.py` (207 lines)

## Next Steps

1. Review this porting guide for accuracy
2. Decide on FastAPI vs subprocess approach
3. Set up Python virtual environment
4. Port vision provider first (lowest risk)
5. Incremental testing with beam search
