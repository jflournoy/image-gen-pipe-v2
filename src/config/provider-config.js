/**
 * Provider Configuration
 *
 * Central configuration for switching between mock and real providers.
 * Supports environment variable configuration and runtime overrides.
 */

require('dotenv').config();

const providerConfig = {
  // Mode: 'mock' or 'real'
  mode: process.env.PROVIDER_MODE || 'mock',

  // LLM Provider Configuration
  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_LLM_MODEL || 'gpt-4',
    maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES || '3', 10),
    timeout: parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10)
  },

  // Image Provider Configuration
  image: {
    provider: process.env.IMAGE_PROVIDER || 'dalle',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-3'
  },

  // Vision Provider Configuration
  vision: {
    provider: process.env.VISION_PROVIDER || 'gpt-vision',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_VISION_MODEL || 'gpt-4-vision-preview'
  },

  // Scoring Provider Configuration
  scoring: {
    provider: process.env.SCORING_PROVIDER || 'mock'
    // Scoring typically stays mock or uses a custom implementation
  }
};

module.exports = providerConfig;
