/**
 * VLM Production Settings Test
 *
 * Tests the exact production scenario that caused crashes:
 * Flux → VLM → Flux → VLM with ensemble voting
 *
 * This test is designed to validate the fix for GPU fragmentation crashes
 * that occur when increasing context size from 2048 to 4096 for dual-image support.
 *
 * Usage:
 *   # Test with production settings (may crash if too much GPU memory)
 *   VLM_GPU_LAYERS=24 VLM_CONTEXT_SIZE=4096 node --test test/integration/vlm-production-settings.test.js
 *
 *   # Test with optimized settings (should work)
 *   VLM_GPU_LAYERS=16 VLM_CONTEXT_SIZE=4096 node --test test/integration/vlm-production-settings.test.js
 *
 * Expected results:
 * - 24 layers + 4096 context = ~12-13GB peak (may crash on 12GB GPU)
 * - 16 layers + 4096 context = ~10-11GB peak (should work on 12GB GPU)
 */

const assert = require('assert');
const { describe, it, before, after } = require('node:test');
const path = require('path');
const fs = require('fs');

const FluxImageProvider = require('../../src/providers/flux-image-provider.js');
const LocalVLMProvider = require('../../src/providers/local-vlm-provider.js');
const modelCoordinator = require('../../src/utils/model-coordinator.js');

const TEST_PROMPT = 'a serene mountain landscape at sunset';
const generatedFiles = [];

// Read current VLM settings from environment (defaults match production)
const VLM_GPU_LAYERS = process.env.VLM_GPU_LAYERS || '24';
const VLM_CONTEXT_SIZE = process.env.VLM_CONTEXT_SIZE || '4096';

console.log(`\n========================================`);
console.log(`🧪 VLM Production Settings Test`);
console.log(`========================================`);
console.log(`VLM_GPU_LAYERS: ${VLM_GPU_LAYERS}`);
console.log(`VLM_CONTEXT_SIZE: ${VLM_CONTEXT_SIZE}`);
console.log(`========================================\n`);

// GPU memory helper
function getGpuMemory() {
  try {
    const { execSync } = require('child_process');
    const output = execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits', { encoding: 'utf8' });
    return parseInt(output.trim(), 10);
  } catch {
    return null;
  }
}

