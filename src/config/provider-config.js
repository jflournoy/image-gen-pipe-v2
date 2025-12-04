/**
 * Provider Configuration
 *
 * Central configuration for switching between mock and real providers.
 * Supports environment variable configuration and runtime overrides.
 *
 * Model defaults updated December 2025 for cost optimization.
 * See docs/MODEL_SELECTION_GUIDE.md for pricing details.
 */

require('dotenv').config();

const providerConfig = {
  // Mode: 'mock' or 'real'
  mode: process.env.PROVIDER_MODE || 'mock',

  // LLM Provider Configuration
  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    // Support both single model (legacy) and operation-specific models
    // Using real models that exist today (not aspirational gpt-5 models)
    model: process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',  // Fallback: $0.15/1M tokens
    // Operation-specific models for cost optimization
    models: {
      expand: process.env.OPENAI_LLM_MODEL_EXPAND || process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',    // Simple: $0.15/1M
      refine: process.env.OPENAI_LLM_MODEL_REFINE || process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',    // Moderate: $0.15/1M
      combine: process.env.OPENAI_LLM_MODEL_COMBINE || process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini'   // Simple: $0.15/1M
    },
    maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES || '3', 10),
    timeout: parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10)
  },

  // Image Provider Configuration
  image: {
    provider: process.env.IMAGE_PROVIDER || 'dalle',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-3'  // Current DALL-E model
  },

  // Vision Provider Configuration
  vision: {
    provider: process.env.VISION_PROVIDER || 'gpt-vision',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini'  // Cost-optimized default: $0.15/1M tokens
  },

  // Scoring Provider Configuration
  scoring: {
    provider: process.env.SCORING_PROVIDER || 'mock'
    // Scoring typically stays mock or uses a custom implementation
  }
};

module.exports = providerConfig;
