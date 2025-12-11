/**
 * Provider Configuration
 *
 * Central configuration for switching between mock and real providers.
 * Supports environment variable configuration and runtime overrides.
 *
 * Model defaults updated December 2025 for cost optimization.
 * See docs/MODEL_SELECTION_GUIDE.md for pricing details.
 */

require('dotenv').config({ override: true });

const providerConfig = {
  // Mode: 'mock' or 'real'
  mode: process.env.PROVIDER_MODE || 'mock',

  // LLM Provider Configuration
  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    // Support both single model (legacy) and operation-specific models
    // Using gpt-5 era models with FLEX pricing support
    model: process.env.OPENAI_LLM_MODEL || 'gpt-5-mini',  // Fallback: gpt-5-mini FLEX pricing: $0.125/1M tokens
    // Operation-specific models for cost optimization
    models: {
      expand: process.env.OPENAI_LLM_MODEL_EXPAND || process.env.OPENAI_LLM_MODEL || 'gpt-5-nano',    // Simple: gpt-5-nano FLEX: $0.025/1M
      refine: process.env.OPENAI_LLM_MODEL_REFINE || process.env.OPENAI_LLM_MODEL || 'gpt-5-mini',    // Moderate: gpt-5-mini FLEX: $0.125/1M
      combine: process.env.OPENAI_LLM_MODEL_COMBINE || process.env.OPENAI_LLM_MODEL || 'gpt-5-nano'   // Simple: gpt-5-nano FLEX: $0.025/1M
    },
    maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES || '3', 10),
    timeout: parseInt(process.env.OPENAI_TIMEOUT_MS || '60000', 10)  // 60s for gpt-5 models
  },

  // Image Provider Configuration
  image: {
    provider: process.env.IMAGE_PROVIDER || 'dalle',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-5-image-mini'  // gpt-5-image-mini: $2.00/1M input tokens
  },

  // Vision Provider Configuration
  vision: {
    provider: process.env.VISION_PROVIDER || 'gpt-vision',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_VISION_MODEL || 'gpt-5-nano',  // gpt-5-nano FLEX pricing: $0.025/1M tokens (50% savings vs Standard)
    tier: 'flex'  // Explicitly use FLEX pricing for 50% cost savings
  },

  // Scoring Provider Configuration
  scoring: {
    provider: process.env.SCORING_PROVIDER || 'mock'
    // Scoring typically stays mock or uses a custom implementation
  }
};

module.exports = providerConfig;
