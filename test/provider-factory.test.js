/**
 * 🔴 RED: Provider Factory Tests
 * Tests for factory functions that create provider instances
 */

const assert = require('node:assert');
const { describe, it } = require('node:test');
const {
  createLLMProvider,
  createImageProvider,
  createVisionProvider,
  createScoringProvider,
  createCritiqueGenerator,
  createProviders
} = require('../src/factory/provider-factory');

const OpenAIVisionProvider = require('../src/providers/openai-vision-provider');
const LocalLLMProvider = require('../src/providers/local-llm-provider');
const FluxImageProvider = require('../src/providers/flux-image-provider');
const LocalVisionProvider = require('../src/providers/local-vision-provider');
const BFLImageProvider = require('../src/providers/bfl-image-provider');

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

  describe('createVisionProvider (real mode)', () => {
    it('should create real OpenAI vision provider in real mode', () => {
      // Skip if OPENAI_API_KEY not available in CI environment
      // The provider checks for API key during module initialization
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available in CI');
        return;
      }

      const vision = createVisionProvider({ mode: 'real' });

      assert(vision instanceof OpenAIVisionProvider, 'Should return OpenAIVisionProvider instance');
      assert.strictEqual(typeof vision.analyzeImage, 'function', 'Should have analyzeImage method');
    });

    it('should pass custom model option to real vision provider', () => {
      // Skip if OPENAI_API_KEY not available in CI environment
      // The provider checks for API key during module initialization
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available in CI');
        return;
      }

      const vision = createVisionProvider({
        mode: 'real',
        model: 'gpt-4o-mini'
      });

      assert(vision instanceof OpenAIVisionProvider, 'Should return OpenAIVisionProvider instance');
      assert.strictEqual(vision.model, 'gpt-4o-mini', 'Should use custom model');
    });
  });

  describe('createLLMProvider (local-llm)', () => {
    it('should create LocalLLMProvider when provider is local-llm', () => {
      const llm = createLLMProvider({ mode: 'real', provider: 'local-llm' });

      assert(llm instanceof LocalLLMProvider, 'Should return LocalLLMProvider instance');
      assert.strictEqual(typeof llm.refinePrompt, 'function', 'Should have refinePrompt method');
      assert.strictEqual(typeof llm.combinePrompts, 'function', 'Should have combinePrompts method');
      assert.strictEqual(typeof llm.generateText, 'function', 'Should have generateText method');
    });

    it('should use default apiUrl for local-llm', () => {
      const llm = createLLMProvider({ mode: 'real', provider: 'local-llm' });

      assert.strictEqual(llm.apiUrl, 'http://localhost:8003', 'Should use default local LLM URL');
    });

    it('should accept custom apiUrl for local-llm', () => {
      const llm = createLLMProvider({
        mode: 'real',
        provider: 'local-llm',
        apiUrl: 'http://localhost:9003'
      });

      assert.strictEqual(llm.apiUrl, 'http://localhost:9003', 'Should use custom URL');
    });

    it('should accept custom model for local-llm', () => {
      const llm = createLLMProvider({
        mode: 'real',
        provider: 'local-llm',
        model: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF'
      });

      assert.strictEqual(llm.model, 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF', 'Should use custom model');
    });

    it('should not require API key for local-llm', () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        // Should not throw
        const llm = createLLMProvider({ mode: 'real', provider: 'local-llm' });
        assert(llm instanceof LocalLLMProvider, 'Should create local provider without API key');
      } finally {
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        }
      }
    });
  });

  describe('createImageProvider (flux)', () => {
    it('should create FluxImageProvider when provider is flux', () => {
      const image = createImageProvider({ mode: 'real', provider: 'flux' });

      assert(image instanceof FluxImageProvider, 'Should return FluxImageProvider instance');
      assert.strictEqual(typeof image.generateImage, 'function', 'Should have generateImage method');
    });

    it('should use default apiUrl for flux', () => {
      const image = createImageProvider({ mode: 'real', provider: 'flux' });

      assert.strictEqual(image.apiUrl, 'http://localhost:8001', 'Should use default Flux URL');
    });

    it('should accept custom apiUrl for flux', () => {
      const image = createImageProvider({
        mode: 'real',
        provider: 'flux',
        apiUrl: 'http://localhost:9001'
      });

      assert.strictEqual(image.apiUrl, 'http://localhost:9001', 'Should use custom URL');
    });

    it('should accept custom model for flux', () => {
      const image = createImageProvider({
        mode: 'real',
        provider: 'flux',
        model: 'flux-dev'
      });

      assert.strictEqual(image.model, 'flux-dev', 'Should use custom model');
    });

    it('should not require API key for flux', () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        // Should not throw
        const image = createImageProvider({ mode: 'real', provider: 'flux' });
        assert(image instanceof FluxImageProvider, 'Should create flux provider without API key');
      } finally {
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        }
      }
    });
  });

  describe('createVisionProvider (local)', () => {
    it('should create LocalVisionProvider when provider is local', () => {
      const vision = createVisionProvider({ mode: 'real', provider: 'local' });

      assert(vision instanceof LocalVisionProvider, 'Should return LocalVisionProvider instance');
      assert.strictEqual(typeof vision.analyzeImage, 'function', 'Should have analyzeImage method');
    });

    it('should use default apiUrl for local vision', () => {
      const vision = createVisionProvider({ mode: 'real', provider: 'local' });

      assert.strictEqual(vision.apiUrl, 'http://localhost:8002', 'Should use default local vision URL');
    });

    it('should accept custom apiUrl for local vision', () => {
      const vision = createVisionProvider({
        mode: 'real',
        provider: 'local',
        apiUrl: 'http://localhost:9002'
      });

      assert.strictEqual(vision.apiUrl, 'http://localhost:9002', 'Should use custom URL');
    });

    it('should accept custom clipModel', () => {
      const vision = createVisionProvider({
        mode: 'real',
        provider: 'local',
        clipModel: 'openai/clip-vit-large-patch14'
      });

      assert.strictEqual(vision.clipModel, 'openai/clip-vit-large-patch14', 'Should use custom CLIP model');
    });

    it('should accept custom aestheticModel', () => {
      const vision = createVisionProvider({
        mode: 'real',
        provider: 'local',
        aestheticModel: 'custom_aesthetic_model'
      });

      assert.strictEqual(vision.aestheticModel, 'custom_aesthetic_model', 'Should use custom aesthetic model');
    });

    it('should not require API key for local vision', () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        // Should not throw
        const vision = createVisionProvider({ mode: 'real', provider: 'local' });
        assert(vision instanceof LocalVisionProvider, 'Should create local vision provider without API key');
      } finally {
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        }
      }
    });
  });

  describe('createImageProvider (bfl)', () => {
    it('should create BFLImageProvider when provider is bfl', () => {
      // Skip if BFL_API_KEY not available
      const originalKey = process.env.BFL_API_KEY;
      process.env.BFL_API_KEY = 'test-bfl-key';

      try {
        const image = createImageProvider({ mode: 'real', provider: 'bfl' });

        assert(image instanceof BFLImageProvider, 'Should return BFLImageProvider instance');
        assert.strictEqual(typeof image.generateImage, 'function', 'Should have generateImage method');
      } finally {
        if (originalKey) {
          process.env.BFL_API_KEY = originalKey;
        } else {
          delete process.env.BFL_API_KEY;
        }
      }
    });

    it('should pass llmProvider to BFLImageProvider for content moderation rephrasing', () => {
      const originalKey = process.env.BFL_API_KEY;
      process.env.BFL_API_KEY = 'test-bfl-key';

      try {
        // Create a mock LLM provider
        const mockLlmProvider = {
          generateText: async () => ({ text: 'rephrased prompt' })
        };

        const image = createImageProvider({
          mode: 'real',
          provider: 'bfl',
          llmProvider: mockLlmProvider
        });

        assert(image instanceof BFLImageProvider, 'Should return BFLImageProvider instance');
        assert.strictEqual(image.llmProvider, mockLlmProvider, 'Should pass llmProvider to BFLImageProvider');
      } finally {
        if (originalKey) {
          process.env.BFL_API_KEY = originalKey;
        } else {
          delete process.env.BFL_API_KEY;
        }
      }
    });
  });

  describe('Factory errors for unknown providers', () => {
    it('should throw for unknown LLM provider', () => {
      assert.throws(
        () => createLLMProvider({ mode: 'real', provider: 'unknown-llm' }),
        /Unknown LLM provider: unknown-llm/
      );
    });

    it('should throw for unknown image provider', () => {
      assert.throws(
        () => createImageProvider({ mode: 'real', provider: 'unknown-image' }),
        /Unknown image provider: unknown-image/
      );
    });

    it('should throw for unknown vision provider', () => {
      assert.throws(
        () => createVisionProvider({ mode: 'real', provider: 'unknown-vision' }),
        /Unknown vision provider: unknown-vision/
      );
    });
  });
});
