# Face Fixing

Enhance portraits and close-ups with multi-stage face fixing: **detection → restoration → optional upscaling**.

Face fixing uses **GFPGAN** (by default) for fast, high-quality face enhancement.

**⚠️ Current Status**: GFPGAN dependencies have compatibility issues with torchvision/basicsr. Face fixing is integrated but currently disabled. See [Troubleshooting - Dependencies](#troubleshooting---dependencies) below.

## Quick Start

### Enable Face Fixing in Image Generation

```javascript
// Generate portrait with face fixing enabled
const result = await imageProvider.generateImage(
  'professional headshot of a woman, studio lighting',
  {
    fix_faces: true,              // Enable face fixing
    face_fidelity: 0.7,           // Balance quality vs identity (0.0-1.0)
    // face_upscale: 2            // Optional: 2x upscaling (slower)
  }
);

console.log(result.metadata.face_fixing);
// {
//   applied: true,
//   faces_count: 1,
//   fidelity: 0.7,
//   upscale: 1,
//   time: 3.25  // processing time in seconds
// }
```

### Multi-face Scene

```javascript
// Works with multiple faces in image
const result = await imageProvider.generateImage(
  'family portrait, 4 people smiling at camera',
  {
    fix_faces: true,
    face_fidelity: 0.6,  // slightly less strict for group photos
  }
);
```

### Upscaling (Advanced)

```javascript
// Combine face fixing with 2x upscaling
const result = await imageProvider.generateImage(
  'detailed portrait, studio lighting',
  {
    fix_faces: true,
    face_fidelity: 0.7,
    face_upscale: 2      // 2x upscaling via Real-ESRGAN
  }
);
// Processing time: ~8-12s (vs ~3s without upscaling)
```

## Parameters

### `fix_faces` (boolean, default: `false`)

Enable or disable face fixing post-processing.

- `true` - Apply face fixing to detected faces
- `false` - Skip face fixing (default, faster)

**Recommendation**: Only enable for portrait-focused generations where faces are important.

### `face_fidelity` (float, default: `0.7`)

CodeFormer's fidelity parameter controlling the balance between enhancement quality and identity preservation.

Range: `0.0` to `1.0`

- **0.0** - Maximum enhancement quality (faces look very polished, may change appearance)
- **0.3-0.5** - High quality with some identity change (best for fixing poor generations)
- **0.7** - Balanced (recommended, default)
- **0.9+** - Maximum identity preservation (minimal enhancement)
- **1.0** - No enhancement, only cleanup

**Recommendations by use case**:
- Fixing blurry/artifacted faces: `0.3-0.5` (prioritize quality)
- General portraits: `0.6-0.8` (balanced)
- Celebrity/specific identity: `0.85-1.0` (preserve identity)

### `face_upscale` (integer, optional)

Optional upscaling factor using Real-ESRGAN.

- `null` or undefined - No upscaling (default, ~3s processing)
- `1` - Same as no upscaling
- `2` - 2x upscaling (~8-10s processing)

**Note**: Only `2x` is supported. Higher factors significantly increase processing time.

## How It Works

Face fixing is a multi-stage pipeline:

### 1. Detection

**MediaPipe Face Detection** identifies all faces in the image.

- CPU-optimized, very fast (~100ms per image)
- Handles faces at various distances and angles
- Returns bounding boxes for each detected face

**What happens if no faces detected?**
- Returns original image unchanged
- Metadata: `{applied: false, reason: 'no_faces_detected'}`
- No performance penalty

### 2. Restoration

Face enhancement using one of two models:

**GFPGAN (Default)**
- Fast, high-quality face enhancement
- Deblurs, denoises, and restores face details
- Fixes artifacts from diffusion generation
- Processing time: ~1-2 seconds per face
- Works out of the box with no additional setup

**CodeFormer (Optional, Higher Quality)**
- State-of-the-art restoration with identity awareness
- Controllable quality vs. identity preservation trade-off
- Better on challenging cases and extreme angles
- Processing time: ~2-3 seconds per face
- Requires manual installation from GitHub

**How fidelity works** (CodeFormer only):
- CodeFormer has a learned trade-off between visual quality and identity preservation
- Lower fidelity (0.0) → prioritizes restoring fine details (may change appearance)
- Higher fidelity (1.0) → preserves original appearance (minimal changes)
- `0.7` default provides good balance for most cases
- GFPGAN ignores this parameter (fixed enhancement strength)

### 3. Optional Upscaling

**Real-ESRGAN 2x** intelligently upscales the entire image with face awareness.

- Processes in tiles to save GPU memory
- Preserves enhanced face details
- Processing time: ~3-5 seconds
- Creates 2048x2048 from 1024x1024 (or proportional)

## Performance Characteristics

### Processing Time

Typical portrait generation with face fixing:

| Configuration | GFPGAN | CodeFormer |
|---|---|---|
| No face fixing | ~2s | ~2s |
| Face fixing (1 face, no upscale) | ~3-4s | ~5-6s |
| Face fixing (1 face, 2x upscale) | ~8-9s | ~10-12s |
| Face fixing (3 faces, 2x upscale) | ~12-15s | ~15-18s |

**Modal Service (A10G 24GB)**:
- Detection: ~100ms (CPU)
- GFPGAN enhancement: ~1-2s per face (GPU, default)
- CodeFormer enhancement: ~2-3s per face (GPU, optional)
- Real-ESRGAN 2x upscaling: ~3-5s (GPU)
- Models loaded alongside Flux/SDXL (plenty of VRAM)

**Local Flux Service (12GB GPU)**:
- Detection: ~100ms (CPU)
- GFPGAN enhancement: ~1-2s per face (GPU, default)
- CodeFormer enhancement: ~2-3s per face (GPU, optional)
- Real-ESRGAN 2x upscaling: ~3-5s (GPU)
- Models unloaded and reloaded to fit in GPU memory
- First face fixing request may take longer due to model loading

### GPU Memory

Face fixing models require minimal GPU memory:

- **MediaPipe**: ~5MB (CPU)
- **GFPGAN**: ~330MB (GPU, default)
- **CodeFormer**: ~370MB (GPU, optional)
- **Real-ESRGAN 2x**: ~17MB (GPU)
- **Working memory**: ~500MB during processing
- **Total peak with GFPGAN**: ~850MB (safe on 12GB and 24GB GPUs)
- **Total peak with CodeFormer**: ~900MB (safe on 12GB and 24GB GPUs)

## Limitations

Face fixing works best on:

- **Clear, forward-facing portraits** - High quality results
- **Multiple faces in scene** - All detected faces enhanced
- **Close-ups and medium shots** - Face large enough to enhance

Face fixing has lower quality on:

- **Side angles, extreme poses** - May miss or poorly enhance
- **Very small faces** - Insufficient pixels for restoration
- **Partially occluded faces** - Incomplete face detection/restoration
- **Heavily stylized/artistic images** - CodeFormer designed for photorealism

**What if faces are not detected?**
- Image returned unchanged
- No error, just a metadata note: `{applied: false, reason: 'no_faces_detected'}`
- Common for landscape images, abstract art, or images without faces

## Best Practices

### 1. Use for Portrait-Focused Generations

Face fixing adds 5-15 seconds of processing. Only enable when faces are important:

```javascript
// Good: explicit portrait request
generateImage(
  'professional headshot, studio lighting, high quality',
  { fix_faces: true }
);

// Avoid: landscape with small background figures
generateImage(
  'beautiful landscape with people in distance',
  { fix_faces: false }  // Don't bother
);
```

### 2. Adjust Fidelity by Use Case

```javascript
// Professional headshots - preserve identity
generateImage(
  'corporate portrait of John, CEO',
  { fix_faces: true, face_fidelity: 0.85 }
);

// Fixing poor generations - prioritize quality
generateImage(
  'beautiful portrait, high quality',
  { fix_faces: true, face_fidelity: 0.5 }
);

// Artistic portraits - balanced
generateImage(
  'elegant portrait, soft lighting',
  { fix_faces: true, face_fidelity: 0.7 }
);
```

### 3. Decide if Upscaling is Worth It

2x upscaling adds ~5-8 seconds. Consider:

```javascript
// Worth it: Small image (512x512) needs quality boost
generateImage(prompt, {
  fix_faces: true,
  width: 512,
  height: 512,
  face_upscale: 2  // 1024x1024 output
});

// Skip it: Already generating large image
generateImage(prompt, {
  fix_faces: true,
  width: 1024,
  height: 1024,
  face_upscale: null  // 1024x1024 is enough
});
```

### 4. Combine with Generation Settings

```javascript
// Portrait optimization
const portraitSettings = {
  model: 'flux-dev',
  steps: 40,              // Higher steps for face quality
  guidance: 3.5,
  width: 1024,
  height: 1024,
  fix_faces: true,        // Enable face fixing
  face_fidelity: 0.7,
  // Skip upscaling - already high resolution
};
```

## Troubleshooting

### Dependencies - GFPGAN Not Available

**Problem**: Face fixing is enabled but faces are not being enhanced

**Current Issue**: GFPGAN has a dependency conflict with torchvision/basicsr. The face fixing feature is architecturally complete but currently unable to load the enhancement models.

**Error**: `ModuleNotFoundError: No module named 'torchvision.transforms.functional_tensor'`

**Workaround**: The system will gracefully degrade - when enhancement models aren't available, the original faces are returned unchanged. The API still works, it just skips the enhancement step.

**Next Steps**:
1. We can revisit this when the basicsr/GFPGAN/torchvision dependency ecosystem stabilizes
2. Alternative approaches:
   - Use a simpler enhancement method (PIL/OpenCV filters)
   - Switch to a different face enhancement library
   - Use conda instead of pip/uv for dependency management

If you'd like to prioritize fixing this, let us know!

### Faces Not Detected

**Problem**: Face fixing applied but `faces_count: 0`

**Solutions**:
1. Ensure faces are large and relatively centered
2. Try adjusting the prompt to generate clearer faces
3. Increase image resolution (more pixels = easier detection)
4. Check that faces are not extremely angled

**Example**:
```javascript
// ❌ Might fail - faces too small/far
'landscape with people on horizon'

// ✅ Better - faces prominent
'close-up portrait of a person smiling'
```

### Face Fixing is Slow

**Problem**: Processing takes too long

**Solutions**:
1. Disable upscaling (`face_upscale: null` or undefined)
2. Only enable for images with 1-2 faces
3. Reduce generation size (e.g., 512x512 instead of 1024x1024)
4. Use Modal service instead of local Flux (faster, more VRAM)

### Poor Quality Enhancement

**Problem**: Faces look worse or over-processed

**Solutions**:
1. Increase `face_fidelity` (e.g., 0.85) to preserve identity
2. Lower `face_fidelity` (e.g., 0.5) if faces are too blurry
3. Disable upscaling to avoid artifacts
4. Generate with better source quality (higher steps/guidance)

### OOM or Service Error

**Problem**: "Out of memory" or service crashes during face fixing

**Solutions**:
1. Only use with 1-2 faces
2. Disable upscaling
3. Reduce image size
4. Use Modal service (24GB) instead of local Flux (12GB)
5. Restart the service

## Response Metadata

Face fixing metadata is included in the generation response:

```javascript
{
  metadata: {
    // ... other fields
    face_fixing: {
      applied: true,              // Was face fixing applied?
      faces_count: 1,             // Number of faces detected
      fidelity: 0.7,              // Fidelity parameter used
      upscale: 1,                 // Upscale factor (1=none, 2=2x)
      time: 3.45,                 // Processing time in seconds
      // If error occurred:
      // error: "error message"
    }
  }
}
```

**No faces detected**:
```javascript
{
  face_fixing: {
    applied: false,
    reason: 'no_faces_detected',
    faces_count: 0,
    time: 0.12
  }
}
```

**Error during processing**:
```javascript
{
  face_fixing: {
    applied: false,
    error: 'CUDA out of memory',
    time: 2.34
  }
}
```

## Advanced: Integration with Beam Search

When using beam search optimization with face fixing:

```javascript
// Beam search can use face fixing as part of evaluation
const beamSearchConfig = {
  // ... other settings
  evaluationOptions: {
    use_face_fixing: true,        // Fix faces for evaluation
    face_fidelity: 0.7,
    face_upscale: null,           // Skip upscaling for speed
  }
};
```

Face fixing adds processing time but can improve final selection quality for portrait-focused beam searches.

## Setup and Installation

### Dependencies

Face fixing dependencies are included in the project's `pyproject.toml`. Install with `uv`:

```bash
# Install all dependencies (includes GFPGAN by default)
uv sync
```

**Default Dependencies** (installed automatically):
- `mediapipe>=0.10.0` - Face detection
- `gfpgan>=0.3.0` - Fast, high-quality face restoration (default)
- `realesrgan>=0.3.0` - Real-ESRGAN upscaling

**Optional Upgrade to CodeFormer** (advanced, for highest quality):

CodeFormer offers superior quality but requires manual setup from source. Since the project uses `uv`, there are two clean approaches:

### Option 1: Install in Project Directory (Recommended)

```bash
# Clone CodeFormer as a subdirectory
git clone https://github.com/sczhou/CodeFormer ./vendor/CodeFormer

# Install dependencies in the uv environment
uv run pip install -r ./vendor/CodeFormer/requirements.txt
uv run python ./vendor/CodeFormer/basicsr/setup.py develop

# Verify
uv run python -c "from codeformer import CodeFormer; print('✅ CodeFormer available')"
```

**Note**: Add `vendor/CodeFormer/` to `.gitignore` to keep git clean:

```bash
echo "vendor/CodeFormer/" >> .gitignore
```

### Option 2: Install in Temporary Directory

```bash
# Clone to /tmp
cd /tmp
git clone https://github.com/sczhou/CodeFormer
cd CodeFormer

# Install in the uv environment
uv run pip install -r requirements.txt
uv run python basicsr/setup.py develop

# Back to project
cd ~/code/image-gen-pipe-v2
```

### Option 3: Activate venv and Install Normally

```bash
# Activate the uv-managed virtual environment
source .venv/bin/activate

# Clone and install (works with either directory option)
git clone https://github.com/sczhou/CodeFormer ./vendor/CodeFormer
cd ./vendor/CodeFormer
pip install -r requirements.txt
python basicsr/setup.py develop

# Back to project
cd ~/code/image-gen-pipe-v2
deactivate
```

### Verification

After installation (any method), verify CodeFormer is detected:

```bash
uv run python -c "from codeformer import CodeFormer; print('✅ CodeFormer available')"
```

**The system will automatically detect and use CodeFormer if it's installed, otherwise it falls back to GFPGAN.**

### Modal Deployment

The Modal container image is automatically updated with face fixing dependencies when the service is deployed:

```bash
modal deploy services/modal_diffusion_service.py
```

No additional setup needed - models download and cache on first use.

### Local Flux Service

Restart the Flux service after installing dependencies:

```bash
uv run python services/flux_service.py
```

Models will download to `~/.cache/` on first generation request (~400MB total).

## References

- **CodeFormer**: Generalist Face Restoration with Learned Token-based Dictionary (Zhou et al., 2023)
- **Real-ESRGAN**: Practical Blind Real-World Super-Resolution with Pure Convolutional Architectures and Adjust-ReNorm
- **MediaPipe Face Detection**: On-device, Real-time Face Detection

## Architecture Notes

Face fixing is implemented as:

1. **Modal Service** (`services/modal_diffusion_service.py`): Built-in face fixing with full VRAM headroom
2. **Flux Service** (`services/flux_service.py`): Face fixing with GPU memory coordination
3. **Core Pipeline** (`services/face_fixing.py`): Reusable multi-stage enhancement module
4. **JS Providers**: Modal and Flux providers transparently pass face fixing parameters

Models are lazy-loaded on first use to minimize startup time.
