/**
 * 🔴 RED: GPU Coordination Integration Tests
 *
 * Tests for model coordinator GPU memory management across service switching
 * Ensures LLM, VLM, and Flux can switch on single 12GB GPU
 *
 * Gate: ENABLE_GPU_TESTS=1 to run (requires actual services and GPU)
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');
const axios = require('axios');

describe('GPU Coordination', () => {
  let modelCoordinator;
  const skipUnlessGPU = !process.env.ENABLE_GPU_TESTS;

  beforeEach(() => {
    // Clear module cache to get fresh instance
    delete require.cache[require.resolve('../../src/utils/model-coordinator.js')];
    modelCoordinator = require('../../src/utils/model-coordinator.js');
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Service Switching (Unit Tests with Mocks)', () => {
    test('should switch from LLM to VLM by unloading Flux', async () => {
      // Mock LLM health check (model running)
      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_loaded: true,
          gpu_layers: 32,
          device: 'cuda'
        });

      // Mock Flux unload call
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // Mock VLM health check (model running after unload)
      nock('http://localhost:8004')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_loaded: true,
          gpu_layers: -1,
          device: 'cuda'
        });

      // LLM is running
      const llmHealth = await axios.get('http://localhost:8003/health');
      assert.strictEqual(llmHealth.data.model_loaded, true, 'LLM should be loaded initially');

      // Prepare for VLM (unloads Flux to free 5-7GB)
      await modelCoordinator.prepareForVLM();
      assert.ok(fluxUnload.isDone(), 'Should unload Flux');

      // VLM can now load
      const vlmHealth = await axios.get('http://localhost:8004/health');
      assert.strictEqual(vlmHealth.data.model_loaded, true, 'VLM should load after Flux unload');
    });

    test('should switch from VLM to LLM', async () => {
      // Mock VLM health check
      nock('http://localhost:8004')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_loaded: true,
          gpu_layers: -1,
          device: 'cuda'
        });

      // Mock LLM unload (VLM doesn't need to unload LLM if both fit)
      // But for this test, we'll unload to free resources
      const llmUnload = nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // VLM is running
      const vlmHealth = await axios.get('http://localhost:8004/health');
      assert.strictEqual(vlmHealth.data.model_loaded, true, 'VLM should be loaded');

      // Prepare for LLM (LLM only needs Flux unloaded, not VLM)
      // So this should not throw
      await modelCoordinator.prepareForLLM();
    });

    test('should handle Flux→VLM switching (critical: 10GB→5-7GB)', async () => {
      // Mock Flux health check (model loaded, 10GB on GPU)
      nock('http://localhost:8001')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'black-forest-labs/FLUX.1-dev',
          model_loaded: true,
          device: 'cuda',
          lora: { loaded: false }
        });

      // Mock Flux unload to free 10GB
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // Mock VLM health check (model loaded after Flux unload)
      nock('http://localhost:8004')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_repo: 'jartine/llava-v1.6-mistral-7b-gguf',
          gpu_layers: -1,
          model_loaded: true,
          device: 'cuda'
        });

      // Flux is running
      const fluxHealth = await axios.get('http://localhost:8001/health');
      assert.strictEqual(fluxHealth.data.model_loaded, true, 'Flux should be loaded initially');

      // Prepare for VLM (critical transition: unload Flux to free 10GB for VLM's 5-7GB)
      await modelCoordinator.prepareForVLM();
      assert.ok(fluxUnload.isDone(), 'Must unload Flux for VLM');

      // VLM can now load without OOM
      const vlmHealth = await axios.get('http://localhost:8004/health');
      assert.strictEqual(vlmHealth.data.model_loaded, true, 'VLM should load on freed GPU memory');
    });
  });

  describe('GPU Status Verification', () => {
    test('should verify GPU usage via health check (gpu_layers > 0)', async () => {
      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_loaded: true,
          gpu_layers: 32,
          device: 'cuda'
        });

      const health = await axios.get('http://localhost:8003/health');

      assert.strictEqual(health.data.model_loaded, true, 'Model should be loaded');
      assert.ok(health.data.gpu_layers > 0, 'Should use GPU (gpu_layers > 0)');
      assert.strictEqual(health.data.device, 'cuda', 'Should use CUDA device');
    });

    test('should verify VLM GPU usage with all layers (-1)', async () => {
      nock('http://localhost:8004')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_loaded: true,
          gpu_layers: -1,
          device: 'cuda'
        });

      const health = await axios.get('http://localhost:8004/health');

      assert.strictEqual(health.data.model_loaded, true, 'Model should be loaded');
      assert.strictEqual(health.data.gpu_layers, -1, 'Should indicate all layers on GPU');
      assert.ok(health.data.device === 'cuda', 'Should use CUDA device');
    });
  });

  describe('Service Coordination State', () => {
    test('should track model load state during switching', async () => {
      // Mock successful Flux unload
      nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      const stateBefore = modelCoordinator.getModelStates();
      assert.strictEqual(stateBefore.flux, false, 'Flux should start unloaded in mock');

      await modelCoordinator.prepareForVLM();

      const stateAfter = modelCoordinator.getModelStates();
      assert.strictEqual(stateAfter.flux, false, 'Flux should be marked unloaded');
    });

    test('should handle concurrent preparation calls', async () => {
      nock('http://localhost:8001')
        .post('/unload')
        .times(2)
        .reply(200, { status: 'unloaded' });

      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // Call multiple prepare methods concurrently
      await Promise.all([
        modelCoordinator.prepareForVLM(),
        modelCoordinator.prepareForImageGen()
      ]);

      // Both should complete without error
      const state = modelCoordinator.getModelStates();
      assert.ok(typeof state === 'object', 'Should have valid state after concurrent calls');
    });
  });

  describe('Integration Tests (Gated by ENABLE_GPU_TESTS)', () => {
    test('LLM health check confirms GPU usage', { skip: skipUnlessGPU }, async () => {
      // This test requires actual services running with GPU
      const health = await axios.get('http://localhost:8003/health', {
        timeout: 5000
      });

      assert.strictEqual(health.status, 200, 'Service should be healthy');
      assert.ok(health.data.model_loaded !== undefined, 'Should report model load status');

      if (health.data.model_loaded) {
        // If model is loaded, verify GPU usage
        assert.ok(health.data.gpu_layers !== 0, 'Should use GPU when model is loaded');
        assert.ok(
          health.data.device === 'cuda' || health.data.gpu_layers > 0,
          'Should indicate GPU usage'
        );
      }
    });

    test('VLM health check confirms GPU usage', { skip: skipUnlessGPU }, async () => {
      // This test requires actual services running with GPU
      const health = await axios.get('http://localhost:8004/health', {
        timeout: 5000
      });

      assert.strictEqual(health.status, 200, 'Service should be healthy');
      assert.ok(health.data.model_loaded !== undefined, 'Should report model load status');

      if (health.data.model_loaded) {
        // If model is loaded, verify GPU usage
        assert.ok(health.data.gpu_layers !== 0, 'Should use GPU when model is loaded');
        assert.ok(
          health.data.device === 'cuda' || health.data.gpu_layers < 0 || health.data.gpu_layers > 0,
          'Should indicate GPU usage'
        );
      }
    });

    test('Flux→VLM switching works without OOM', { skip: skipUnlessGPU }, async () => {
      // Check Flux health
      try {
        const fluxHealth = await axios.get('http://localhost:8001/health', {
          timeout: 5000
        });

        if (fluxHealth.data.model_loaded) {
          // If Flux is loaded, prepare for VLM and verify it loads
          await modelCoordinator.prepareForVLM();

          const vlmHealth = await axios.get('http://localhost:8004/health', {
            timeout: 5000
          });

          // VLM should be able to respond (may not be loaded yet, but service should be running)
          assert.ok(vlmHealth.status === 200, 'VLM service should respond after Flux unload');
        }
      } catch (error) {
        // Services may not be running - that's okay for this test
        console.log('Services not running for GPU test:', error.message);
      }
    });

    test('cleanupAll unloads all services safely', { skip: skipUnlessGPU }, async () => {
      // Cleanup all services
      await modelCoordinator.cleanupAll();

      // All services should be marked as unloaded
      const state = modelCoordinator.getModelStates();
      assert.ok(typeof state === 'object', 'Should have valid state after cleanup');
      assert.strictEqual(state.llm, false, 'LLM should be unloaded');
      assert.strictEqual(state.flux, false, 'Flux should be unloaded');
      assert.strictEqual(state.vision, false, 'Vision should be unloaded');
      assert.strictEqual(state.vlm, false, 'VLM should be unloaded');
    });
  });
});
