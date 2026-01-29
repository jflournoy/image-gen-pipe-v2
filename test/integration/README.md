# GPU Integration Tests

## Current Status: One Flux Test DISABLED

**Problem**: Tests were running in **parallel**, causing multiple simultaneous Flux loads → RAM OOM.

### Root Cause: Parallel Test Execution

Node.js test runner defaults to `--test-concurrency=20` (one per CPU core). When GPU tests ran:

1. **Test 1** starts → Flux loads (20GB RAM spike)
2. **Test 2** starts **simultaneously** → Second Flux load (another 20GB spike)
3. **Combined**: 40-50GB RAM usage → **OOM** → desktop crash

### The Fix

**Sequential execution**: GPU tests now run with `--test-concurrency=1` (one at a time).

```bash
npm run test:gpu  # Now runs tests sequentially
```

### Flux RAM Usage (Per Load)

Flux.1-dev with sequential CPU offload per load:
- ~10-15GB for checkpoint shards loading to CPU RAM
- ~10GB GPU VRAM once loaded
- Total: ~20-25GB combined during load
- Load time: ~7 minutes (2 shards + 7 pipeline components)

## Test Hierarchy

### ✅ ENABLED: VLM-only tests (safe)

```bash
npm run test:gpu
```

Runs only the VLM ensemble test with static ImageMagick images:
- No Flux involvement
- No GPU model swaps
- Uses 2 simple colored squares (red vs blue)
- Tests ensemble voting (ensembleSize=3) stability
- **Safe for your desktop**

### ⚠️ PARTIALLY ENABLED: Flux integration tests

**Enabled** (safe with sequential execution):
- **Ensemble with Flux**: Generate images once, then VLM ensemble (ensembleSize=3)

**Still disabled** (multiple model swaps):
- **Full pipeline test**: VLM → Flux → VLM → Flux (causes multiple reloads)
- To enable: Set `ENABLE_FLUX_TESTS=1`

```bash
# Safe: Single Flux load + VLM ensemble test
npm run test:gpu

# Advanced: Enable full pipeline test (multiple Flux reloads)
ENABLE_GPU_TESTS=1 ENABLE_FLUX_TESTS=1 npm run test:gpu
```

## Solutions for Flux RAM Issue

### Option 1: Keep Flux Loaded (Recommended)
Don't unload Flux between generations. Modify model coordinator to:
- Load Flux once at service start
- Keep it resident (don't swap to VLM)
- Use a separate GPU or queue for VLM

**Pros**: No reload overhead, no RAM spikes
**Cons**: Can't run VLM and Flux simultaneously (12GB GPU)

### Option 2: Use Smaller Model
Switch to FLUX.1-schnell (4x smaller):
- ~2.5GB model vs 10GB
- Faster load times (~1-2 min vs 7+ min)
- Lower quality outputs

### Option 3: Increase System RAM
Not practical, but 128GB would give more headroom.

### Option 4: Disable Sequential CPU Offload
Load entire model to GPU (requires 16GB+ VRAM):
- You have 12GB, would need RTX 4080/4090
- Eliminates CPU RAM usage
- Faster inference

## Running Tests Safely

**VLM-only ensemble test** (recommended):
```bash
# Enable persistence mode first
sudo nvidia-smi -pm 1

# Start only VLM service
npm run services:start:vlm

# Run VLM-only test
ENABLE_GPU_TESTS=1 npm run test:gpu
```

**Monitor GPU during test**:
```bash
npm run gpu:monitor
```

## Test Details

### VLM-only Test
- **File**: `test/integration/vlm-ranking-pipeline.test.js`
- **Test**: "should complete ensemble voting with pre-existing images (VLM-only, no Flux reload)"
- **What it does**:
  1. Creates 2 test images with ImageMagick (512x512 colored squares)
  2. Loads VLM model
  3. Runs ensemble voting (3 sequential comparisons)
  4. Logs GPU VRAM before/after
  5. Verifies no crashes, proper ensemble info in output

### Expected Output
```
[Test] VLM-only ensemble test with static images
[Test] Persistence Mode                      : Enabled
[Test]   Created test image: /tmp/vlm-test-123-0.png
[Test]   Created test image: /tmp/vlm-test-123-1.png
[Test] GPU VRAM before VLM: 1322 MB
[Test] Running VLM ensemble ranking (ensembleSize=3)...
[Test]   Comparison 1/1: static0 vs static1 → ok
[Test] GPU VRAM after VLM: 6543 MB (delta: +5221 MB)
[Test]   Winner: static0 — Rank 1 with 1/1 wins (3x ensemble voting)
✓ Test passed
```

## Future Work

Once RAM issue is solved, re-enable Flux tests to verify:
- Full VLM → Flux → VLM pipeline
- Multiple rounds with model swaps
- Ensemble voting with real generated images
