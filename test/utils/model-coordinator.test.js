/**
 * 🟢 GREEN: Model Coordinator Tests (Retrofit TDD)
 *
 * Tests for GPU memory coordination between local services (LLM, Flux, Vision, VLM)
 * Ensures proper service switching on single 12GB GPU
 *
 * unloadModel() now stops service processes (kills them) instead of calling HTTP
 * /unload, because ggml's CUDA memory pool persists for the process lifetime.
 * The only reliable way to free GPU memory is to destroy the CUDA context by
 * terminating the process.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('ModelCoordinator', () => {
  let modelCoordinator;
  let originalCleanupDelay;
  let serviceManagerModule;

  // Track mock calls
  let stopServiceCalls;
  let startServiceCalls;
  let isServiceRunningResults;

  // Store originals for restore
  let origStopService;
  let origStartService;
  let origIsServiceRunning;
  let origHasStopLock;
  let origGetServiceUrl;

  beforeEach(() => {
    // Disable GPU cleanup delay for tests (instant execution)
    originalCleanupDelay = process.env.GPU_CLEANUP_DELAY_MS;
    process.env.GPU_CLEANUP_DELAY_MS = '0';

    // Get the service-manager module and mock its methods
    // model-coordinator requires service-manager at load time, so we mock first
    serviceManagerModule = require('../../src/utils/service-manager.js');

    origStopService = serviceManagerModule.stopService;
    origStartService = serviceManagerModule.startService;
    origIsServiceRunning = serviceManagerModule.isServiceRunning;
    origHasStopLock = serviceManagerModule.hasStopLock;
    origGetServiceUrl = serviceManagerModule.getServiceUrl;

    stopServiceCalls = [];
    startServiceCalls = [];
    // By default, report services as already running (no restart needed)
    isServiceRunningResults = { llm: true, flux: true, vlm: true, vision: true };

    serviceManagerModule.stopService = async (service) => {
      stopServiceCalls.push(service);
      return { success: true };
    };
    serviceManagerModule.startService = async (service) => {
      startServiceCalls.push(service);
      return { success: true, pid: 99999, port: 8000 };
    };
    serviceManagerModule.isServiceRunning = async (service) => {
      return isServiceRunningResults[service] || false;
    };
    // Prevent tests from reading real STOP_LOCK files on disk
    serviceManagerModule.hasStopLock = async () => false;
    // Override port-file-based URL resolution so nock intercepts use default ports
    const defaultPorts = { llm: 8003, flux: 8001, vision: 8002, vlm: 8004 };
    serviceManagerModule.getServiceUrl = (service) => `http://localhost:${defaultPorts[service] || 8000}`;

    // Clear module cache to get fresh instance with clean state
    delete require.cache[require.resolve('../../src/utils/model-coordinator.js')];
    modelCoordinator = require('../../src/utils/model-coordinator.js');
    nock.cleanAll();
  });

  afterEach(() => {
    // Restore original methods
    serviceManagerModule.stopService = origStopService;
    serviceManagerModule.startService = origStartService;
    serviceManagerModule.isServiceRunning = origIsServiceRunning;
    serviceManagerModule.hasStopLock = origHasStopLock;
    serviceManagerModule.getServiceUrl = origGetServiceUrl;

    // Restore original delay setting
    if (originalCleanupDelay !== undefined) {
      process.env.GPU_CLEANUP_DELAY_MS = originalCleanupDelay;
    } else {
      delete process.env.GPU_CLEANUP_DELAY_MS;
    }
    nock.cleanAll();
  });

  describe('🟢 with*Operation service unavailable handling', () => {
    test('should handle all services unavailable without throwing', async () => {
      serviceManagerModule.stopService = async () => {
        throw new Error('Connection refused');
      };

      await assert.doesNotReject(
        () => modelCoordinator.withLLMOperation(async () => {}),
        'withLLMOperation should handle unavailable'
      );

      await assert.doesNotReject(
        () => modelCoordinator.withVLMOperation(async () => {}),
        'withVLMOperation should handle unavailable'
      );

      await assert.doesNotReject(
        () => modelCoordinator.withImageGenOperation(async () => {}),
        'withImageGenOperation should handle unavailable'
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
      await modelCoordinator.withLLMOperation(async () => {});

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
    test('should stop all services', async () => {
      await modelCoordinator.cleanupAll();

      assert.ok(stopServiceCalls.includes('llm'), 'Should stop llm');
      assert.ok(stopServiceCalls.includes('flux'), 'Should stop flux');
      assert.ok(stopServiceCalls.includes('vision'), 'Should stop vision');
      assert.ok(stopServiceCalls.includes('vlm'), 'Should stop vlm');
    });

    test('should handle partial service failures gracefully', async () => {
      serviceManagerModule.stopService = async (service) => {
        if (service === 'flux') throw new Error('Service unavailable');
        stopServiceCalls.push(service);
        return { success: true };
      };

      // Should not throw even though one service fails
      await assert.doesNotReject(
        () => modelCoordinator.cleanupAll(),
        'Should handle partial service failures'
      );
    });
  });

  describe('🟢 ensureServiceRunning', () => {
    test('should not start service if already running', async () => {
      isServiceRunningResults.llm = true;

      const result = await modelCoordinator.ensureServiceRunning('llm');
      assert.strictEqual(result, true, 'Should return true');
      assert.ok(!startServiceCalls.includes('llm'), 'Should not call startService');
    });

    test('should start service if not running', async () => {
      isServiceRunningResults.vlm = false;

      // Mock health check
      nock('http://localhost:8004')
        .get('/health')
        .reply(200, { status: 'healthy' });

      const result = await modelCoordinator.ensureServiceRunning('vlm');
      assert.strictEqual(result, true, 'Should return true after starting');
      assert.ok(startServiceCalls.includes('vlm'), 'Should call startService');
    });

    test('should return false if startService fails', async () => {
      isServiceRunningResults.llm = false;
      serviceManagerModule.startService = async () => ({
        success: false, error: 'No available port'
      });

      const result = await modelCoordinator.ensureServiceRunning('llm');
      assert.strictEqual(result, false, 'Should return false on failure');
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
    test('should serialize concurrent withLLMOperation and withVLMOperation calls', async () => {
      // Track the order of operations
      const operationOrder = [];

      // Add delays to stopService to simulate real behavior
      serviceManagerModule.stopService = async (service) => {
        stopServiceCalls.push(service);
        operationOrder.push(`stop-${service}`);
        // Small delay to make timing observable
        await new Promise(r => setTimeout(r, 10));
        return { success: true };
      };

      // Start both operations concurrently
      const llmPromise = modelCoordinator.withLLMOperation(async () => {});
      const vlmPromise = modelCoordinator.withVLMOperation(async () => {});

      await Promise.all([llmPromise, vlmPromise]);

      // With proper locking, operations should be serialized
      assert.ok(operationOrder.length >= 3, `Should have at least 3 stop operations, got ${operationOrder.length}`);

      // Check that operations don't interleave (all of first op before second)
      const firstTwoOps = operationOrder.slice(0, 2);
      // withLLMOperation stops flux+vlm, withVLMOperation stops flux+llm
      const isLLMFirst = firstTwoOps.includes('stop-flux') && firstTwoOps.includes('stop-vlm');
      const isVLMFirst = firstTwoOps.includes('stop-flux') && firstTwoOps.includes('stop-llm');

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

    test('withImageGenOperation should wait for ongoing withVLMOperation to complete', async () => {
      const events = [];
      let callCount = 0;

      serviceManagerModule.stopService = async (service) => {
        callCount++;
        const phase = callCount <= 2 ? 'vlm-prep' : 'imagegen-prep';
        events.push(`${phase}:stop-${service}`);
        // Small delay for first operation
        if (callCount <= 2) {
          await new Promise(r => setTimeout(r, 50));
        }
        return { success: true };
      };

      // Start VLM op first
      const vlmPromise = modelCoordinator.withVLMOperation(async () => {
        events.push('vlm-complete');
      });

      // Start ImageGen op immediately after (should wait)
      const imageGenPromise = modelCoordinator.withImageGenOperation(async () => {
        events.push('imagegen-complete');
      });

      await Promise.all([vlmPromise, imageGenPromise]);

      // VLM should complete before ImageGen starts its stops
      const vlmCompleteIdx = events.indexOf('vlm-complete');
      const imageGenStopIdx = events.findIndex(e => e.startsWith('imagegen-prep'));

      assert.ok(vlmCompleteIdx < imageGenStopIdx,
        `VLM should complete before ImageGen stops. Order: ${events.join(' -> ')}`);
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

    test('withGPULock should block withImageGenOperation during long operation', async () => {
      const events = [];

      serviceManagerModule.stopService = async (service) => {
        events.push(`stop-${service}`);
        return { success: true };
      };

      // Long VLM operation holding the lock
      const vlmOpPromise = modelCoordinator.withGPULock(async () => {
        events.push('vlm-inference-start');
        await new Promise(r => setTimeout(r, 100));
        events.push('vlm-inference-end');
      });

      // withImageGenOperation tries to run (should wait for lock)
      const imageGenPromise = modelCoordinator.withImageGenOperation(async () => {
        events.push('imagegen-ready');
      });

      await Promise.all([vlmOpPromise, imageGenPromise]);

      // VLM inference should complete BEFORE ImageGen prepares (stops models)
      const vlmEndIdx = events.indexOf('vlm-inference-end');
      const stopIdx = events.findIndex(e => e.startsWith('stop-'));

      assert.ok(vlmEndIdx < stopIdx,
        `VLM inference must complete before model stopping. Order: ${events.join(' -> ')}`);
    });

    test('should have withVLMOperation for combined prepare+operation', () => {
      assert.strictEqual(typeof modelCoordinator.withVLMOperation, 'function',
        'Should export withVLMOperation method');
    });

    test('withVLMOperation should prepare and hold lock for entire operation', async () => {
      const events = [];
      let callCount = 0;

      serviceManagerModule.stopService = async (service) => {
        callCount++;
        const phase = callCount <= 2 ? 'vlm-prep' : 'imagegen-prep';
        events.push(`${phase}:stop-${service}`);
        return { success: true };
      };

      // VLM operation with prepare + long inference
      const vlmPromise = modelCoordinator.withVLMOperation(async () => {
        events.push('vlm-inference-start');
        await new Promise(r => setTimeout(r, 100));
        events.push('vlm-inference-end');
        return 'vlm-result';
      });

      // ImageGen op tries to run (should wait for VLM inference to complete)
      const imageGenPromise = modelCoordinator.withImageGenOperation(async () => {
        events.push('imagegen-ready');
      });

      const [vlmResult] = await Promise.all([vlmPromise, imageGenPromise]);

      assert.strictEqual(vlmResult, 'vlm-result');

      // VLM inference must complete BEFORE ImageGen stops services
      const vlmEndIdx = events.indexOf('vlm-inference-end');
      const imageGenStopIdx = events.findIndex(e => e.startsWith('imagegen-prep'));

      assert.ok(imageGenStopIdx > -1, 'ImageGen should have stop operations');
      assert.ok(vlmEndIdx < imageGenStopIdx,
        `VLM inference must complete before ImageGen stops services. Order: ${events.join(' -> ')}`);
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
