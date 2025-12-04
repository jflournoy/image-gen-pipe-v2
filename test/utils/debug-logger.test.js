/**
 * 🔴 TDD RED Phase: Debug Logger Tests
 *
 * Tests for DebugLogger utility that displays model names and token counts
 * during demo execution for better visibility and debugging.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const DebugLogger = require('../../src/utils/debug-logger.js');

describe('DebugLogger', () => {
  describe('constructor', () => {
    test('should create logger with debug mode enabled', () => {
      const logger = new DebugLogger({ debug: true });
      assert.strictEqual(logger.debugEnabled, true);
    });

    test('should create logger with debug mode disabled by default', () => {
      const logger = new DebugLogger();
      assert.strictEqual(logger.debugEnabled, false);
    });
  });

  describe('logProviderCall', () => {
    test('should format and return debug info when debug is enabled', () => {
      const logger = new DebugLogger({ debug: true });

      const result = logger.logProviderCall({
        provider: 'llm',
        operation: 'expand',
        metadata: {
          model: 'gpt-4o',
          tokensUsed: 1234
        }
      });

      // Should return formatted debug string
      assert.ok(result.includes('gpt-4o'));
      assert.ok(result.includes('1234'));
      assert.ok(result.includes('llm'));
      assert.ok(result.includes('expand'));
    });

    test('should return empty string when debug is disabled', () => {
      const logger = new DebugLogger({ debug: false });

      const result = logger.logProviderCall({
        provider: 'llm',
        operation: 'expand',
        metadata: {
          model: 'gpt-4o',
          tokensUsed: 1234
        }
      });

      assert.strictEqual(result, '');
    });

    test('should handle vision provider calls', () => {
      const logger = new DebugLogger({ debug: true });

      const result = logger.logProviderCall({
        provider: 'vision',
        operation: 'analyze',
        metadata: {
          model: 'gpt-4o',
          tokensUsed: 2500
        }
      });

      assert.ok(result.includes('gpt-4o'));
      assert.ok(result.includes('2500'));
      assert.ok(result.includes('vision'));
    });

    test('should handle image generation calls (no tokens)', () => {
      const logger = new DebugLogger({ debug: true });

      const result = logger.logProviderCall({
        provider: 'image',
        operation: 'generate',
        metadata: {
          model: 'dall-e-3'
          // Note: DALL-E doesn't return token counts
        }
      });

      assert.ok(result.includes('dall-e-3'));
      assert.ok(result.includes('image'));
    });

    test('should handle missing metadata gracefully', () => {
      const logger = new DebugLogger({ debug: true });

      const result = logger.logProviderCall({
        provider: 'llm',
        operation: 'expand',
        metadata: {}
      });

      // Should not throw, should return some output
      assert.ok(result.length > 0);
    });
  });

  describe('formatModelInfo', () => {
    test('should format model name and tokens in compact form', () => {
      const logger = new DebugLogger({ debug: true });

      const result = logger.formatModelInfo({
        model: 'gpt-4o-mini',
        tokensUsed: 1500
      });

      // Should be compact: [gpt-4o-mini | 1500 tokens]
      assert.ok(result.includes('gpt-4o-mini'));
      assert.ok(result.includes('1500'));
      assert.ok(result.includes('tokens'));
    });

    test('should format model name only when no tokens', () => {
      const logger = new DebugLogger({ debug: true });

      const result = logger.formatModelInfo({
        model: 'dall-e-3'
      });

      assert.ok(result.includes('dall-e-3'));
      assert.ok(!result.includes('tokens'));
    });

    test('should handle missing model name', () => {
      const logger = new DebugLogger({ debug: true });

      const result = logger.formatModelInfo({
        tokensUsed: 1500
      });

      // Should show tokens even without model
      assert.ok(result.includes('1500'));
    });
  });

  describe('wrapProvider - LLM', () => {
    test('should wrap LLM provider and log debug info', async () => {
      const logger = new DebugLogger({ debug: true });

      const mockLLM = {
        refinePrompt: async (_prompt, _options) => {
          return {
            refinedPrompt: 'refined content',
            metadata: {
              model: 'gpt-4o',
              tokensUsed: 800
            }
          };
        }
      };

      const wrapped = logger.wrapProvider(mockLLM, 'llm');
      const result = await wrapped.refinePrompt('test', { operation: 'expand' });

      // Should return the original result
      assert.strictEqual(result.refinedPrompt, 'refined content');
      assert.strictEqual(result.metadata.model, 'gpt-4o');
      assert.strictEqual(result.metadata.tokensUsed, 800);

      // Should have debug info attached
      assert.ok(result._debugInfo);
      assert.ok(result._debugInfo.includes('gpt-4o'));
      assert.ok(result._debugInfo.includes('800'));
    });
  });

  describe('wrapProvider - Vision', () => {
    test('should wrap vision provider and log debug info', async () => {
      const logger = new DebugLogger({ debug: true });

      const mockVision = {
        analyzeImage: async (_url, _prompt) => {
          return {
            alignmentScore: 75,
            aestheticScore: 8,
            analysis: 'Good match',
            metadata: {
              model: 'gpt-4o',
              tokensUsed: 1200
            }
          };
        }
      };

      const wrapped = logger.wrapProvider(mockVision, 'vision');
      const result = await wrapped.analyzeImage('http://example.com/image.png', 'test prompt');

      // Should return original result
      assert.strictEqual(result.alignmentScore, 75);
      assert.strictEqual(result.metadata.model, 'gpt-4o');

      // Should have debug info
      assert.ok(result._debugInfo);
      assert.ok(result._debugInfo.includes('gpt-4o'));
      assert.ok(result._debugInfo.includes('1200'));
    });
  });

  describe('wrapProvider - Image', () => {
    test('should wrap image provider and log debug info', async () => {
      const logger = new DebugLogger({ debug: true });

      const mockImage = {
        generateImage: async (_prompt, _options) => {
          return {
            url: 'http://example.com/image.png',
            metadata: {
              model: 'dall-e-3'
            }
          };
        }
      };

      const wrapped = logger.wrapProvider(mockImage, 'image');
      const result = await wrapped.generateImage('test prompt', { iteration: 0, candidateId: 0 });

      // Should return original result
      assert.strictEqual(result.url, 'http://example.com/image.png');
      assert.strictEqual(result.metadata.model, 'dall-e-3');

      // Should have debug info
      assert.ok(result._debugInfo);
      assert.ok(result._debugInfo.includes('dall-e-3'));
    });
  });

  describe('integration with debug mode off', () => {
    test('should not add debug info when debug is disabled', async () => {
      const logger = new DebugLogger({ debug: false });

      const mockLLM = {
        refinePrompt: async (_prompt, _options) => {
          return {
            refinedPrompt: 'refined content',
            metadata: {
              model: 'gpt-4o',
              tokensUsed: 800
            }
          };
        }
      };

      const wrapped = logger.wrapProvider(mockLLM, 'llm');
      const result = await wrapped.refinePrompt('test', { operation: 'expand' });

      // Should return original result
      assert.strictEqual(result.refinedPrompt, 'refined content');

      // Should NOT have debug info
      assert.ok(!result._debugInfo);
    });
  });
});
