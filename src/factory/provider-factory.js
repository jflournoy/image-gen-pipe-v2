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

// Real providers
const OpenAILLMProvider = require('../providers/openai-llm-provider');
const OpenAIImageProvider = require('../providers/openai-image-provider');
const CritiqueGenerator = require('../services/critique-generator');
// TODO: Add more real providers as they're implemented
// const OpenAIVisionProvider = require('../providers/openai-vision-provider');

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
    case 'openai':
      if (!config.llm.apiKey) {
        throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
      }
      return new OpenAILLMProvider(config.llm.apiKey, {
        model: config.llm.model,
        maxRetries: config.llm.maxRetries,
        timeout: config.llm.timeout
      });

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
    case 'openai':
      if (!config.image.apiKey) {
        throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
      }
      return new OpenAIImageProvider(config.image.apiKey, {
        model: config.image.model
      });

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

  // Always use mock for now - real provider not yet implemented
  // TODO: Implement OpenAIVisionProvider
  if (mode === 'real') {
    console.warn('⚠️  Vision provider: Using mock (real provider not yet implemented)');
  }
  return new MockVisionProvider();
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
  return new CritiqueGenerator({
    apiKey,
    model: options.model || 'gpt-4o-mini',
    maxRetries: options.maxRetries || config.llm.maxRetries,
    timeout: options.timeout || config.llm.timeout
  });
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
  createProviders
};
