/**
 * Provider Configuration
 *
 * Central configuration for switching between mock and real providers.
 * Supports environment variable configuration and runtime overrides.
 *
 * Library-wide defaults: gpt-5 era models with FLEX pricing support
 * Model defaults updated December 2025 for cost optimization.
 * See docs/MODEL_SELECTION_GUIDE.md for pricing details.
 */

require('dotenv').config({ override: true });

/**
 * Get the appropriate image model with soft fallback
 * gpt-5-image-mini requires org registration; falls back to gpt-image-1 with warning
 * @returns {string} Model name to use
 */
function getImageModel() {
  const explicit = process.env.OPENAI_IMAGE_MODEL;
  if (explicit) {
    return explicit;
  }

  // Check if org is registered for gpt-5-image-mini (indicated by env var)
  const orgRegisteredForGpt5 = process.env.OPENAI_ORG_REGISTERED_FOR_GPT5_IMAGE === 'true';

  if (!orgRegisteredForGpt5) {
    console.warn(
      '[Provider Config] gpt-5-image-mini requires org registration. ' +
      'Falling back to gpt-image-1. ' +
      'Set OPENAI_ORG_REGISTERED_FOR_GPT5_IMAGE=true to use gpt-5-image-mini.'
    );
    return 'gpt-image-1';
  }

  return 'gpt-5-image-mini';
}

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
  // Primary: gpt-5-image-mini (requires org registration)
  // Fallback: gpt-image-1 (with console warning if fallback is used)
  image: {
    provider: process.env.IMAGE_PROVIDER || 'dalle',
    apiKey: process.env.OPENAI_API_KEY,
    model: getImageModel()  // Smart fallback from gpt-5-image-mini to gpt-image-1
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
  },

  // Local Provider Configurations
  // These providers run locally via Python services

  // Local LLM Configuration (Python-based transformers)
  localLLM: {
    apiUrl: process.env.LOCAL_LLM_API_URL || 'http://localhost:8003',
    model: process.env.LOCAL_LLM_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2'
  },

  // Flux Image Generation Configuration (local)
  flux: {
    apiUrl: process.env.FLUX_API_URL || 'http://localhost:8001',
    model: process.env.FLUX_MODEL || 'flux-dev',  // FLUX.1-dev for quality + LoRA support (auto fp8)
    loras: process.env.FLUX_LORAS ? JSON.parse(process.env.FLUX_LORAS) : [],
    // Generation settings - can be overridden per-request or via environment variables
    generation: {
      steps: parseInt(process.env.FLUX_STEPS || '25', 10),        // Inference steps (15-50, default 25)
      guidance: parseFloat(process.env.FLUX_GUIDANCE || '3.5'),   // Guidance scale (1.0-20.0, Flux uses lower values)
      width: parseInt(process.env.FLUX_WIDTH || '1024', 10),      // Image width (512-2048)
      height: parseInt(process.env.FLUX_HEIGHT || '1024', 10),    // Image height (512-2048)
      loraScale: process.env.FLUX_LORA_SCALE ? parseFloat(process.env.FLUX_LORA_SCALE) : null  // LoRA strength (0.0-2.0)
    }
  },

  // Local Vision Configuration (CLIP + Aesthetics)
  localVision: {
    apiUrl: process.env.LOCAL_VISION_API_URL || 'http://localhost:8002',
    clipModel: process.env.CLIP_MODEL || 'openai/clip-vit-base-patch32',
    aestheticModel: process.env.AESTHETIC_MODEL || 'aesthetic_predictor_v2_5'
  }
};

module.exports = providerConfig;
module.exports.getImageModel = getImageModel;
