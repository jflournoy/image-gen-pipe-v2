/**
 * Provider Factory
 *
 * Creates provider instances based on configuration.
 * Handles switching between mock and real implementations.
 */

const config = require('../config/provider-config');

// Mock providers
const MockLLMProvider = require('../providers/mock-llm-provider');
const MockImageProvider = require('../providers/mock-image-provider');
const MockVisionProvider = require('../providers/mock-vision-provider');
const MockScoringProvider = require('../providers/mock-scoring-provider');
const MockCritiqueGenerator = require('../providers/mock-critique-generator');

// Real providers - OpenAI
const OpenAILLMProvider = require('../providers/openai-llm-provider');
const OpenAIImageProvider = require('../providers/openai-image-provider');
const OpenAIVisionProvider = require('../providers/openai-vision-provider');

// Real providers - Local
const LocalLLMProvider = require('../providers/local-llm-provider');
const FluxImageProvider = require('../providers/flux-image-provider');
const LocalVisionProvider = require('../providers/local-vision-provider');
const LocalVLMProvider = require('../providers/local-vlm-provider');

// Services
const CritiqueGenerator = require('../services/critique-generator');
const ImageRanker = require('../services/image-ranker');

/**
 * Create an LLM provider instance
 * @param {Object} options - Override configuration options
 * @returns {LLMProvider} LLM provider instance
 */
