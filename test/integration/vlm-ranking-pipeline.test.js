/**
 * 🔴 TDD RED - VLM Ranking Pipeline Integration Tests
 *
 * Tests the full ranking pipeline:
 *   LocalVLMProvider → _rankAllPairs() → compareWithEnsemble() → compareImages() → HTTP mock
 *
 * Validates:
 * - Error messages propagate through progress callbacks (not just boolean flags)
 * - Ensemble voting info appears in ranking reason strings
 * - Graceful degradation works end-to-end
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');
const fs = require('fs');

const LocalVLMProvider = require('../../src/providers/local-vlm-provider');
const FluxImageProvider = require('../../src/providers/flux-image-provider');
const modelCoordinator = require('../../src/utils/model-coordinator');

const VLM_BASE_URL = 'http://localhost:18004'; // Non-standard port to avoid conflicts

function makeCompareResponse(choice = 'A') {
  return {
    choice,
    explanation: `Image ${choice} better matches the prompt`,
    confidence: 0.85,
    ranks: {
      A: { alignment: choice === 'A' ? 1 : 2, aesthetics: 1 },
      B: { alignment: choice === 'A' ? 2 : 1, aesthetics: 2 }
    },
    winner_strengths: ['Good composition', 'Accurate content'],
    loser_weaknesses: ['Slightly off-topic'],
    improvement_suggestion: 'Add more detail to the foreground'
  };
}

function makeImages(count) {
  return Array.from({ length: count }, (_, i) => ({
    candidateId: `i${i}c0`,
    localPath: `/tmp/test-image-${i}.png`
  }));
}

/**
 * Create a mock axios that returns queued responses or throws queued errors.
 * Avoids nock's replyWithError which conflicts with @mswjs/interceptors.
 */
function createMockAxios(responses) {
  const queue = [...responses];
  return {
    post: async () => {
      const next = queue.shift();
      if (!next) throw new Error('Mock axios: no more responses queued');
      if (next.error) throw next.error;
      return { data: next.data, status: next.status || 200 };
    },
    get: async () => {
      const next = queue.shift();
      if (!next) throw new Error('Mock axios: no more responses queued');
      if (next.error) throw next.error;
      return { data: next.data, status: next.status || 200 };
    }
  };
}

