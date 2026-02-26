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
const ChromaImageProvider = require('../providers/chroma-image-provider');
const LocalVisionProvider = require('../providers/local-vision-provider');
const LocalVLMProvider = require('../providers/local-vlm-provider');

// Real providers - Cloud APIs
const BFLImageProvider = require('../providers/bfl-image-provider');
const ModalImageProvider = require('../providers/modal-image-provider');
const ModalVideoProvider = require('../providers/modal-video-provider');

// Services
const CritiqueGenerator = require('../services/critique-generator');
const ImageRanker = require('../services/image-ranker');

// Utilities
const modelCoordinator = require('../utils/model-coordinator');
const serviceManager = require('../utils/service-manager');

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
        apiUrl: options.apiUrl || config.localLLM?.apiUrl || serviceManager.getServiceUrl('llm'),
        model: options.model || config.localLLM?.model || 'mistralai/Mistral-7B-Instruct-v0.2',
        serviceRestarter: options.serviceRestarter || modelCoordinator.createLLMServiceRestarter()
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
        apiUrl: options.apiUrl || config.flux?.apiUrl || serviceManager.getServiceUrl('flux'),
        model: options.model || config.flux?.model || 'flux-dev',
        generation: options.generation || config.flux?.generation,
        serviceRestarter: options.serviceRestarter || modelCoordinator.createServiceRestarter('flux')
      });
    }

    case 'chroma': {
      return new ChromaImageProvider({
        apiUrl: options.apiUrl || config.chroma?.apiUrl || serviceManager.getServiceUrl('chroma'),
        model: options.model || config.chroma?.model || 'chroma-1-hd',
        generation: options.generation || config.chroma?.generation,
        serviceRestarter: options.serviceRestarter || modelCoordinator.createServiceRestarter('chroma')
      });
    }

    case 'bfl': {
      return new BFLImageProvider({
        apiKey: options.apiKey || config.bfl?.apiKey,
        baseUrl: options.baseUrl || config.bfl?.baseUrl || 'https://api.bfl.ai',
        model: options.model || config.bfl?.model || 'flux-2-pro',
        generation: options.generation || config.bfl?.generation,
        maxPollTime: options.maxPollTime || config.bfl?.maxPollTime,
        pollInterval: options.pollInterval || config.bfl?.pollInterval,
        sessionId: options.sessionId,
        outputDir: options.outputDir,
        llmProvider: options.llmProvider
      });
    }

    case 'modal': {
      return new ModalImageProvider({
        apiUrl: options.apiUrl || config.modal?.apiUrl,
        tokenId: options.tokenId || config.modal?.tokenId,
        tokenSecret: options.tokenSecret || config.modal?.tokenSecret,
        model: options.model || config.modal?.model || 'flux-dev',
        generation: options.generation || config.modal?.generation,
        timeout: options.timeout || config.modal?.timeout,
        sessionId: options.sessionId,
        outputDir: options.outputDir
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
        apiUrl: options.apiUrl || config.localVision?.apiUrl || serviceManager.getServiceUrl('vision'),
        clipModel: options.clipModel || config.localVision?.clipModel || 'openai/clip-vit-base-patch32',
        aestheticModel: options.aestheticModel || config.localVision?.aestheticModel || 'aesthetic_predictor_v2_5',
        serviceRestarter: options.serviceRestarter || modelCoordinator.createServiceRestarter('vision')
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
 * @param {Object} [options.llmProvider] - LLM provider instance to use for critique generation
 * @returns {CritiqueGenerator} Critique generator instance
 */
function createCritiqueGenerator(options = {}) {
  const mode = options.mode || config.mode;

  if (mode === 'mock') {
    return new MockCritiqueGenerator(options);
  }

  // Use injected llmProvider — critique uses whatever LLM service is selected
  const llmProvider = options.llmProvider;
  return new CritiqueGenerator({ llmProvider });
}

/**
 * Create an ImageRanker instance for comparative ranking
 * @param {Object} options - Override configuration options
 * @param {number} [options.alignmentWeight] - Weight for prompt alignment vs aesthetics (0-1, default 0.7)
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
    alignmentWeight: options.alignmentWeight,
    defaultEnsembleSize: ensembleSize
  });
  // Store apiKey on instance for testing
  instance.apiKey = apiKey;
  return instance;
}

/**
 * Create a VLM provider instance for pairwise image comparison
 * @param {Object} options - Override configuration options
 * @param {number} [options.alignmentWeight] - Weight for prompt alignment vs aesthetics (0-1, default 0.7)
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
      const apiUrl = options.apiUrl || config.vlm?.apiUrl || serviceManager.getServiceUrl('vlm');

      const vlmProvider = new LocalVLMProvider({
        apiUrl,
        model: options.model || config.vlm?.model || 'llava-v1.6-mistral-7b.Q4_K_M.gguf',
        alignmentWeight: options.alignmentWeight,
        serviceRestarter: options.serviceRestarter || modelCoordinator.createVLMServiceRestarter()
      });
      return vlmProvider;
    }

    default:
      throw new Error(`Unknown VLM provider: ${provider}`);
  }
}

/**
 * Create a Video provider instance
 * @param {Object} options - Override configuration options
 * @returns {VideoProvider} Video provider instance
 */
function createVideoProvider(options = {}) {
  // Video always uses real providers (no mock implementation)
  const provider = options.provider || config.video?.provider || 'modal';

  switch (provider) {
    case 'modal': {
      return new ModalVideoProvider({
        apiUrl: options.apiUrl || config.modal?.videoApiUrl,
        healthUrl: options.healthUrl || config.modal?.videoHealthUrl,
        tokenId: options.tokenId || config.modal?.tokenId,
        tokenSecret: options.tokenSecret || config.modal?.tokenSecret,
        model: options.model || config.modal?.videoModel || 'wan2.2-i2v-high',
        generation: options.generation || config.modal?.videoGeneration,
        timeout: options.timeout || config.modal?.videoTimeout,
        sessionId: options.sessionId,
        outputDir: options.outputDir
      });
    }

    default:
      throw new Error(`Unknown video provider: ${provider}`);
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
  createVideoProvider,
  createProviders
};
