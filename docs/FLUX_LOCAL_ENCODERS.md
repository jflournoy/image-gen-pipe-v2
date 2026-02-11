# CustomModel Model with Local Flux .1 Dev Encoders

This document describes how to use the CustomModel Flux model with locally-downloaded Flux .1 Dev encoders to avoid shape mismatch errors.

## Problem Statement

Weight-only Flux checkpoints like CustomModel contain only the transformer weights and lack text encoders (CLIP-L) and VAE. The service attempted to load fallback encoders from HuggingFace, which caused tensor shape mismatches:

```
mat1 and mat2 shapes cannot be multiplied (512x768 and 4096x3072)
```

**Solution**: Use the official Flux .1 Dev text encoders locally to ensure compatibility.

## Files Required

All files must be placed in `services/encoders/`:

| File | Source | Purpose |
|------|--------|---------|
| `clip_l.safetensors` | Flux .1 Dev official | CLIP-L text encoder (~1.7 GB) |
| `t5xxl_fp8_e4m3fn.safetensors` | Flux .1 Dev official | T5-XXL text encoder (FP8 quantized, ~2.5 GB) |

The CustomModel checkpoint goes in `services/checkpoints/`:
- `flux-dev-fp8.safetensors` (~10.7 GB)

## Environment Variables

Configure these in `.env` or when starting the service:

```bash
# Main model (weight-only checkpoint)
FLUX_MODEL_PATH=services/checkpoints/flux-dev-fp8.safetensors

# Local text encoders (required for CustomModel)
FLUX_TEXT_ENCODER_PATH=services/encoders/clip_l.safetensors
FLUX_TEXT_ENCODER_2_PATH=services/encoders/t5xxl_fp8_e4m3fn.safetensors

# Optional: VAE (falls back to Flux .1 Dev if not set)
# FLUX_VAE_PATH=services/encoders/ae.safetensors

# Clear any LoRA settings to avoid adapter conflicts
FLUX_LORA_PATH=
FLUX_LORA_SCALE=
```

## Testing

### 1. Verify Files Exist

```bash
npm test -- test/flux-custom-model-encoders.test.js
```

Expected: All file existence checks pass ✓

### 2. Manual Integration Test

```bash
# Terminal 1: Start Flux service
export FLUX_MODEL_PATH=$(pwd)/services/checkpoints/flux-dev-fp8.safetensors
export FLUX_TEXT_ENCODER_PATH=$(pwd)/services/encoders/clip_l.safetensors
export FLUX_TEXT_ENCODER_2_PATH=$(pwd)/services/encoders/t5xxl_fp8_e4m3fn.safetensors

cd services && python3 flux_service.py
```

Wait for output:
```
[Flux Service] Using local model: /path/to/flux-dev-fp8.safetensors
[Flux Service] Loading text encoders...
[Flux Service] Loading CLIP-L from local path: /path/to/clip_l.safetensors
[Flux Service] Loading T5-XXL from local path: /path/to/t5xxl_fp8_e4m3fn.safetensors
```

### 3. Test Generation

```bash
# Terminal 2: Send test request
curl -X POST http://localhost:8001/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a simple test image",
    "height": 512,
    "width": 512,
    "steps": 1,
    "guidance": 3.5
  }'
```

Expected: Success without shape mismatch errors ✓

## Troubleshooting

### Error: "Cannot access gated repo"
- Cause: HF_TOKEN not set or invalid
- Fix: `export HF_TOKEN=hf_your_token_here`

### Error: "mat1 and mat2 shapes cannot be multiplied"
- Cause: Wrong encoder versions or corrupted files
- Fix: Verify encoder files match Flux .1 Dev spec (see File Sizes below)

### Error: "T5-XXL not available, falling back to google-t5/t5-base"
- Cause: FLUX_TEXT_ENCODER_2_PATH not set or file not found
- Fix: Check path exists and file is readable

### Error: "Adapter name(s) {'transformer'} not in list of present adapters"
- Cause: LoRA configured but not compatible with model
- Fix: Clear LoRA settings (set to empty in .env)

## File Sizes (For Verification)

```
CLIP-L:     ~1.70 GB
T5-XXL FP8: ~2.50 GB
CustomModel: ~10.7 GB
Total:      ~14.9 GB
```

## Architecture Notes

The Flux service configuration priority:

1. **FLUX_MODEL_PATH** (if set and file exists) - uses weight-only checkpoint
   - Falls back to FLUX_MODEL if path doesn't exist or is invalid
2. **FLUX_TEXT_ENCODER_PATH** (if set and file exists) - uses local CLIP-L
   - Falls back to stabilityai/stable-diffusion-3-medium, then openai/clip-vit-large-patch14
3. **FLUX_TEXT_ENCODER_2_PATH** (if set and file exists) - uses local T5-XXL
   - Falls back to comfyanonymous/flux_text_encoders, then google-t5/t5-base

This graceful fallback pattern ensures generation always works, even if local encoders are misconfigured.

## Integration with Main Codebase

Once tested and validated, this configuration can be:

1. Added to `.env.example` with commented examples
2. Documented in `services/README.md` under "Custom Models"
3. Integrated into the UI settings modal (already supports FLUX_MODEL_PATH)
4. Used as a reference pattern for other weight-only Flux models

## References

- [Flux .1 Dev Model Card](https://huggingface.co/black-forest-labs/FLUX.1-dev)
- [Flux Architecture](https://github.com/black-forest-labs/flux)
- CustomModel Model: https://civitai.com/models/...