describe('🎬 VLM Production Settings (Flux→VLM→Flux→VLM with ensemble)', { timeout: 600000 }, () => {
  let fluxProvider;
  let vlmProvider;

  before(async () => {
    console.log('[Test] Initializing providers...');
    fluxProvider = new FluxImageProvider({
      modelName: 'black-forest-labs/FLUX.1-schnell',
      numInferenceSteps: 1, // Fast generation for testing
      enableSequentialCpuOffload: true
    });

    vlmProvider = new LocalVLMProvider({
      baseURL: 'http://localhost:8004',
      defaultEnsembleSize: 3 // Production ensemble size
    });

    // Verify VLM service is running with correct settings
    const healthResponse = await fetch('http://localhost:8004/health');
    const health = await healthResponse.json();
    console.log(`[Test] VLM service status: ${health.status}`);
    console.log(`[Test] VLM GPU layers: ${health.gpu_layers}`);
    console.log(`[Test] VLM context size: ${health.context_size || 'unknown'}`);

    // Warn if settings don't match
    if (health.gpu_layers !== parseInt(VLM_GPU_LAYERS, 10)) {
      console.log(`[Test] ⚠️  WARNING: VLM service gpu_layers (${health.gpu_layers}) != test setting (${VLM_GPU_LAYERS})`);
      console.log(`[Test] ⚠️  Restart VLM service with: VLM_GPU_LAYERS=${VLM_GPU_LAYERS} python services/vlm_service.py`);
    }
  });

  after(async () => {
    console.log('[Test] Cleaning up generated files...');
    for (const file of generatedFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`[Test] Deleted: ${file}`);
        }
      } catch (err) {
        console.log(`[Test] Could not delete ${file}: ${err.message}`);
      }
    }

    // Unload all models
    console.log('[Test] Unloading all models...');
    await modelCoordinator.unloadAll();
  });

  it(`should complete Flux→VLM→Flux→VLM cycle with ${VLM_GPU_LAYERS} layers + ${VLM_CONTEXT_SIZE} context`, async () => {
    console.log('[Test] Starting production scenario test...');
    console.log('[Test] Scenario: Generate 2 images → Rank → Generate 2 more → Rank again');

    const memStart = getGpuMemory();
    console.log(`[Test] GPU VRAM at start: ${memStart || 'unknown'} MB`);

    // === ROUND 1: Flux generates 2 images ===
    console.log('\n[Test] ROUND 1: Generating first batch (2 images)...');
    const batch1 = await modelCoordinator.withImageGenOperation(async () => {
      const results = [];
      for (let i = 0; i < 2; i++) {
        console.log(`[Test]   Generating image i0c${i}...`);
        const result = await fluxProvider.generateImage(TEST_PROMPT, {
          seed: 1000 + i,
          width: 512,
          height: 512
        });
        results.push({
          candidateId: `i0c${i}`,
          localPath: result.localPath
        });
        generatedFiles.push(result.localPath);
      }
      return results;
    });

    const memAfterFlux1 = getGpuMemory();
    console.log(`[Test] GPU VRAM after Flux round 1: ${memAfterFlux1 || 'unknown'} MB`);
    assert.strictEqual(batch1.length, 2, 'Should generate 2 images in round 1');

    // === ROUND 1: VLM ranks batch 1 ===
    console.log('\n[Test] ROUND 1: Ranking first batch (ensemble=3)...');
    const ranking1 = await modelCoordinator.withVLMOperation(async () => {
      const progressEvents = [];
      const result = await vlmProvider.rankImages(batch1, TEST_PROMPT, {
        ensembleSize: 3,
        gracefulDegradation: true,
        onProgress: (data) => {
          progressEvents.push(data);
          const status = data.error ? `FAILED: ${data.errorMessage}` : 'ok';
          console.log(`[Test]   ${data.candidateA} vs ${data.candidateB} → ${status}`);
        }
      });

      const errors = progressEvents.filter(e => e.error);
      if (errors.length > 0) {
        console.log(`[Test] ⚠️  Round 1 had ${errors.length} comparison errors`);
      }

      return result;
    });

    const memAfterVLM1 = getGpuMemory();
    console.log(`[Test] GPU VRAM after VLM round 1: ${memAfterVLM1 || 'unknown'} MB`);
    assert.ok(ranking1.rankedImages.length > 0, 'Should rank images in round 1');

    // === ROUND 2: Flux generates 2 more images ===
    console.log('\n[Test] ROUND 2: Generating second batch (2 images)...');
    const batch2 = await modelCoordinator.withImageGenOperation(async () => {
      const results = [];
      for (let i = 0; i < 2; i++) {
        console.log(`[Test]   Generating image i1c${i}...`);
        const result = await fluxProvider.generateImage(TEST_PROMPT, {
          seed: 2000 + i,
          width: 512,
          height: 512
        });
        results.push({
          candidateId: `i1c${i}`,
          localPath: result.localPath
        });
        generatedFiles.push(result.localPath);
      }
      return results;
    });

    const memAfterFlux2 = getGpuMemory();
    console.log(`[Test] GPU VRAM after Flux round 2: ${memAfterFlux2 || 'unknown'} MB`);
    assert.strictEqual(batch2.length, 2, 'Should generate 2 images in round 2');

    // === ROUND 2: VLM ranks batch 2 (THIS IS WHERE PRODUCTION CRASHED) ===
    console.log('\n[Test] ROUND 2: Ranking second batch (ensemble=3) - CRITICAL TEST...');
    console.log('[Test] This is where production crashed with GGML allocation failure');

    const ranking2 = await modelCoordinator.withVLMOperation(async () => {
      const progressEvents = [];
      const result = await vlmProvider.rankImages(batch2, TEST_PROMPT, {
        ensembleSize: 3,
        gracefulDegradation: true,
        onProgress: (data) => {
          progressEvents.push(data);
          const status = data.error ? `FAILED: ${data.errorMessage}` : 'ok';
          console.log(`[Test]   ${data.candidateA} vs ${data.candidateB} → ${status}`);
        }
      });

      const errors = progressEvents.filter(e => e.error);
      if (errors.length > 0) {
        console.log(`[Test] ⚠️  Round 2 had ${errors.length} comparison errors`);
        errors.forEach(err => {
          console.log(`[Test]      Error: ${err.errorMessage}`);
        });
      }

      return result;
    });

    const memAfterVLM2 = getGpuMemory();
    console.log(`[Test] GPU VRAM after VLM round 2: ${memAfterVLM2 || 'unknown'} MB`);
    assert.ok(ranking2.rankedImages.length > 0, 'Should rank images in round 2');

    // === Final verification ===
    const memEnd = getGpuMemory();
    console.log(`\n[Test] GPU VRAM at end: ${memEnd || 'unknown'} MB`);

    // Calculate peak memory usage
    const memoryMeasurements = [memStart, memAfterFlux1, memAfterVLM1, memAfterFlux2, memAfterVLM2, memEnd].filter(m => m !== null);
    if (memoryMeasurements.length > 0) {
      const peakMemory = Math.max(...memoryMeasurements);
      console.log(`\n========================================`);
      console.log(`📊 Test Results`);
      console.log(`========================================`);
      console.log(`VLM_GPU_LAYERS: ${VLM_GPU_LAYERS}`);
      console.log(`VLM_CONTEXT_SIZE: ${VLM_CONTEXT_SIZE}`);
      console.log(`Peak GPU memory: ${peakMemory} MB`);
      console.log(`Status: ${peakMemory > 12000 ? '⚠️  OVER 12GB LIMIT' : '✅ WITHIN 12GB LIMIT'}`);
      console.log(`========================================\n`);
    }

    // Verify no errors in ranking
    assert.strictEqual(ranking2.errors.length, 0, 'Round 2 ranking should complete without errors');

    console.log('[Test] ✅ Flux→VLM→Flux→VLM cycle completed successfully!');
  });
});
