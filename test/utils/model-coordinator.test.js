/**
 * 🟢 GREEN: Model Coordinator Tests (Retrofit TDD)
 *
 * Tests for GPU memory coordination between local services (LLM, Flux, Vision, VLM)
 * Ensures proper service switching on single 12GB GPU
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('ModelCoordinator', () => {
  let modelCoordinator;
  let originalCleanupDelay;

  beforeEach(() => {
    // Disable GPU cleanup delay for tests (instant execution)
    originalCleanupDelay = process.env.GPU_CLEANUP_DELAY_MS;
    process.env.GPU_CLEANUP_DELAY_MS = '0';

    // Clear module cache to get fresh instance with clean state
    delete require.cache[require.resolve('../../src/utils/model-coordinator.js')];
    modelCoordinator = require('../../src/utils/model-coordinator.js');
    nock.cleanAll();
  });

  afterEach(() => {
    // Restore original delay setting
    if (originalCleanupDelay !== undefined) {
      process.env.GPU_CLEANUP_DELAY_MS = originalCleanupDelay;
    } else {
      delete process.env.GPU_CLEANUP_DELAY_MS;
    }
    nock.cleanAll();
  });

  describe('🟢 prepareForLLM', () => {
    test('should unload Flux service to free GPU memory', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // VLM endpoint - may or may not be called depending on implementation
      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForLLM();

      assert.ok(fluxUnload.isDone(), 'Should POST to flux /unload endpoint');
    });

    test('should unload VLM service to free GPU memory (12GB GPU constraint)', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      const vlmUnload = nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForLLM();

      assert.ok(vlmUnload.isDone(), 'Should POST to vlm /unload endpoint - VLM ~5-7GB conflicts with LLM ~4GB on 12GB GPU');
      assert.ok(fluxUnload.isDone(), 'Should also unload flux');
    });

    test('should handle Flux service unavailable gracefully', async () => {
      nock('http://localhost:8001')
        .post('/unload')
        .replyWithError('ECONNREFUSED');

      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // Should not throw
      await assert.doesNotReject(
        () => modelCoordinator.prepareForLLM(),
        'Should gracefully handle service unavailable'
      );
    });
  });

  describe('🟢 prepareForVLM', () => {
    test('should unload Flux service to free GPU memory for VLM', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // LLM endpoint - may or may not be called depending on implementation
      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForVLM();

      assert.ok(fluxUnload.isDone(), 'Should POST to flux /unload endpoint');
    });

    test('should unload LLM service to free GPU memory (12GB GPU constraint)', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      const llmUnload = nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForVLM();

      assert.ok(llmUnload.isDone(), 'Should POST to llm /unload endpoint - LLM ~4GB conflicts with VLM ~5-7GB on 12GB GPU');
      assert.ok(fluxUnload.isDone(), 'Should also unload flux');
    });

    test('should handle Flux service unavailable gracefully', async () => {
      nock('http://localhost:8001')
        .post('/unload')
        .replyWithError('Connection timeout');

      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // Should not throw
      await assert.doesNotReject(
        () => modelCoordinator.prepareForVLM(),
        'Should gracefully handle service unavailable'
      );
    });
  });

  describe('🟢 prepareForImageGen', () => {
    test('should unload LLM service to free GPU memory for Flux', async () => {
      const llmUnload = nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // VLM endpoint - may or may not be called depending on implementation
      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForImageGen();

      assert.ok(llmUnload.isDone(), 'Should POST to llm /unload endpoint');
    });

    test('should unload VLM service to free GPU memory (Flux needs ~10GB)', async () => {
      const llmUnload = nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      const vlmUnload = nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForImageGen();

      assert.ok(vlmUnload.isDone(), 'Should POST to vlm /unload endpoint - Flux ~10GB needs full GPU');
      assert.ok(llmUnload.isDone(), 'Should also unload llm');
    });

    test('should handle LLM service unavailable gracefully', async () => {
      nock('http://localhost:8003')
        .post('/unload')
        .replyWithError('ECONNREFUSED');

      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // Should not throw
      await assert.doesNotReject(
        () => modelCoordinator.prepareForImageGen(),
        'Should gracefully handle service unavailable'
      );
    });
  });

  describe('🟢 service unavailable handling', () => {
    test('should handle all services unavailable without throwing', async () => {
      nock('http://localhost:8001')
        .post('/unload')
        .replyWithError('Connection refused');

      nock('http://localhost:8003')
        .post('/unload')
        .replyWithError('Connection refused');

      nock('http://localhost:8002')
        .post('/unload')
        .replyWithError('Connection refused');

      nock('http://localhost:8004')
        .post('/unload')
        .replyWithError('Connection refused');

      // All these should not throw
      await assert.doesNotReject(
        () => modelCoordinator.prepareForLLM(),
        'prepareForLLM should handle unavailable'
      );

      await assert.doesNotReject(
        () => modelCoordinator.prepareForVLM(),
        'prepareForVLM should handle unavailable'
      );

      await assert.doesNotReject(
        () => modelCoordinator.prepareForImageGen(),
        'prepareForImageGen should handle unavailable'
      );

      await assert.doesNotReject(
        () => modelCoordinator.cleanupAll(),
        'cleanupAll should handle unavailable'
      );
    });
  });

  describe('🟢 getModelStates', () => {
    test('should return current state of all models', async () => {
      const state = modelCoordinator.getModelStates();

      assert.ok(typeof state === 'object', 'Should return object');
      assert.ok(Object.hasOwn(state, 'llm'), 'Should have llm state');
      assert.ok(Object.hasOwn(state, 'flux'), 'Should have flux state');
      assert.ok(Object.hasOwn(state, 'vision'), 'Should have vision state');
      assert.ok(Object.hasOwn(state, 'vlm'), 'Should have vlm state');

      // All should be boolean
      assert.strictEqual(typeof state.llm, 'boolean', 'llm state should be boolean');
      assert.strictEqual(typeof state.flux, 'boolean', 'flux state should be boolean');
      assert.strictEqual(typeof state.vision, 'boolean', 'vision state should be boolean');
      assert.strictEqual(typeof state.vlm, 'boolean', 'vlm state should be boolean');
    });

    test('should track model state after unload', async () => {
      nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForLLM();

      const state = modelCoordinator.getModelStates();
      assert.strictEqual(state.flux, false, 'Flux should be marked as unloaded');
    });

    test('should return independent state object (not mutated externally)', async () => {
      const state1 = modelCoordinator.getModelStates();
      state1.llm = true; // Try to mutate

      const state2 = modelCoordinator.getModelStates();
      assert.strictEqual(state2.llm, false, 'Should return independent copy, not affected by external mutation');
    });
  });

  describe('🟢 cleanupAll', () => {
    test('should unload all services', async () => {
      const llmUnload = nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      const visionUnload = nock('http://localhost:8002')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      const vlmUnload = nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.cleanupAll();

      assert.ok(llmUnload.isDone(), 'Should call llm /unload');
      assert.ok(fluxUnload.isDone(), 'Should call flux /unload');
      assert.ok(visionUnload.isDone(), 'Should call vision /unload');
      assert.ok(vlmUnload.isDone(), 'Should call vlm /unload');
    });

    test('should handle partial service failures gracefully', async () => {
      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      nock('http://localhost:8001')
        .post('/unload')
        .replyWithError('Service unavailable');

      nock('http://localhost:8002')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      // Should not throw even though one service is unavailable
      await assert.doesNotReject(
        () => modelCoordinator.cleanupAll(),
        'Should handle partial service failures'
      );
    });
  });

  describe('🟢 Service Health Tracking and Auto-Restart', () => {
    test('should track service "shouldBeRunning" intent', async () => {
      // When we mark a service as "should be running", it should be tracked
      modelCoordinator.markServiceIntent('vlm', true);

      const intent = modelCoordinator.getServiceIntent('vlm');
      assert.strictEqual(intent.shouldBeRunning, true, 'VLM should be marked as intended to run');
    });

    test('should track when service was last seen healthy', async () => {
      // Mock successful health check
      nock('http://localhost:8004')
        .get('/health')
        .reply(200, { status: 'ok' });

      modelCoordinator.markServiceIntent('vlm', true);
      await modelCoordinator.checkServiceHealth('vlm');

      const intent = modelCoordinator.getServiceIntent('vlm');
      assert.ok(intent.lastHealthy instanceof Date || typeof intent.lastHealthy === 'number',
        'Should record last healthy timestamp');
    });

    test('should detect crashed service via failed health check', async () => {
      // Mock failed health check (service crashed)
      nock('http://localhost:8004')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      modelCoordinator.markServiceIntent('vlm', true);
      const health = await modelCoordinator.checkServiceHealth('vlm');

      assert.strictEqual(health.healthy, false, 'Should detect unhealthy service');
      assert.strictEqual(health.shouldBeRunning, true, 'Should know service should be running');
      assert.strictEqual(health.needsRestart, true, 'Should flag service needs restart');
    });

    test('should NOT flag restart for service that should not be running', async () => {
      // Service is down, but that's expected (shouldBeRunning = false)
      nock('http://localhost:8004')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      modelCoordinator.markServiceIntent('vlm', false);
      const health = await modelCoordinator.checkServiceHealth('vlm');

      assert.strictEqual(health.healthy, false, 'Should detect service is down');
      assert.strictEqual(health.needsRestart, false, 'Should NOT flag restart since it should not be running');
    });

    test('should attempt restart for crashed service that should be running', async () => {
      // Track restart attempts
      const restartAttempts = [];

      // Mock failed health check
      nock('http://localhost:8004')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      // Inject mock restarter
      modelCoordinator.setServiceRestarter(async (serviceName) => {
        restartAttempts.push(serviceName);
        return { success: true };
      });

      modelCoordinator.markServiceIntent('vlm', true);
      await modelCoordinator.ensureServiceHealth('vlm');

      assert.deepStrictEqual(restartAttempts, ['vlm'], 'Should have attempted to restart VLM');
    });

    test('should check and restart all services that need it', async () => {
      const restartAttempts = [];

      // VLM: should be running but crashed
      nock('http://localhost:8004')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      // Flux: should be running and is healthy
      nock('http://localhost:8001')
        .get('/health')
        .reply(200, { status: 'ok' });

      // LLM: should NOT be running (intentionally off)
      nock('http://localhost:8003')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      // Vision: should be running but crashed
      nock('http://localhost:8002')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      modelCoordinator.setServiceRestarter(async (serviceName) => {
        restartAttempts.push(serviceName);
        return { success: true };
      });

      // Set intents
      modelCoordinator.markServiceIntent('vlm', true);
      modelCoordinator.markServiceIntent('flux', true);
      modelCoordinator.markServiceIntent('llm', false);  // Intentionally off
      modelCoordinator.markServiceIntent('vision', true);

      await modelCoordinator.ensureAllServicesHealthy();

      // Should restart VLM and Vision (crashed but should be running)
      // Should NOT restart Flux (healthy) or LLM (intentionally off)
      assert.ok(restartAttempts.includes('vlm'), 'Should restart crashed VLM');
      assert.ok(restartAttempts.includes('vision'), 'Should restart crashed Vision');
      assert.ok(!restartAttempts.includes('flux'), 'Should NOT restart healthy Flux');
      assert.ok(!restartAttempts.includes('llm'), 'Should NOT restart intentionally-off LLM');
    });

    test('should have getServiceHealthReport for debugging', async () => {
      nock('http://localhost:8004')
        .get('/health')
        .reply(200, { status: 'ok' });

      nock('http://localhost:8001')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      modelCoordinator.markServiceIntent('vlm', true);
      modelCoordinator.markServiceIntent('flux', true);

      const report = await modelCoordinator.getServiceHealthReport();

      assert.ok(typeof report === 'object', 'Should return object');
      assert.ok(Object.hasOwn(report, 'vlm'), 'Should have VLM status');
      assert.ok(Object.hasOwn(report, 'flux'), 'Should have Flux status');
      assert.strictEqual(report.vlm.healthy, true, 'VLM should be healthy');
      assert.strictEqual(report.flux.healthy, false, 'Flux should be unhealthy');
    });
  });

  describe('🟢 GPU Lock (serialize model operations)', () => {
    test('should serialize concurrent prepareForLLM and prepareForVLM calls', async () => {
      // Track the order of operations
      const operationOrder = [];

      // Mock slow unload for flux (simulates real GPU unload time)
      nock('http://localhost:8001')
        .post('/unload')
        .delay(100) // 100ms delay
        .reply(200, () => {
          operationOrder.push('flux-unload-1');
          return { status: 'unloaded' };
        });

      // Second flux unload (for prepareForVLM)
      nock('http://localhost:8001')
        .post('/unload')
        .reply(200, () => {
          operationOrder.push('flux-unload-2');
          return { status: 'unloaded' };
        });

      // VLM unload (for prepareForLLM)
      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, () => {
          operationOrder.push('vlm-unload');
          return { status: 'unloaded' };
        });

      // LLM unload (for prepareForVLM)
      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, () => {
          operationOrder.push('llm-unload');
          return { status: 'unloaded' };
        });

      // Start both operations concurrently
      const llmPromise = modelCoordinator.prepareForLLM();
      const vlmPromise = modelCoordinator.prepareForVLM();

      await Promise.all([llmPromise, vlmPromise]);

      // With proper locking, operations should be serialized
      // First operation's unloads should complete before second operation starts
      // The exact order depends on which acquires the lock first, but they shouldn't interleave
      assert.ok(operationOrder.length >= 3, `Should have at least 3 operations, got ${operationOrder.length}`);

      // Check that operations don't interleave (all of first op before second)
      // Either LLM ops finish first, or VLM ops finish first
      const firstTwoOps = operationOrder.slice(0, 2);
      const isLLMFirst = firstTwoOps.includes('flux-unload-1') && firstTwoOps.includes('vlm-unload');
      const isVLMFirst = firstTwoOps.includes('flux-unload-2') && firstTwoOps.includes('llm-unload');

      assert.ok(isLLMFirst || isVLMFirst,
        `Operations should not interleave. Order was: ${operationOrder.join(' -> ')}`);
    });

    test('should have acquireGPULock method', () => {
      assert.strictEqual(typeof modelCoordinator.acquireGPULock, 'function',
        'Should export acquireGPULock method');
    });

    test('should have releaseGPULock method', () => {
      assert.strictEqual(typeof modelCoordinator.releaseGPULock, 'function',
        'Should export releaseGPULock method');
    });

    test('acquireGPULock should return a release function', async () => {
      const release = await modelCoordinator.acquireGPULock();
      assert.strictEqual(typeof release, 'function', 'Should return a release function');
      release(); // Clean up
    });

    test('second acquireGPULock should wait until first is released', async () => {
      const events = [];

      // Acquire first lock
      const release1 = await modelCoordinator.acquireGPULock();
      events.push('lock1-acquired');

      // Try to acquire second lock (should wait)
      const lock2Promise = modelCoordinator.acquireGPULock().then(release => {
        events.push('lock2-acquired');
        return release;
      });

      // Give time for lock2 to potentially acquire (it shouldn't)
      await new Promise(r => setTimeout(r, 50));

      // lock2 should NOT have acquired yet
      assert.ok(!events.includes('lock2-acquired'),
        'Second lock should wait for first to be released');

      // Release first lock
      release1();
      events.push('lock1-released');

      // Now lock2 should acquire
      const release2 = await lock2Promise;
      release2();

      assert.deepStrictEqual(events, ['lock1-acquired', 'lock1-released', 'lock2-acquired'],
        'Locks should be serialized');
    });

    test('prepareForImageGen should wait for ongoing prepareForVLM to complete', async () => {
      const events = [];

      // Mock slow VLM unload operations
      nock('http://localhost:8001')
        .post('/unload')
        .delay(100)
        .reply(200, () => {
          events.push('flux-unload-vlm');
          return { status: 'unloaded' };
        });

      nock('http://localhost:8003')
        .post('/unload')
        .delay(50)
        .reply(200, () => {
          events.push('llm-unload-vlm');
          return { status: 'unloaded' };
        });

      // Mock ImageGen unloads (will happen after VLM completes)
      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, () => {
          events.push('llm-unload-flux');
          return { status: 'unloaded' };
        });

      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, () => {
          events.push('vlm-unload-flux');
          return { status: 'unloaded' };
        });

      // Start VLM prep first
      const vlmPromise = modelCoordinator.prepareForVLM().then(() => {
        events.push('vlm-complete');
      });

      // Start ImageGen prep immediately after (should wait)
      const imageGenPromise = modelCoordinator.prepareForImageGen().then(() => {
        events.push('imagegen-complete');
      });

      await Promise.all([vlmPromise, imageGenPromise]);

      // VLM should complete before ImageGen starts its unloads
      const vlmCompleteIdx = events.indexOf('vlm-complete');
      const imageGenUnloadIdx = events.findIndex(e => e.includes('-flux'));

      assert.ok(vlmCompleteIdx < imageGenUnloadIdx,
        `VLM should complete before ImageGen unloads. Order: ${events.join(' -> ')}`);
    });

    test('should have withGPULock method for holding lock during full operations', () => {
      assert.strictEqual(typeof modelCoordinator.withGPULock, 'function',
        'Should export withGPULock method');
    });

    test('withGPULock should hold lock for entire async operation', async () => {
      const events = [];

      // Long operation that holds the lock
      const longOpPromise = modelCoordinator.withGPULock(async () => {
        events.push('long-op-start');
        await new Promise(r => setTimeout(r, 100));
        events.push('long-op-end');
        return 'long-op-result';
      });

      // Short operation that tries to run immediately after
      const shortOpPromise = modelCoordinator.withGPULock(async () => {
        events.push('short-op-start');
        return 'short-op-result';
      });

      const [longResult, shortResult] = await Promise.all([longOpPromise, shortOpPromise]);

      // Short op should wait for long op to finish
      assert.deepStrictEqual(events, ['long-op-start', 'long-op-end', 'short-op-start'],
        'Short op should wait for long op to complete');
      assert.strictEqual(longResult, 'long-op-result');
      assert.strictEqual(shortResult, 'short-op-result');
    });

    test('withGPULock should release lock even if operation throws', async () => {
      // First operation throws
      try {
        await modelCoordinator.withGPULock(async () => {
          throw new Error('Operation failed');
        });
      } catch {
        // Expected
      }

      // Second operation should still be able to acquire lock
      let secondOpRan = false;
      await modelCoordinator.withGPULock(async () => {
        secondOpRan = true;
      });

      assert.ok(secondOpRan, 'Second operation should run after first throws');
    });

    test('withGPULock should block prepareFor* calls during long operation', async () => {
      const events = [];

      // Mock endpoints
      nock('http://localhost:8001')
        .post('/unload')
        .reply(200, () => {
          events.push('flux-unload');
          return { status: 'unloaded' };
        });

      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, () => {
          events.push('llm-unload');
          return { status: 'unloaded' };
        });

      // Long VLM operation holding the lock
      const vlmOpPromise = modelCoordinator.withGPULock(async () => {
        events.push('vlm-inference-start');
        await new Promise(r => setTimeout(r, 100));
        events.push('vlm-inference-end');
      });

      // prepareForImageGen tries to run (should wait)
      const imageGenPromise = modelCoordinator.prepareForImageGen().then(() => {
        events.push('imagegen-ready');
      });

      await Promise.all([vlmOpPromise, imageGenPromise]);

      // VLM inference should complete BEFORE ImageGen prepares (unloads models)
      const vlmEndIdx = events.indexOf('vlm-inference-end');
      const unloadIdx = events.findIndex(e => e.includes('unload'));

      assert.ok(vlmEndIdx < unloadIdx,
        `VLM inference must complete before model unloading. Order: ${events.join(' -> ')}`);
    });

    test('should have withVLMOperation for combined prepare+operation', () => {
      assert.strictEqual(typeof modelCoordinator.withVLMOperation, 'function',
        'Should export withVLMOperation method');
    });

    test('withVLMOperation should prepare and hold lock for entire operation', async () => {
      const events = [];

      // Mock VLM prepare endpoints
      nock('http://localhost:8001')
        .post('/unload')
        .reply(200, () => {
          events.push('flux-unload');
          return { status: 'unloaded' };
        });

      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, () => {
          events.push('llm-unload');
          return { status: 'unloaded' };
        });

      // Mock ImageGen prepare endpoints (for second operation)
      nock('http://localhost:8003')
        .post('/unload')
        .reply(200, () => {
          events.push('llm-unload-imagegen');
          return { status: 'unloaded' };
        });

      nock('http://localhost:8004')
        .post('/unload')
        .reply(200, () => {
          events.push('vlm-unload-imagegen');
          return { status: 'unloaded' };
        });

      // VLM operation with prepare + long inference
      const vlmPromise = modelCoordinator.withVLMOperation(async () => {
        events.push('vlm-inference-start');
        await new Promise(r => setTimeout(r, 100));
        events.push('vlm-inference-end');
        return 'vlm-result';
      });

      // ImageGen prep tries to run (should wait for VLM inference to complete)
      const imageGenPromise = modelCoordinator.prepareForImageGen().then(() => {
        events.push('imagegen-ready');
      });

      const [vlmResult] = await Promise.all([vlmPromise, imageGenPromise]);

      assert.strictEqual(vlmResult, 'vlm-result');

      // VLM inference must complete BEFORE ImageGen unloads (vlm-unload-imagegen)
      const vlmEndIdx = events.indexOf('vlm-inference-end');
      const imageGenUnloadIdx = events.indexOf('vlm-unload-imagegen');

      assert.ok(vlmEndIdx < imageGenUnloadIdx,
        `VLM inference must complete before ImageGen unloads VLM. Order: ${events.join(' -> ')}`);
    });

    test('should have withImageGenOperation for combined prepare+operation', () => {
      assert.strictEqual(typeof modelCoordinator.withImageGenOperation, 'function',
        'Should export withImageGenOperation method');
    });

    test('should have withLLMOperation for combined prepare+operation', () => {
      assert.strictEqual(typeof modelCoordinator.withLLMOperation, 'function',
        'Should export withLLMOperation method');
    });
  });
});
