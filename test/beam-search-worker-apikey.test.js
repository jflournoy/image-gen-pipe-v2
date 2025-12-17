const { describe, test } = require('node:test');
const assert = require('node:assert');

/**
 * Phase 2 TDD Tests: Beam Search Worker - API Key Integration
 *
 * These tests verify that the beam search worker:
 * 1. Requires a userApiKey parameter
 * 2. Passes userApiKey to all provider factories
 * 3. Does NOT fall back to process.env.OPENAI_API_KEY
 */

describe('🔴 RED: Beam Search Worker - API Key Integration', () => {
  // Mock the modules we'll need
  let mockLLMProvider;
  let mockImageProvider;
  let mockVisionProvider;
  let mockCritiqueGenerator;
  let mockImageRanker;
  let capturedApiKeys;
  let startBeamSearchJob;

  // Setup before each test
  const setupMocks = () => {
    capturedApiKeys = {
      llm: null,
      image: null,
      vision: null,
      critique: null,
      ranker: null
    };

    mockLLMProvider = { apiKey: null };
    mockImageProvider = { apiKey: null };
    mockVisionProvider = { apiKey: null };
    mockCritiqueGenerator = { apiKey: null };
    mockImageRanker = { apiKey: null };

    // Mock provider factory
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function(id) {
      if (id === '../factory/provider-factory.js') {
        return {
          createLLMProvider: (options) => {
            capturedApiKeys.llm = options?.apiKey;
            mockLLMProvider.apiKey = options?.apiKey;
            return mockLLMProvider;
          },
          createImageProvider: (options) => {
            capturedApiKeys.image = options?.apiKey;
            mockImageProvider.apiKey = options?.apiKey;
            return mockImageProvider;
          },
          createVisionProvider: (options) => {
            capturedApiKeys.vision = options?.apiKey;
            mockVisionProvider.apiKey = options?.apiKey;
            return mockVisionProvider;
          },
          createCritiqueGenerator: (options) => {
            capturedApiKeys.critique = options?.apiKey;
            mockCritiqueGenerator.apiKey = options?.apiKey;
            return mockCritiqueGenerator;
          },
          createImageRanker: (options) => {
            capturedApiKeys.ranker = options?.apiKey;
            mockImageRanker.apiKey = options?.apiKey;
            return mockImageRanker;
          }
        };
      }
      if (id === './server.js') {
        return {
          emitProgress: () => {}
        };
      }
      return originalRequire.apply(this, arguments);
    };

    // Load the beam search worker
    delete require.cache[require.resolve('../src/api/beam-search-worker.js')];
    startBeamSearchJob = require('../src/api/beam-search-worker.js').startBeamSearchJob;
  };

  describe('Issue 2.1: Worker requires userApiKey parameter', () => {
    test('should throw error if userApiKey is not provided', async () => {
      setupMocks();

      await assert.rejects(
        () => startBeamSearchJob('job-123', { prompt: 'test' }, null),
        { message: /API key.*required/i }
      );
    });

    test('should throw error if userApiKey is undefined', async () => {
      setupMocks();

      await assert.rejects(
        () => startBeamSearchJob('job-123', { prompt: 'test' }, undefined),
        { message: /API key.*required/i }
      );
    });

    test('should throw error if userApiKey is empty string', async () => {
      setupMocks();

      await assert.rejects(
        () => startBeamSearchJob('job-123', { prompt: 'test' }, ''),
        { message: /API key.*required/i }
      );
    });
  });

  describe('Issue 2.2: Worker passes userApiKey to provider factory', () => {
    test('should pass userApiKey to all provider factories', async () => {
      setupMocks();

      const testApiKey = 'sk-test-user-key-12345';
      try {
        await startBeamSearchJob(
          'job-123',
          { prompt: 'test', n: 1, m: 1, iterations: 1 },
          testApiKey
        );
      } catch (e) {
        // Ignore errors from incomplete mock setup, we just care about apiKey passing
      }

      assert.strictEqual(
        capturedApiKeys.llm,
        testApiKey,
        'LLM provider should receive userApiKey'
      );
      assert.strictEqual(
        capturedApiKeys.image,
        testApiKey,
        'Image provider should receive userApiKey'
      );
      assert.strictEqual(
        capturedApiKeys.vision,
        testApiKey,
        'Vision provider should receive userApiKey'
      );
      assert.strictEqual(
        capturedApiKeys.critique,
        testApiKey,
        'Critique generator should receive userApiKey'
      );
      assert.strictEqual(
        capturedApiKeys.ranker,
        testApiKey,
        'Image ranker should receive userApiKey'
      );
    });
  });

  describe('Issue 2.3: Worker does NOT use process.env.OPENAI_API_KEY fallback', () => {
    test('should use userApiKey even when OPENAI_API_KEY env var is set', async () => {
      setupMocks();

      const envApiKey = 'sk-env-key-should-not-use-this';
      const userApiKey = 'sk-user-key-use-this';
      const originalEnv = process.env.OPENAI_API_KEY;

      process.env.OPENAI_API_KEY = envApiKey;

      try {
        await startBeamSearchJob(
          'job-123',
          { prompt: 'test', n: 1, m: 1, iterations: 1 },
          userApiKey
        );
      } catch (e) {
        // Ignore errors, we only care about apiKey passing
      }

      assert.strictEqual(
        capturedApiKeys.llm,
        userApiKey,
        'Should use provided userApiKey, not env var'
      );
      assert.notStrictEqual(
        capturedApiKeys.llm,
        envApiKey,
        'Should NOT use OPENAI_API_KEY env var'
      );

      process.env.OPENAI_API_KEY = originalEnv;
    });
  });
});