describe('VLM Ranking Pipeline', () => {
  let provider;

  beforeEach(() => {
    nock.cleanAll();
    provider = new LocalVLMProvider({
      apiUrl: VLM_BASE_URL,
      defaultEnsembleSize: 1 // Single vote unless overridden
    });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Error visibility in progress callbacks', () => {
    it('should include errorMessage in progress callback when comparison fails (ECONNREFUSED)', async () => {
      const connError = new Error('connect ECONNREFUSED 127.0.0.1:18004');
      connError.code = 'ECONNREFUSED';

      // 3 images = 3 all-pairs comparisons, all fail
      provider._axios = createMockAxios([
        { error: connError },
        { error: connError },
        { error: connError }
      ]);

      const progressEvents = [];
      const images = makeImages(3);

      const result = await provider.rankImages(images, 'a beautiful sunset', {
        gracefulDegradation: true,
        ensembleSize: 1,
        onProgress: (data) => progressEvents.push(data)
      });

      // All should have error: true
      const errorEvents = progressEvents.filter(e => e.error);
      assert.strictEqual(errorEvents.length, 3, 'All 3 comparisons should fail');

      // KEY ASSERTION: errorMessage should be present (not just error: true)
      for (const event of errorEvents) {
        assert.ok(event.errorMessage, `Progress event should include errorMessage, got: ${JSON.stringify(event)}`);
        assert.ok(
          event.errorMessage.includes('unavailable') || event.errorMessage.includes('ECONNREFUSED'),
          `errorMessage should describe the failure: "${event.errorMessage}"`
        );
      }
    });

    it('should include errorMessage when VLM returns 503 (model not loaded)', async () => {
      const err503 = new Error('Request failed with status code 503');
      err503.response = { status: 503, data: { detail: 'Model not loaded' } };

      provider._axios = createMockAxios([{ error: err503 }]);

      const progressEvents = [];
      const images = makeImages(2); // 1 comparison

      await provider.rankImages(images, 'test prompt', {
        gracefulDegradation: true,
        ensembleSize: 1,
        onProgress: (data) => progressEvents.push(data)
      });

      const errorEvents = progressEvents.filter(e => e.error);
      assert.strictEqual(errorEvents.length, 1);
      assert.ok(errorEvents[0].errorMessage, 'Should include errorMessage for 503');
      assert.ok(
        errorEvents[0].errorMessage.includes('not loaded') || errorEvents[0].errorMessage.includes('503'),
        `Should mention model not loaded: "${errorEvents[0].errorMessage}"`
      );
    });
  });

  describe('Ensemble info in ranking reasons', () => {
    it('should include ensemble size in ranking reason when ensemble > 1', async () => {
      const ensembleSize = 3;
      // 2 images = 1 pair, ensemble 3x = 3 HTTP calls
      nock(VLM_BASE_URL)
        .post('/compare').reply(200, makeCompareResponse('A'))
        .post('/compare').reply(200, makeCompareResponse('A'))
        .post('/compare').reply(200, makeCompareResponse('B'));

      const images = makeImages(2);
      const result = await provider.rankImages(images, 'a red car', {
        ensembleSize,
        gracefulDegradation: true
      });

      const rankings = result.rankings;
      assert.ok(rankings.length === 2);

      // The winner should have a reason that mentions ensemble voting
      const winner = rankings[0];
      assert.ok(
        winner.reason.includes('ensemble') || winner.reason.includes(`${ensembleSize}x`),
        `Reason should mention ensemble voting, got: "${winner.reason}"`
      );
    });

    it('should include total pairs in ranking reason', async () => {
      // 3 images = 3 pairs
      nock(VLM_BASE_URL)
        .post('/compare').reply(200, makeCompareResponse('A'))
        .post('/compare').reply(200, makeCompareResponse('A'))
        .post('/compare').reply(200, makeCompareResponse('B'));

      const images = makeImages(3);
      const result = await provider.rankImages(images, 'test', {
        ensembleSize: 1,
        gracefulDegradation: true
      });

      const winner = result.rankings[0];
      // Should show wins out of total: "2/3 wins" not just "2 wins"
      assert.ok(
        winner.reason.includes('/3') || winner.reason.includes('of 3'),
        `Reason should include total pairs, got: "${winner.reason}"`
      );
    });

    it('should distinguish 0 wins from failed comparisons vs 0 wins from losses', async () => {
      const connError = new Error('connect ECONNREFUSED');
      connError.code = 'ECONNREFUSED';

      // All 3 fail
      provider._axios = createMockAxios([
        { error: connError },
        { error: connError },
        { error: connError }
      ]);

      const images = makeImages(3);
      const result = await provider.rankImages(images, 'test', {
        ensembleSize: 1,
        gracefulDegradation: true
      });

      // With all failures, metadata should show errors
      assert.ok(result.metadata.errors.length === 3, 'Should have 3 errors in metadata');

      // Reason should indicate that ranking was degraded/incomplete
      const winner = result.rankings[0];
      assert.ok(
        winner.reason.includes('0/3') || winner.reason.includes('0 of 3'),
        `Should show 0 out of 3 total pairs, got: "${winner.reason}"`
      );
    });
  });

  describe('Happy path - successful ranking', () => {
    it('should rank images correctly with all comparisons succeeding', async () => {
      // 3 images — A always wins (first image in each pair)
      // With transitive inference, some pairs may be skipped
      nock(VLM_BASE_URL)
        .post('/compare').times(3).reply(200, makeCompareResponse('A'));

      const images = makeImages(3);
      const result = await provider.rankImages(images, 'a sunset', {
        ensembleSize: 1,
        gracefulDegradation: true
      });

      assert.ok(result.rankings);
      assert.strictEqual(result.rankings.length, 3);
      // First ranked should have the most wins
      assert.strictEqual(result.rankings[0].rank, 1);
      assert.ok(result.rankings[0].wins >= 1, 'Top ranked should have at least 1 win');
      assert.strictEqual(result.metadata.errors.length, 0);
    });

    it('should collect strengths and weaknesses from comparisons', async () => {
      nock(VLM_BASE_URL)
        .post('/compare').reply(200, makeCompareResponse('A'));

      const images = makeImages(2);
      const result = await provider.rankImages(images, 'test', {
        ensembleSize: 1,
        gracefulDegradation: true
      });

      const winner = result.rankings[0];
      assert.ok(winner.strengths, 'Winner should have strengths');
      assert.ok(winner.strengths.length > 0, 'Winner should have at least one strength');
    });
  });

  describe('Partial failure with graceful degradation', () => {
    it('should rank successfully when some comparisons fail', async () => {
      const connError = new Error('connect ECONNREFUSED');
      connError.code = 'ECONNREFUSED';

      // 3 images, 3 pairs: first succeeds, second fails, third succeeds
      // Use mock axios since we mix success and error
      provider._axios = createMockAxios([
        { data: makeCompareResponse('A') },   // i0c0 vs i1c0 → A wins
        { error: connError },                   // i0c0 vs i2c0 → fails
        { data: makeCompareResponse('A') }     // i1c0 vs i2c0 → A wins
      ]);

      const progressEvents = [];
      const images = makeImages(3);
      const result = await provider.rankImages(images, 'test', {
        ensembleSize: 1,
        gracefulDegradation: true,
        onProgress: (data) => progressEvents.push(data)
      });

      // Should still produce rankings
      assert.strictEqual(result.rankings.length, 3);
      // 1 error in metadata
      assert.strictEqual(result.metadata.errors.length, 1);
      // Both successful candidates should have wins
      assert.ok(result.rankings[0].wins > 0, 'Top candidate should have wins');
    });
  });
});

