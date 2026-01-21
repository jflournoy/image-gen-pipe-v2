# Encoder Loading Debug Guide

## Problem: Matrix Multiplication Errors with Custom Checkpoints

When using custom local checkpoints (e.g., from CivitAI), you may see errors like:
```
mat1 and mat2 shapes cannot be multiplied (512x768 and 4096x3072)
```

This happens because **custom checkpoints require matching encoders**, and the HuggingFace fallback encoders have incompatible architectures.

## Solution: Strict Local Encoder Mode

The system now enforces **strict local encoder mode** for custom checkpoints:

### When Using Local Checkpoints

1. **No Fallback** - System will NOT fall back to HuggingFace encoders
2. **Clear Errors** - You'll get a clear error message if encoders are missing
3. **Debug Info** - Detailed logging shows exactly what's happening

### Expected Log Output (Success)

```
[Flux Service] 🔒 LOCAL CHECKPOINT DETECTED
[Flux Service] Requiring local encoders - HuggingFace fallback DISABLED
[Flux Service] This prevents architecture mismatches with custom models
[Flux Service] ⚠️ STRICT MODE: Using local checkpoint - local encoders are REQUIRED
[Flux Service] CLIP-L path: services/encoders/clip_l.safetensors
[Flux Service] T5-XXL path: services/encoders/model.safetensors
[Flux Service] VAE path: services/encoders/ae.safetensors
[Flux Service] Loading CLIP-L from local path: services/encoders/clip_l.safetensors
[Flux Service] Path verified to exist, loading CLIP-L...
[Flux Service] ✓ Successfully loaded local CLIP-L encoder
[Flux Service]   - Type: CLIPTextModel
[Flux Service]   - Dtype: torch.float16
[Flux Service] Loading T5-XXL from local path: services/encoders/model.safetensors
[Flux Service] Path verified to exist, loading T5-XXL...
[Flux Service] ✓ Successfully loaded local T5-XXL encoder
[Flux Service]   - Type: T5EncoderModel
[Flux Service]   - Dtype: torch.float16
```

### Expected Log Output (Error)

```
[Flux Service] 🔒 LOCAL CHECKPOINT DETECTED
[Flux Service] Requiring local encoders - HuggingFace fallback DISABLED
[Flux Service] ⚠️ STRICT MODE: Using local checkpoint - local encoders are REQUIRED
[Flux Service] CLIP-L path: services/encoders/clip_l.safetensors
[Flux Service] T5-XXL path: NOT SET
[Flux Service] Loading CLIP-L from local path: services/encoders/clip_l.safetensors
[Flux Service] ENCODER ERROR: CLIP-L file not found at: services/encoders/clip_l.safetensors
[Flux Service] Current working directory: /home/user/image-gen-pipe-v2
[Flux Service] Absolute path: /home/user/image-gen-pipe-v2/services/encoders/clip_l.safetensors
[Flux Service] ❌ CRITICAL: Local encoders required for custom checkpoint but failed to load
[Flux Service] Cannot fall back to HuggingFace encoders - they may cause dimension mismatches

RuntimeError: Local encoder loading failed: ENCODER ERROR: CLIP-L file not found
Custom checkpoint requires matching encoders. Please ensure encoder files exist at the configured paths.
```

## How to Fix Encoder Errors

### Option 1: Use HuggingFace Model Instead

If you don't have the right encoders, switch to the standard HuggingFace model:

1. In UI Settings, select **"HuggingFace"** as Flux Model Source
2. System will download FLUX.1-dev with compatible encoders automatically

### Option 2: Get Matching Encoders for Your Checkpoint

You need three encoder files that match your checkpoint:

1. **CLIP-L** (`clip_l.safetensors`) - ~246MB
2. **T5-XXL** (`model.safetensors` + `config.json`) - ~10GB
3. **VAE** (`ae.safetensors`) - ~335MB

