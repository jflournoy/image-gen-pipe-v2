const { describe, test } = require('node:test');
const assert = require('node:assert');
const {
  createLLMProvider,
  createImageProvider,
  createVisionProvider,
  createCritiqueGenerator,
  createImageRanker
} = require('../src/factory/provider-factory.js');

/**
 * Phase 3 TDD Tests: Provider Factory - API Key Integration
 *
 * These tests verify that all provider factories accept and use
 * a custom apiKey option, and that they don't fall back to
 * OPENAI_API_KEY environment variable.
 */

describe('🔴 RED: Provider Factory - API Key Integration', () => {
  const customApiKey = 'sk-test-custom-key-12345';
  const envApiKey = 'sk-env-key-should-not-use-this';

  describe('Issue 3.1: LLM Provider accepts apiKey option', () => {
    test('should accept apiKey option and use it', () => {
      const provider = createLLMProvider({ apiKey: customApiKey });

      assert.strictEqual(
        provider.apiKey,
        customApiKey,
        'Provider should store apiKey'
      );
    });

    test('should use provided apiKey instead of env var', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = envApiKey;

      const provider = createLLMProvider({ apiKey: customApiKey });

      assert.strictEqual(provider.apiKey, customApiKey);
      assert.notStrictEqual(provider.apiKey, envApiKey);

      process.env.OPENAI_API_KEY = originalEnv;
    });
  });

  describe('Issue 3.2: Image Provider accepts apiKey option', () => {
    test('should accept apiKey option and use it', () => {
      const provider = createImageProvider({ apiKey: customApiKey });

      assert.strictEqual(
        provider.apiKey,
        customApiKey,
        'Image provider should store apiKey'
      );
    });

    test('should use provided apiKey instead of env var', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = envApiKey;

      const provider = createImageProvider({ apiKey: customApiKey });

      assert.strictEqual(provider.apiKey, customApiKey);
      assert.notStrictEqual(provider.apiKey, envApiKey);

      process.env.OPENAI_API_KEY = originalEnv;
    });
  });

  describe('Issue 3.3: Vision Provider accepts apiKey option', () => {
    test('should accept apiKey option and use it', () => {
      const provider = createVisionProvider({ apiKey: customApiKey });

      assert.strictEqual(
        provider.apiKey,
        customApiKey,
        'Vision provider should store apiKey'
      );
    });

    test('should use provided apiKey instead of env var', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = envApiKey;

      const provider = createVisionProvider({ apiKey: customApiKey });

      assert.strictEqual(provider.apiKey, customApiKey);
      assert.notStrictEqual(provider.apiKey, envApiKey);

      process.env.OPENAI_API_KEY = originalEnv;
    });
  });

  describe('Issue 3.4: Critique Generator accepts apiKey option', () => {
    test('should accept apiKey option and use it', () => {
      const provider = createCritiqueGenerator({ apiKey: customApiKey });

      assert.strictEqual(
        provider.apiKey,
        customApiKey,
        'Critique generator should store apiKey'
      );
    });

    test('should use provided apiKey instead of env var', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = envApiKey;

      const provider = createCritiqueGenerator({ apiKey: customApiKey });

      assert.strictEqual(provider.apiKey, customApiKey);
      assert.notStrictEqual(provider.apiKey, envApiKey);

      process.env.OPENAI_API_KEY = originalEnv;
    });
  });

  describe('Issue 3.5: Image Ranker accepts apiKey option', () => {
    test('should accept apiKey option and use it', () => {
      const provider = createImageRanker({ apiKey: customApiKey });

      assert.strictEqual(
        provider.apiKey,
        customApiKey,
        'Image ranker should store apiKey'
      );
    });

    test('should use provided apiKey instead of env var', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = envApiKey;

      const provider = createImageRanker({ apiKey: customApiKey });

      assert.strictEqual(provider.apiKey, customApiKey);
      assert.notStrictEqual(provider.apiKey, envApiKey);

      process.env.OPENAI_API_KEY = originalEnv;
    });
  });
});
