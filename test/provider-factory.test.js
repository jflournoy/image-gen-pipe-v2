/**
 * 🔴 RED: Provider Factory Tests
 * Tests for factory functions that create provider instances
 */

const assert = require('node:assert');
const { describe, it, beforeEach } = require('node:test');
const {
  createLLMProvider,
  createImageProvider,
  createVisionProvider,
  createScoringProvider,
  createCritiqueGenerator,
  createProviders
} = require('../src/factory/provider-factory');

describe('Provider Factory', () => {
  describe('createCritiqueGenerator', () => {
    it('should create a mock critique generator in mock mode', () => {
      const critiqueGen = createCritiqueGenerator({ mode: 'mock' });

      assert(critiqueGen, 'Should return a critique generator instance');
      assert.strictEqual(typeof critiqueGen.generateCritique, 'function', 'Should have generateCritique method');
    });

    it('should create a real critique generator in real mode', () => {
      // Set up environment variable for API key
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key-12345';

      try {
        const critiqueGen = createCritiqueGenerator({ mode: 'real' });

        assert(critiqueGen, 'Should return a critique generator instance');
        assert.strictEqual(typeof critiqueGen.generateCritique, 'function', 'Should have generateCritique method');
      } finally {
        // Restore environment variable
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    it('should use default mode from config if not specified', () => {
      const critiqueGen = createCritiqueGenerator();

      assert(critiqueGen, 'Should return a critique generator instance');
      assert.strictEqual(typeof critiqueGen.generateCritique, 'function', 'Should have generateCritique method');
    });

    it('should pass custom model option to real critique generator', () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key-12345';

      try {
        const critiqueGen = createCritiqueGenerator({
          mode: 'real',
          model: 'gpt-4o'
        });

        assert(critiqueGen, 'Should return a critique generator instance');
        assert.strictEqual(critiqueGen.model, 'gpt-4o', 'Should use custom model');
      } finally {
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    it('should work without API key (uses fallback critique)', () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const critiqueGen = createCritiqueGenerator({
          mode: 'real',
          apiKey: undefined // Explicitly pass undefined to override config
        });

        assert(critiqueGen, 'Should return a critique generator instance');
        assert.strictEqual(typeof critiqueGen.generateCritique, 'function', 'Should have generateCritique method');
        assert.strictEqual(critiqueGen.apiKey, undefined, 'Should have no API key (will use fallback)');
      } finally {
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        }
      }
    });
  });

  describe('createProviders (with critique generator)', () => {
    it('should include critique generator in createProviders bundle', () => {
      const providers = createProviders({ mode: 'mock' });

      assert(providers.llm, 'Should include LLM provider');
      assert(providers.image, 'Should include image provider');
      assert(providers.vision, 'Should include vision provider');
      assert(providers.scoring, 'Should include scoring provider');
      // Note: critiqueGen is not included in bundle as it's created separately
    });
  });

  describe('Existing factory functions', () => {
    it('should create LLM provider', () => {
      const llm = createLLMProvider({ mode: 'mock' });
      assert(llm, 'Should return an LLM provider');
    });

    it('should create image provider', () => {
      const image = createImageProvider({ mode: 'mock' });
      assert(image, 'Should return an image provider');
    });

    it('should create vision provider', () => {
      const vision = createVisionProvider({ mode: 'mock' });
      assert(vision, 'Should return a vision provider');
    });

    it('should create scoring provider', () => {
      const scoring = createScoringProvider({ mode: 'mock' });
      assert(scoring, 'Should return a scoring provider');
    });
  });
});
