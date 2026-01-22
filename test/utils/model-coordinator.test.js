/**
 * 🔴 RED: Model Coordinator Tests
 *
 * Tests for GPU memory coordination between local services (LLM, Flux, Vision, VLM)
 * Ensures proper service switching on single 12GB GPU
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('ModelCoordinator', () => {
  let modelCoordinator;

  beforeEach(() => {
    // Clear module cache to get fresh instance with clean state
    delete require.cache[require.resolve('../../src/utils/model-coordinator.js')];
    modelCoordinator = require('../../src/utils/model-coordinator.js');
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('🔴 prepareForLLM', () => {
    test('should unload Flux service to free GPU memory', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForLLM();

      assert.ok(fluxUnload.isDone(), 'Should POST to flux /unload endpoint');
    });

    test('should handle Flux service unavailable gracefully', async () => {
      nock('http://localhost:8001')
        .post('/unload')
        .replyWithError('ECONNREFUSED');

      // Should not throw
      await assert.doesNotReject(
        () => modelCoordinator.prepareForLLM(),
        'Should gracefully handle service unavailable'
      );
    });
  });

  describe('🔴 prepareForVLM', () => {
    test('should unload Flux service to free GPU memory for VLM', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForVLM();

      assert.ok(fluxUnload.isDone(), 'Should POST to flux /unload endpoint');
    });

    test('should handle Flux service unavailable gracefully', async () => {
      nock('http://localhost:8001')
        .post('/unload')
        .replyWithError('Connection timeout');

      // Should not throw
      await assert.doesNotReject(
        () => modelCoordinator.prepareForVLM(),
        'Should gracefully handle service unavailable'
      );
    });
  });

  describe('🔴 prepareForImageGen', () => {
    test('should unload LLM service to free GPU memory for Flux', async () => {
      const llmUnload = nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForImageGen();

      assert.ok(llmUnload.isDone(), 'Should POST to llm /unload endpoint');
    });

    test('should handle LLM service unavailable gracefully', async () => {
      nock('http://localhost:8003')
        .post('/unload')
        .replyWithError('ECONNREFUSED');

      // Should not throw
      await assert.doesNotReject(
        () => modelCoordinator.prepareForImageGen(),
        'Should gracefully handle service unavailable'
      );
    });
  });

  describe('🔴 service unavailable handling', () => {
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

  describe('🔴 getModelStates', () => {
    test('should return current state of all models', async () => {
      const state = modelCoordinator.getModelStates();

      assert.ok(typeof state === 'object', 'Should return object');
      assert.ok(state.hasOwnProperty('llm'), 'Should have llm state');
      assert.ok(state.hasOwnProperty('flux'), 'Should have flux state');
      assert.ok(state.hasOwnProperty('vision'), 'Should have vision state');
      assert.ok(state.hasOwnProperty('vlm'), 'Should have vlm state');

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

  describe('🔴 cleanupAll', () => {
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
});