function createLLMProvider(options = {}) {
  const mode = options.mode || config.mode;

  if (mode === 'mock') {
    return new MockLLMProvider();
  }

  // Real provider
  const provider = options.provider || config.llm.provider;

  switch (provider) {
    case 'openai': {
      // Use provided apiKey option, fall back to config
      const apiKey = 'apiKey' in options ? options.apiKey : config.llm.apiKey;
      if (!apiKey) {
        throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
      }
      const instance = new OpenAILLMProvider(apiKey, {
        model: config.llm.model,
        models: config.llm.models,  // Operation-specific models for cost optimization
        maxRetries: config.llm.maxRetries,
        timeout: config.llm.timeout
      });
      // Store apiKey on instance for testing
      instance.apiKey = apiKey;
      return instance;
    }

    case 'local-llm': {
      return new LocalLLMProvider({
        apiUrl: options.apiUrl || config.localLLM?.apiUrl || 'http://localhost:8003',
        model: options.model || config.localLLM?.model || 'mistralai/Mistral-7B-Instruct-v0.2'
      });
    }

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Create an Image provider instance
 * @param {Object} options - Override configuration options
 * @returns {ImageProvider} Image provider instance
 */
function createImageProvider(options = {}) {
  const mode = options.mode || config.mode;

  if (mode === 'mock') {
    return new MockImageProvider();
  }

  // Real provider
  const provider = options.provider || config.image.provider;

  switch (provider) {
    case 'dalle':
    case 'openai': {
      // Use provided apiKey option, fall back to config
      const apiKey = 'apiKey' in options ? options.apiKey : config.image.apiKey;
      if (!apiKey) {
        throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
      }
      const instance = new OpenAIImageProvider(apiKey, {
        model: config.image.model
      });
      // Store apiKey on instance for testing
      instance.apiKey = apiKey;
      return instance;
    }

    case 'flux': {
      return new FluxImageProvider({
        apiUrl: options.apiUrl || config.flux?.apiUrl || 'http://localhost:8001',
        model: options.model || config.flux?.model || 'flux-dev',
        generation: options.generation || config.flux?.generation
      });
    }

    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }
}

/**
 * Create a Vision provider instance
 * @param {Object} options - Override configuration options
 * @returns {VisionProvider} Vision provider instance
 */
function createVisionProvider(options = {}) {
  const mode = options.mode || config.mode;

  if (mode === 'mock') {
    return new MockVisionProvider();
  }

  // Real provider
  const provider = options.provider || config.vision?.provider || 'openai';

  switch (provider) {
    case 'openai':
    case 'gpt-vision': {
      // Use provided apiKey option, fall back to config
      const apiKey = 'apiKey' in options ? options.apiKey : config.llm.apiKey;
      if (!apiKey) {
        throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
      }
      const instance = new OpenAIVisionProvider(apiKey, {
        model: options.model || config.vision?.model || 'gpt-5-nano',
        maxRetries: options.maxRetries || 3,
        timeout: options.timeout || 30000
      });
      // Store apiKey on instance for testing
      instance.apiKey = apiKey;
      return instance;
    }

    case 'local': {
      return new LocalVisionProvider({
        apiUrl: options.apiUrl || config.localVision?.apiUrl || 'http://localhost:8002',
        clipModel: options.clipModel || config.localVision?.clipModel || 'openai/clip-vit-base-patch32',
        aestheticModel: options.aestheticModel || config.localVision?.aestheticModel || 'aesthetic_predictor_v2_5'
      });
    }

    default:
      throw new Error(`Unknown vision provider: ${provider}`);
  }
}

/**
 * Create a Scoring provider instance
 * @param {Object} options - Override configuration options
 * @returns {ScoringProvider} Scoring provider instance
 */
function createScoringProvider(options = {}) {
  // Scoring typically stays mock or uses custom implementation
  // eslint-disable-next-line no-unused-vars
  const mode = options.mode || config.mode;
  return new MockScoringProvider();
}

/**
 * Create a Critique Generator instance
 * @param {Object} options - Override configuration options
 * @returns {CritiqueGenerator} Critique generator instance
 */
function createCritiqueGenerator(options = {}) {
  const mode = options.mode || config.mode;

  if (mode === 'mock') {
    return new MockCritiqueGenerator(options);
  }

  // Real critique generator (uses OpenAI for LLM-based critique)
  // Use explicit undefined check to allow passing undefined to override config
  const apiKey = 'apiKey' in options ? options.apiKey : config.llm.apiKey;
  const instance = new CritiqueGenerator({
    apiKey,
    model: options.model || 'gpt-4o-mini',
    maxRetries: options.maxRetries || config.llm.maxRetries,
    timeout: options.timeout || config.llm.timeout
  });
  // Store apiKey on instance for testing
  instance.apiKey = apiKey;
  return instance;
}

/**
 * Create an ImageRanker instance for comparative ranking
 * @param {Object} options - Override configuration options
 * @returns {ImageRanker|null} Image ranker instance or null for mock mode
 */
function createImageRanker(options = {}) {
  const mode = options.mode || config.mode;

  if (mode === 'mock') {
    // For mock mode, return null to skip ranking (fall back to scoring)
    return null;
  }

  // Real provider - ImageRanker always uses OpenAI
  // Use provided apiKey option, fall back to config
  const apiKey = 'apiKey' in options ? options.apiKey : config.llm.apiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key is required for ImageRanker. Set OPENAI_API_KEY environment variable.');
  }

  const ensembleSize = parseInt(process.env.ENSEMBLE_SIZE || '3', 10);

  const instance = new ImageRanker({
    apiKey,
    defaultEnsembleSize: ensembleSize
  });
  // Store apiKey on instance for testing
  instance.apiKey = apiKey;
  return instance;
}

/**
 * Create a VLM provider instance for pairwise image comparison
 * @param {Object} options - Override configuration options
 * @returns {LocalVLMProvider|null} VLM provider instance or null for mock mode
 */
function createVLMProvider(options = {}) {
  const mode = options.mode || config.mode;

  if (mode === 'mock') {
    // For mock mode, return null to skip VLM ranking
    return null;
  }

  // Real provider
  const provider = options.provider || config.vlm?.provider || 'local';

  switch (provider) {
    case 'local': {
      return new LocalVLMProvider({
        apiUrl: options.apiUrl || config.vlm?.apiUrl || 'http://localhost:8004',
        model: options.model || config.vlm?.model || 'llava-v1.6-mistral-7b.Q4_K_M.gguf'
      });
    }

    default:
      throw new Error(`Unknown VLM provider: ${provider}`);
  }
}

/**
 * Create all providers at once
 * @param {Object} options - Override configuration options
 * @returns {Object} Object with all provider instances
 */
function createProviders(options = {}) {
  return {
    llm: createLLMProvider(options),
    image: createImageProvider(options),
    vision: createVisionProvider(options),
    scoring: createScoringProvider(options)
  };
}

module.exports = {
  createLLMProvider,
  createImageProvider,
  createVisionProvider,
  createScoringProvider,
  createCritiqueGenerator,
  createImageRanker,
  createVLMProvider,
  createProviders
};
