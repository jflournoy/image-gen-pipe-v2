/**
 * Rate Limit Configuration
 *
 * Sensible defaults for API request concurrency.
 * OpenAI providers can handle parallel requests; local providers process sequentially.
 */

const rateLimitConfig = {
  /**
   * Default concurrency limits for OpenAI providers
   * Based on OpenAI's actual rate limits:
   * - GPT-4: 10,000 tokens per minute (TPM) - ~10-20 requests/min depending on prompt size
   * - DALL-E 3: 5-50 requests per minute (depends on tier)
   * - GPT-4 Vision: Included in GPT-4 TPM limits
   */
  defaults: {
    // LLM (GPT-4): 3 concurrent requests
    // Rationale: Allows parallelization while staying well under TPM limits
    // With beam search: beamWidth * 2 (WHAT + HOW) = max 20 concurrent at beamWidth=10
    // At 3 concurrent: ~2 min for iteration, well under 10K TPM limit
    llm: parseInt(process.env.BEAM_SEARCH_RATE_LIMIT_LLM || '3', 10),

    // Image Generation (DALL-E 3): 2 concurrent requests
    // Rationale: DALL-E has stricter per-minute limits (5-50 RPM)
    // 2 concurrent is conservative and safe for all account tiers
    imageGen: parseInt(process.env.BEAM_SEARCH_RATE_LIMIT_IMAGE_GEN || '2', 10),

    // Vision API (GPT-4 Vision): 3 concurrent requests
    // Rationale: Uses same pool as GPT-4 LLM, but typically shorter prompts
    // 3 concurrent provides good parallelization while respecting TPM
    vision: parseInt(process.env.BEAM_SEARCH_RATE_LIMIT_VISION || '3', 10)
  },

  /**
   * Concurrency limits for local providers (single GPU, sequential processing)
   * Local services process requests one at a time on GPU, so parallelism
   * just creates queue wait times without speedup.
   */
  local: {
    // Local LLM: 1 concurrent (sequential processing on single GPU)
    // Rationale: llama.cpp or transformers process one request at a time
    llm: parseInt(process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_LLM || '1', 10),

    // Local Image Gen (Flux/SDXL): 1 concurrent
    // Rationale: Single GPU processes one image at a time
    imageGen: parseInt(process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_IMAGE || '1', 10),

    // Local Vision (CLIP + Aesthetic): 1 concurrent
    // Rationale: Vision models share GPU with other services
    vision: parseInt(process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_VISION || '1', 10)
  },

  /**
   * Documentation of rate limit rationale
   */
  rationale: {
    llm: 'GPT-4: 10,000 TPM limit. 3 concurrent with typical prompt sizes (~100-500 tokens) = ~200-1500 TPM. Conservative estimate: 3x buffer for safety.',
    imageGen: 'DALL-E 3: 5-50 RPM depending on tier. 2 concurrent covers all tiers safely. Safest choice given variance in account limits.',
    vision: 'GPT-4 Vision: Uses GPT-4 TPM pool. 3 concurrent with image analysis (~300-500 tokens) = ~900-1500 TPM. Conservative estimate: 3x buffer for safety.'
  },

  /**
   * Get effective rate limit for a provider (defaults to OpenAI limits)
   * Checks environment variables first, then falls back to defaults
   *
   * @param {string} provider - Provider name: 'llm', 'imageGen', or 'vision'
   * @returns {number} Concurrent request limit
   */
  getLimit(provider) {
    if (!this.defaults[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    return this.defaults[provider];
  },

  /**
   * Get rate limit for local providers
   *
   * @param {string} provider - Provider name: 'llm', 'imageGen', or 'vision'
   * @returns {number} Concurrent request limit for local provider
   */
  getLocalLimit(provider) {
    if (!this.local[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    return this.local[provider];
  },

  /**
   * Get rate limit based on provider type (local vs OpenAI)
   *
   * @param {string} provider - Provider name: 'llm', 'imageGen', or 'vision'
   * @param {boolean} isLocal - Whether using local providers
   * @returns {number} Concurrent request limit
   */
  getLimitForType(provider, isLocal) {
    return isLocal ? this.getLocalLimit(provider) : this.getLimit(provider);
  },

  /**
   * Get all defaults as an object suitable for beam search config
   * @returns {Object} { llm, imageGen, vision }
   */
  getAllDefaults() {
    return {
      llm: this.defaults.llm,
      imageGen: this.defaults.imageGen,
      vision: this.defaults.vision
    };
  },

  /**
   * Get all local limits as an object
   * @returns {Object} { llm, imageGen, vision }
   */
  getAllLocalLimits() {
    return {
      llm: this.local.llm,
      imageGen: this.local.imageGen,
      vision: this.local.vision
    };
  }
};

module.exports = rateLimitConfig;