/**
 * Multi-round GPU integration test: VLM ranking → Flux gen → VLM ranking
 *
 * Gate: ENABLE_GPU_TESTS=1 (requires Flux on :8001 and VLM on :8004)
 * Uses minimal settings: 1 inference step, 512x512, ensemble size 1
 */
// FLUX TESTS DISABLED: Flux model loading (10GB shards) causes system RAM OOM
// and desktop crashes. Need to solve RAM usage before enabling these tests.
// To enable: Set ENABLE_FLUX_TESTS=1 in addition to ENABLE_GPU_TESTS=1
describe('Multi-round VLM → Flux → VLM (GPU integration)', { skip: !process.env.ENABLE_GPU_TESTS || !process.env.ENABLE_FLUX_TESTS }, () => {
  const FLUX_URL = process.env.FLUX_URL || 'http://localhost:8001';
  const VLM_URL = process.env.LOCAL_VLM_URL || 'http://localhost:8004';
  const TEST_PROMPT = 'a simple red circle on a white background';

  let vlmProvider;
  let fluxProvider;
  const generatedFiles = [];

  beforeEach(() => {
    vlmProvider = new LocalVLMProvider({
      apiUrl: VLM_URL,
      defaultEnsembleSize: 1
    });
    fluxProvider = new FluxImageProvider({
      apiUrl: FLUX_URL,
      generation: {
        steps: 1,
        guidance: 3.5,
        width: 512,
        height: 512
      }
    });
  });

  afterEach(() => {
    // Clean up generated images
    for (const filePath of generatedFiles) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
    generatedFiles.length = 0;
  });

  it.skip('should complete VLM rank → Flux gen → VLM rank cycle (DISABLED: causes RAM OOM)', async () => {
    console.log('[Test] Step 1: Generate 2 initial images via Flux');

    // --- Step 1: Generate 2 images with Flux ---
    const images = await modelCoordinator.withImageGenOperation(async () => {
      const results = [];
      for (let i = 0; i < 2; i++) {
        console.log(`[Test]   Generating image ${i}...`);
        const result = await fluxProvider.generateImage(TEST_PROMPT, { seed: 42 + i });
        results.push({
          candidateId: `i0c${i}`,
          localPath: result.localPath
        });
        generatedFiles.push(result.localPath);
      }
      return results;
    });

    assert.strictEqual(images.length, 2, 'Should generate 2 images');
    for (const img of images) {
      assert.ok(fs.existsSync(img.localPath), `Image should exist at ${img.localPath}`);
    }

    // --- Step 2: VLM ranks the 2 images ---
    console.log('[Test] Step 2: VLM ranking round 1 (2 candidates, 1 comparison)');

    const ranking1 = await modelCoordinator.withVLMOperation(async () => {
      const progressEvents = [];
      const result = await vlmProvider.rankImages(images, TEST_PROMPT, {
        ensembleSize: 1,
        gracefulDegradation: true,
        onProgress: (data) => {
          progressEvents.push(data);
          const status = data.error ? `FAILED: ${data.errorMessage || 'unknown'}` : 'ok';
          console.log(`[Test]   Comparison ${data.completed}/${data.total}: ${data.candidateA} vs ${data.candidateB} → ${status}`);
        }
      });

      // Verify no errors in ranking
      const errors = progressEvents.filter(e => e.error);
      if (errors.length > 0) {
        console.error('[Test]   Ranking errors:', errors.map(e => e.errorMessage));
      }
      return { result, errors };
    });

    assert.strictEqual(ranking1.result.rankings.length, 2, 'Should rank 2 candidates');
    assert.strictEqual(ranking1.errors.length, 0, 'Round 1 should have no comparison errors');
    const round1Winner = ranking1.result.rankings[0];
    console.log(`[Test]   Round 1 winner: ${round1Winner.candidateId} — ${round1Winner.reason}`);

    // --- Step 3: Generate 1 new image via Flux ---
    console.log('[Test] Step 3: Generate 1 new image via Flux');

    const newImage = await modelCoordinator.withImageGenOperation(async () => {
      const result = await fluxProvider.generateImage(TEST_PROMPT, { seed: 99 });
      generatedFiles.push(result.localPath);
      return {
        candidateId: 'i1c0',
        localPath: result.localPath
      };
    });

    assert.ok(fs.existsSync(newImage.localPath), 'New image should exist');

    // --- Step 4: VLM ranks winner + new image ---
    console.log('[Test] Step 4: VLM ranking round 2 (winner + new candidate)');

    const round2Candidates = [
      { candidateId: round1Winner.candidateId, localPath: round1Winner.localPath },
      newImage
    ];

    const ranking2 = await modelCoordinator.withVLMOperation(async () => {
      const progressEvents = [];
      const result = await vlmProvider.rankImages(round2Candidates, TEST_PROMPT, {
        ensembleSize: 1,
        gracefulDegradation: true,
        onProgress: (data) => {
          progressEvents.push(data);
          const status = data.error ? `FAILED: ${data.errorMessage || 'unknown'}` : 'ok';
          console.log(`[Test]   Comparison ${data.completed}/${data.total}: ${data.candidateA} vs ${data.candidateB} → ${status}`);
        }
      });

      const errors = progressEvents.filter(e => e.error);
      if (errors.length > 0) {
        console.error('[Test]   Ranking errors:', errors.map(e => e.errorMessage));
      }
      return { result, errors };
    });

    assert.strictEqual(ranking2.result.rankings.length, 2, 'Should rank 2 candidates in round 2');
    assert.strictEqual(ranking2.errors.length, 0, 'Round 2 should have no comparison errors');
    const round2Winner = ranking2.result.rankings[0];
    console.log(`[Test]   Round 2 winner: ${round2Winner.candidateId} — ${round2Winner.reason}`);

    // --- Verify the full cycle completed ---
    console.log('[Test] Full cycle completed: VLM → Flux → VLM');
    assert.ok(round2Winner.candidateId, 'Final winner should have a candidateId');
    assert.ok(round2Winner.reason, 'Final winner should have a reason');
    assert.ok(
      round2Winner.reason.includes('/1'),
      `Reason should show wins out of total pairs, got: "${round2Winner.reason}"`
    );
  });

  it('should complete ensemble voting (ensembleSize=3) without VLM crash (uses Flux once)', async () => {
    // Simpler test: uses pre-generated images to avoid Flux reload stress.
    // This isolates the ensemble voting crash from GPU driver reload issues.
    console.log('[Test] Ensemble voting stability test (ensembleSize=3, VLM-only)');

    // Check GPU persistence mode
    const { execSync } = require('child_process');
    try {
      const persistenceCheck = execSync('nvidia-smi -q | grep "Persistence Mode"', { encoding: 'utf8' });
      console.log(`[Test] ${persistenceCheck.trim()}`);
      if (persistenceCheck.includes('Disabled')) {
        console.log('[Test] ⚠️  Persistence mode disabled - enabling for stability...');
        try {
          execSync('sudo nvidia-smi -pm 1', { encoding: 'utf8' });
          console.log('[Test] ✓ Persistence mode enabled');
        } catch (e) {
          console.log('[Test] ⚠️  Could not enable persistence mode (needs sudo)');
        }
      }
    } catch (e) {
      console.log('[Test] ⚠️  Could not check persistence mode');
    }

    // Log GPU VRAM before test
    const getGpuMemory = () => {
      try {
        const output = execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits', { encoding: 'utf8' });
        return parseInt(output.trim(), 10);
      } catch {
        return null;
      }
    };

    const memBefore = getGpuMemory();
    if (memBefore !== null) {
      console.log(`[Test] GPU VRAM before: ${memBefore} MB`);
    }

    // --- Step 1: Generate 2 images (one-time, then keep Flux loaded) ---
    console.log('[Test] Step 1: Generate 2 images via Flux (one-time setup)');
    const images = await modelCoordinator.withImageGenOperation(async () => {
      const results = [];
      for (let i = 0; i < 2; i++) {
        console.log(`[Test]   Generating image ${i}...`);
        const result = await fluxProvider.generateImage(TEST_PROMPT, { seed: 200 + i });
        results.push({
          candidateId: `ens${i}`,
          localPath: result.localPath
        });
        generatedFiles.push(result.localPath);
      }
      return results;
    });

    assert.strictEqual(images.length, 2, 'Should generate 2 images');

    const memAfterFlux = getGpuMemory();
    if (memAfterFlux !== null) {
      console.log(`[Test] GPU VRAM after Flux: ${memAfterFlux} MB`);
    }

    // --- Step 2: VLM ranks with ensemble voting (3 sequential inferences) ---
    console.log('[Test] Step 2: VLM ensemble ranking (3x voting, 1 pair = 3 sequential /compare calls)');

    const ranking = await modelCoordinator.withVLMOperation(async () => {
      const progressEvents = [];
      const result = await vlmProvider.rankImages(images, TEST_PROMPT, {
        ensembleSize: 3, // This triggers 3 sequential /compare calls per pair
        gracefulDegradation: true,
        onProgress: (data) => {
          progressEvents.push(data);
          const status = data.error ? `FAILED: ${data.errorMessage || 'unknown'}` : 'ok';
          console.log(`[Test]   Comparison ${data.completed}/${data.total}: ${data.candidateA} vs ${data.candidateB} → ${status}`);
        }
      });

      const errors = progressEvents.filter(e => e.error);
      if (errors.length > 0) {
        console.error('[Test]   Ranking errors:', errors.map(e => e.errorMessage));
      }
      return { result, errors };
    });

    // Log GPU VRAM after VLM ensemble
    const memAfterVLM = getGpuMemory();
    if (memAfterVLM !== null) {
      console.log(`[Test] GPU VRAM after VLM ensemble: ${memAfterVLM} MB`);
      if (memBefore !== null) {
        const delta = memAfterVLM - memBefore;
        console.log(`[Test] GPU VRAM delta: ${delta > 0 ? '+' : ''}${delta} MB`);
      }
    }

    // Key assertions
    assert.strictEqual(ranking.result.rankings.length, 2, 'Should rank 2 candidates');
    assert.strictEqual(ranking.errors.length, 0,
      `Ensemble voting should complete without errors. Errors: ${ranking.errors.map(e => e.errorMessage).join(', ')}`);

    const winner = ranking.result.rankings[0];
    console.log(`[Test]   Ensemble winner: ${winner.candidateId} — ${winner.reason}`);

    // Verify ensemble info in reason string
    assert.ok(
      winner.reason.includes('3x ensemble') || winner.reason.includes('ensemble'),
      `Reason should mention ensemble voting, got: "${winner.reason}"`
    );

    // Verify the ranking has wins info
    assert.ok(
      winner.reason.includes('/1'),
      `Reason should show wins out of total pairs, got: "${winner.reason}"`
    );
  });

  it('should complete ensemble voting with pre-existing images (VLM-only, no Flux reload)', async () => {
    // Safest test: use any existing test images to avoid GPU model swaps entirely.
    // This purely tests VLM ensemble stability without GPU driver stress.
    console.log('[Test] VLM-only ensemble test with static images');

    const { execSync } = require('child_process');
    const path = require('path');

    // Create 2 simple test images using ImageMagick (if available)
    const testImages = [];
    try {
      const tempDir = require('os').tmpdir();
      for (let i = 0; i < 2; i++) {
        const imagePath = path.join(tempDir, `vlm-test-${Date.now()}-${i}.png`);
        // Create a simple colored square (red vs blue)
        const color = i === 0 ? 'red' : 'blue';
        execSync(`convert -size 512x512 xc:${color} "${imagePath}"`, { encoding: 'utf8' });
        testImages.push({
          candidateId: `static${i}`,
          localPath: imagePath
        });
        generatedFiles.push(imagePath);
        console.log(`[Test]   Created test image: ${imagePath}`);
      }

      // Log GPU VRAM before VLM
      const getGpuMemory = () => {
        try {
          const output = execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits', { encoding: 'utf8' });
          return parseInt(output.trim(), 10);
        } catch {
          return null;
        }
      };

      const memBefore = getGpuMemory();
      if (memBefore !== null) {
        console.log(`[Test] GPU VRAM before VLM: ${memBefore} MB`);
      }

      // VLM ensemble ranking (no Flux, no GPU swap)
      console.log('[Test] Running VLM ensemble ranking (ensembleSize=3)...');
      const ranking = await modelCoordinator.withVLMOperation(async () => {
        const progressEvents = [];
        const result = await vlmProvider.rankImages(testImages, 'colored squares', {
          ensembleSize: 3,
          gracefulDegradation: true,
          onProgress: (data) => {
            progressEvents.push(data);
            const status = data.error ? `FAILED: ${data.errorMessage || 'unknown'}` : 'ok';
            console.log(`[Test]   Comparison ${data.completed}/${data.total}: ${data.candidateA} vs ${data.candidateB} → ${status}`);
          }
        });

        const errors = progressEvents.filter(e => e.error);
        if (errors.length > 0) {
          console.error('[Test]   Ranking errors:', errors.map(e => e.errorMessage));
        }
        return { result, errors };
      });

      const memAfter = getGpuMemory();
      if (memAfter !== null && memBefore !== null) {
        const delta = memAfter - memBefore;
        console.log(`[Test] GPU VRAM after VLM: ${memAfter} MB (delta: ${delta > 0 ? '+' : ''}${delta} MB)`);
      }

      // Assertions
      assert.strictEqual(ranking.result.rankings.length, 2, 'Should rank 2 candidates');
      assert.strictEqual(ranking.errors.length, 0, 'VLM ensemble should complete without errors');

      const winner = ranking.result.rankings[0];
      console.log(`[Test]   Winner: ${winner.candidateId} — ${winner.reason}`);
      assert.ok(winner.reason.includes('3x ensemble'), 'Reason should mention 3x ensemble voting');

    } catch (e) {
      if (e.message.includes('convert') || e.message.includes('command not found')) {
        console.log('[Test] ⚠️  ImageMagick not available, skipping static image test');
        // Don't fail the test if ImageMagick isn't installed
        return;
      }
      throw e;
    }
  });
});