**Where to get them:**
- From the same source as your checkpoint (CivitAI, HuggingFace)
- From the checkpoint's documentation/requirements
- Extract from another Flux model that works with your checkpoint

**Where to place them:**
```
services/encoders/
├── clip_l.safetensors
├── model.safetensors
├── config.json
└── ae.safetensors
```

### Option 3: Let UI Auto-Configure

When you select "Local Mode" or switch to "Local File" model source, the UI automatically:
- Sets encoder paths to `services/encoders/`
- Enables "Use Local Encoders"
- Shows you what paths it expects

## Debugging Checklist

### 1. Check Encoder Paths Are Set

```bash
# In your .env or check localStorage in browser
FLUX_TEXT_ENCODER_PATH=services/encoders/clip_l.safetensors
FLUX_TEXT_ENCODER_2_PATH=services/encoders/model.safetensors
FLUX_VAE_PATH=services/encoders/ae.safetensors
```

### 2. Verify Files Exist

```bash
ls -lh services/encoders/
# Should show:
# clip_l.safetensors (~246MB)
# model.safetensors (~10GB)
# config.json (small JSON file)
# ae.safetensors (~335MB)
```

### 3. Check File Permissions

```bash
# Files should be readable
stat services/encoders/clip_l.safetensors
```

### 4. Check Service Logs

Look for these patterns in the Flux service logs:
- `🔒 LOCAL CHECKPOINT DETECTED` - Strict mode enabled
- `✓ Successfully loaded local` - Encoder loaded correctly
- `❌ CRITICAL` - Encoder loading failed
- `⚠️ WARNING: Falling back` - Should NOT see this for local checkpoints

### 5. Test with Standard Model First

If unsure, test with HuggingFace FLUX.1-dev first:
```bash
# This should always work
curl http://localhost:8001/health
# Should show: "model_source": "huggingface"
```

## Technical Details

### Why No Fallback for Local Checkpoints?

Custom checkpoints (especially from CivitAI) often have:
- Different hidden dimensions
- Custom attention mechanisms
- Modified architectures
- Specialized fine-tuning

Using standard FLUX.1-dev encoders causes:
- Dimension mismatches → matrix multiplication errors
- Architecture incompatibilities → generation failures
- Silent degradation → poor quality outputs

**Better to fail fast with clear error than generate broken images.**

### Encoder Architecture Overview

```
┌─────────────────┐
│  User Prompt    │
└────────┬────────┘
         │
    ┌────▼─────┐
    │  CLIP-L  │ Text Encoder 1 (77 tokens)
    └────┬─────┘
         │
    ┌────▼─────┐
    │  T5-XXL  │ Text Encoder 2 (512 tokens)
    └────┬─────┘
         │
    ┌────▼─────────┐
    │ Flux UNet    │ ← Custom checkpoint
    └────┬─────────┘
         │
    ┌────▼─────┐
    │   VAE    │ Image Decoder
    └──────────┘
```

All components must have compatible dimensions, or matrix multiplications fail.

## Related Files

- [encoder_loading.py](../services/encoder_loading.py) - Encoder loading logic
- [flux_service.py](../services/flux_service.py) - Flux service using encoders
- [demo.js](../public/demo.js) - UI auto-configuration
- [.env](.env) - Encoder path configuration

## Quick Reference

| Symptom | Cause | Solution |
|---------|-------|----------|
| `mat1 and mat2 shapes cannot be multiplied` | Wrong encoders for checkpoint | Get matching encoders or use HF model |
| `ENCODER ERROR: file not found` | Encoder files missing | Place files in `services/encoders/` |
| `Path does not exist` | Wrong path or working directory | Use absolute paths or relative to project root |
| Service won't start | Python module import errors | Check `services/` directory structure |

## Getting Help

If you're still stuck:
1. Check the service logs: `tail -f /tmp/beam-search-services/flux.log`
2. Verify all 3 encoder files exist and are the right size
3. Try with HuggingFace model first to isolate the issue
4. Check if your checkpoint documentation specifies required encoders
