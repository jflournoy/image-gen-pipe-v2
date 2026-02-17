/**
 * @file Black Forest Labs Image Provider
 * Implements image generation using BFL API (cloud-based Flux models)
 * Handles async polling pattern and signed URL expiration
 *
 * Content Moderation Retry:
 * - BFL may return "Request Moderated" during polling
 * - Sometimes moderation clears after a few polls (transient)
 * - Provider waits until moderationRetryThreshold (default: 10) polls before action
 * - If still moderated, uses LLM to rephrase prompt and resubmit
 * - Retries up to maxRephraseAttempts (default: 3) times
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');

/**
 * BFL Image Provider
 * Uses Black Forest Labs API for image generation
 * Handles async polling and downloads images before signed URLs expire
 */
class BFLImageProvider {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiKey - BFL API key (required)
   * @param {string} options.baseUrl - BFL API base URL
   * @param {string} options.model - Model identifier (flux-pro-1.1, flux-dev, etc.)
   * @param {string} options.sessionId - Session ID for output organization
   * @param {string} options.outputDir - Base output directory
   * @param {Object} options.generation - Generation settings (width, height, safety_tolerance)
   * @param {number} options.generation.safety_tolerance - Safety tolerance 0-6 (default: 2)
   * @param {number} options.maxPollTime - Max polling time in milliseconds
   * @param {number} options.pollInterval - Poll interval in milliseconds
   * @param {Object} options.llmProvider - LLM provider for prompt rephrasing on moderation
   * @param {number} options.moderationRetryThreshold - Polls before rephrasing (default: 10)
   * @param {number} options.maxRephraseAttempts - Max rephrase attempts (default: 3)
   * @param {string} options.rephraseSystemPrompt - Custom system prompt for rephrasing
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.BFL_API_KEY;
    this.baseUrl = options.baseUrl || process.env.BFL_API_URL || 'https://api.bfl.ai';
    this.model = options.model || process.env.BFL_MODEL || 'flux-2-pro';
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';

    // Validate model on construction
    this._validateModel(this.model);

    // Default generation settings
    const configDefaults = options.generation || {};
    this.generation = {
      width: configDefaults.width ?? 1024,
      height: configDefaults.height ?? 1024,
      safety_tolerance: configDefaults.safety_tolerance ?? 2
    };

    // Polling configuration
    this.maxPollTime = options.maxPollTime ?? 300000; // 5 minutes
    this.pollInterval = options.pollInterval ?? 2000;  // 2 seconds

    // Content moderation retry configuration
    this.llmProvider = options.llmProvider || null;
    this.moderationRetryThreshold = options.moderationRetryThreshold ?? 10;
    this.maxRephraseAttempts = options.maxRephraseAttempts ?? 3;
    this.rephraseSystemPrompt = options.rephraseSystemPrompt ||
      'Rephrase the following image generation prompt to be safe for content moderation while preserving the artistic intent. Return only the rephrased prompt, nothing else:';

    // Validate API key
    if (!this.apiKey) {
      throw new Error('BFL API key is required (set BFL_API_KEY environment variable or pass apiKey option)');
    }
  }

  /**
   * Validate model name against available BFL models
   * @param {string} model - Model name to validate (e.g., 'flux-2-pro', 'flux.2-pro')
   * @throws {Error} If model is not valid
   * @private
   */
  _validateModel(model) {
    const availableModels = BFLImageProvider.getAvailableModels();
    // Flatten available models into list of endpoint names
    const validFlux2 = Object.keys(availableModels['FLUX.2 (Latest)']);
    const validFlux1 = Object.keys(availableModels['FLUX.1 (Legacy)']);
    const validEndpoints = [...validFlux2, ...validFlux1];

    // Check for invalid FLUX.2 variants BEFORE mapping
    // This prevents flux.2-dev from being accepted (maps to flux-dev which is FLUX.1)
    const modelLower = (model || '').toLowerCase();
    if (modelLower.startsWith('flux.2-')) {
      const variant = modelLower.replace('flux.2-', '');
      // Only allow FLUX.2 variants that are explicitly listed in FLUX.2 section
      const flux2Variants = new Set([
        'pro',
        'flex',
        'max',
        'klein-4b',
        'klein-9b'
      ]);

      if (!flux2Variants.has(variant)) {
        throw new Error(
          `Invalid FLUX.2 variant: "flux.2-${variant}". ` +
          'Valid FLUX.2 models: flux.2-pro, flux.2-flex, flux.2-max, flux.2-klein-4b, flux.2-klein-9b'
        );
      }
    }

    // Map the input model to its endpoint (handles both 'flux.2-pro' and 'flux-2-pro' formats)
    const endpoint = this._getModelEndpoint(model);

    if (!validEndpoints.includes(endpoint)) {
      throw new Error(
        `Invalid BFL model: "${model}" (mapped to "${endpoint}"). ` +
        `Valid models: ${validEndpoints.join(', ')}`
      );
    }
  }

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - Text description of the image
   * @param {Object} options - Generation options
   * @param {number} options.width - Image width (default: 1024)
   * @param {number} options.height - Image height (default: 1024)
   * @param {number} options.safety_tolerance - Safety tolerance 0-6 (default: 2)
   * @param {string} options.model - Model override (flux-pro-1.1, flux-dev, flux.2-flex, etc.)
   * @param {number} options.steps - Number of diffusion steps (flex model only, 1-50)
   * @param {number} options.guidance - Guidance scale (flex model only, 1.5-10)
   * @param {number} options.seed - Random seed for reproducibility
   * @param {string} options.output_format - Output format (jpeg or png)
   * @param {number} options.iteration - Iteration number for file naming
   * @param {number} options.candidateId - Candidate ID for file naming
   * @param {string} options.sessionId - Session ID override
   * @returns {Promise<Object>} Generation result with localPath and metadata
   */
  async generateImage(prompt, options = {}) {
    try {
      // Validate prompt
      if (!prompt || prompt.trim() === '') {
        throw new Error('Prompt is required for image generation');
      }

      // Track moderation for metadata
      const moderationState = {
        originalPrompt: prompt,
        rephraseAttempts: 0,
        currentPrompt: prompt
      };

      return await this._generateWithModerationRetry(prompt, options, moderationState);
    } catch (error) {
      console.error(`[BFL Provider] Image generation failed: ${error.message}`);
      throw new Error(`Failed to generate image: ${error.message}`);
    }
  }

  /**
   * Internal method that handles generation with moderation retry logic
   * @param {string} prompt - Current prompt to use
   * @param {Object} options - Generation options
   * @param {Object} moderationState - State tracking for moderation retries
   * @returns {Promise<Object>} Generation result
   * @private
   */
  async _generateWithModerationRetry(prompt, options, moderationState) {
    // Use model from options or instance default
    const model = options.model || this.model;

    // Validate model before generation
    this._validateModel(model);

    // Build request parameters
    const params = {
      prompt: prompt,
      width: options.width ?? this.generation.width,
      height: options.height ?? this.generation.height,
      safety_tolerance: options.safety_tolerance ?? this.generation.safety_tolerance
    };

    // Add steps and guidance for flex model (not supported by pro/dev models)
    const isFlexModel = model.toLowerCase().includes('flex');
    if (isFlexModel) {
      if (options.steps !== undefined) {
        params.steps = options.steps;
      }
      if (options.guidance !== undefined) {
        params.guidance = options.guidance;
      }
    }

    // Add seed if provided (for reproducibility)
    if (options.seed !== undefined && options.seed !== null) {
      params.seed = options.seed;
    }

    // Add output format if specified
    if (options.output_format) {
      params.output_format = options.output_format;
    }

    // Log generation parameters to verify settings are being used
    const safetySource = options.safety_tolerance !== undefined ? 'options' : 'default';
    console.log(`[BFL Provider] model=${model}, safety_tolerance=${params.safety_tolerance} (from ${safetySource})`);
    if (isFlexModel) {
      console.log(`[BFL Provider] flex settings: steps=${params.steps || 'default'}, guidance=${params.guidance || 'default'}`);
    }
    if (params.seed !== undefined) {
      console.log(`[BFL Provider] seed=${params.seed}`);
    }
    console.log(`[BFL Provider] Submitting generation request for: "${prompt.substring(0, 50)}..."`);

    // Step 1: Submit generation request (pass model for endpoint selection)
    const { id, polling_url: pollingUrl } = await this._submitRequest(params, model);
    console.log(`[BFL Provider] Generation request submitted, id=${id}, polling_url=${pollingUrl}`);

    // Step 2: Poll for completion (may return moderation status)
    const pollResult = await this._pollForCompletion(pollingUrl, id);

    // Handle moderation case
    if (pollResult.moderated) {
      console.log(`[BFL Provider] Content moderated after ${pollResult.pollCount} polls for id=${id}`);

      // Check if we have an LLM provider for rephrasing
      if (!this.llmProvider) {
        throw new Error('Generation blocked: content moderation triggered, no LLM provider configured for rephrasing');
      }

      // Check if we've exceeded max rephrase attempts
      if (moderationState.rephraseAttempts >= this.maxRephraseAttempts) {
        throw new Error(`Generation blocked: content moderation persisted after max ${this.maxRephraseAttempts} rephrase attempts`);
      }

      // Rephrase the prompt using LLM
      console.log(`[BFL Provider] Rephrasing prompt (attempt ${moderationState.rephraseAttempts + 1}/${this.maxRephraseAttempts})`);
      const rephrasedPrompt = await this._rephrasePrompt(moderationState.currentPrompt);
      console.log(`[BFL Provider] Rephrased prompt: "${rephrasedPrompt.substring(0, 50)}..."`);

      // Update moderation state
      moderationState.rephraseAttempts++;
      moderationState.currentPrompt = rephrasedPrompt;

      // Retry with rephrased prompt
      return await this._generateWithModerationRetry(rephrasedPrompt, options, moderationState);
    }

    // Success case
    const result = pollResult;
    console.log(`[BFL Provider] Generation complete for id=${id}`);

    // Step 3: Download image from signed URL
    const imageBuffer = await this._downloadImage(result.sample, id);
    console.log(`[BFL Provider] Image downloaded for id=${id}, size=${imageBuffer.length} bytes`);

    // Step 4: Save to session directory
    const sessionId = options.sessionId || this.sessionId;
    let finalPath = null;
    if (sessionId && options.iteration !== undefined && options.candidateId !== undefined) {
      try {
        finalPath = await this._saveToSessionDir(imageBuffer, options.iteration, options.candidateId, sessionId);
        console.log(`[BFL Provider] Saved image to: ${finalPath}`);
      } catch (saveError) {
        console.warn(`[BFL Provider] Could not save to session dir: ${saveError.message}`);
        throw saveError;
      }
    }

    // Build metadata
    const metadata = {
      model: model, // Use the actual model (may be overridden from options)
      prompt: prompt,
      width: params.width,
      height: params.height,
      ...(params.steps && { steps: params.steps }),
      ...(params.guidance && { guidance: params.guidance }),
      ...(params.seed !== undefined && { seed: params.seed }),
      ...(params.output_format && { output_format: params.output_format }),
      bfl: {
        id: id,
        status: 'Ready'
      }
    };

    // Add moderation metadata if rephrasing occurred
    if (moderationState.rephraseAttempts > 0) {
      metadata.rephrased = true;
      metadata.moderation = {
        originalPrompt: moderationState.originalPrompt,
        rephraseAttempts: moderationState.rephraseAttempts
      };
    }

    // Return result in standard provider format
    return {
      url: undefined, // Don't return signed URLs as they expire in 10 minutes
      localPath: finalPath,
      revisedPrompt: undefined, // BFL doesn't revise prompts
      metadata
    };
  }

  /**
   * Submit generation request to BFL API
   * @param {Object} params - Generation parameters (prompt, width, height, etc.)
   * @param {string} model - Model to use (overrides instance default)
   * @returns {Promise<Object>} Response with id and polling_url
   * @private
   */
  async _submitRequest(params, model) {
    try {
      const endpoint = `${this.baseUrl}/v1/${this._getModelEndpoint(model)}`;

      const response = await axios.post(
        endpoint,
        params,
        {
          headers: {
            'x-key': this.apiKey,
            'Content-Type': 'application/json',
            'accept': 'application/json'
          },
          timeout: 30000
        }
      );

      const data = response.data;
      if (!data.id || !data.polling_url) {
        throw new Error('Unexpected response format: missing id or polling_url');
      }

      return data;
    } catch (error) {
      if (error.response?.status === 402) {
        throw new Error('BFL API: Out of credits');
      } else if (error.response?.status === 401) {
        throw new Error('BFL API: Invalid API key');
      } else if (error.response?.status === 429) {
        throw new Error('BFL API: Rate limit exceeded (max 24 concurrent tasks)');
      } else if (error.request) {
        throw new Error(`BFL API request failed: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Poll BFL API until generation is complete
   * @param {string} pollingUrl - URL to poll for results
   * @param {string} requestId - Request ID for logging
   * @returns {Promise<Object>} Result with sample (signed image URL) or moderation status
   * @private
   */
  async _pollForCompletion(pollingUrl, requestId) {
    const startTime = Date.now();
    let pollCount = 0;
    let moderationCount = 0;

    while (true) {
      const elapsed = Date.now() - startTime;

      // Check timeout
      if (elapsed > this.maxPollTime) {
        throw new Error(`Generation timeout: exceeded ${this.maxPollTime}ms`);
      }

      try {
        const response = await axios.get(
          pollingUrl,
          {
            headers: {
              'x-key': this.apiKey,
              'accept': 'application/json'
            },
            timeout: 10000
          }
        );

        pollCount++;
        const data = response.data;
        console.log(`[BFL Provider] Poll ${pollCount} for id=${requestId}: status=${data.status}`);

        if (data.status === 'Ready') {
          if (!data.result?.sample) {
            throw new Error('Invalid response: missing result.sample');
          }
          return data.result;
        }

        if (data.status === 'Failed' || data.status === 'Error') {
          throw new Error(`Generation failed: ${data.status}`);
        }

        // Handle both "Request Moderated" and "Content Moderated" status strings
        if (data.status === 'Request Moderated' || data.status === 'Content Moderated') {
          moderationCount++;
          console.log(`[BFL Provider] Moderation status ${moderationCount}/${this.moderationRetryThreshold} for id=${requestId}`);

          // If we've hit the threshold, return moderation result for retry handling
          if (pollCount >= this.moderationRetryThreshold) {
            return {
              moderated: true,
              pollCount: pollCount,
              moderationCount: moderationCount
            };
          }
          // Otherwise continue polling (moderation sometimes clears)
        }

        // Still processing or moderated (but under threshold), wait before next poll
        await this._sleep(this.pollInterval);
      } catch (error) {
        if (error.message?.includes('Generation')) {
          throw error; // Re-throw generation failures
        }
        // Network error or other axios error
        throw new Error(`Polling failed: ${error.message}`);
      }
    }
  }

  /**
   * Rephrase a prompt using the LLM provider to avoid content moderation
   * @param {string} prompt - Original prompt that was moderated
   * @returns {Promise<string>} Rephrased prompt
   * @private
   */
  async _rephrasePrompt(prompt) {
    if (!this.llmProvider) {
      throw new Error('No LLM provider configured for prompt rephrasing');
    }

    const fullPrompt = `${this.rephraseSystemPrompt}\n\n${prompt}`;

    try {
      const rephrased = await this.llmProvider.generateText(fullPrompt);
      return rephrased.trim();
    } catch (error) {
      throw new Error(`Failed to rephrase prompt: ${error.message}`);
    }
  }

  /**
   * Download image from signed URL
   * CRITICAL: Signed URLs expire after 10 minutes, must download immediately
   * @param {string} signedUrl - Signed image URL from BFL
   * @param {string} requestId - Request ID for logging
   * @returns {Promise<Buffer>} Image data as PNG buffer
   * @private
   */
  async _downloadImage(signedUrl, requestId) {
    try {
      console.log(`[BFL Provider] Downloading image from signed URL for id=${requestId}`);

      const response = await axios.get(signedUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: Failed to download image`);
      }

      const buffer = Buffer.from(response.data, 'binary');
      console.log(`[BFL Provider] Downloaded ${buffer.length} bytes for id=${requestId}`);

      return buffer;
    } catch (error) {
      throw new Error(`Failed to download image from signed URL: ${error.message}`);
    }
  }

  /**
   * Save image buffer to session directory
   * @param {Buffer} imageBuffer - PNG image data
   * @param {number} iteration - Iteration number
   * @param {number} candidateId - Candidate ID
   * @param {string} sessionId - Session ID for path construction
   * @returns {Promise<string>} Final path in session directory
   * @private
   */
  async _saveToSessionDir(imageBuffer, iteration, candidateId, sessionId) {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);
    const filename = `iter${iteration}-cand${candidateId}.png`;
    const finalPath = path.join(sessionDir, filename);

    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    // Write image file
    await fs.writeFile(finalPath, imageBuffer);

    return finalPath;
  }

  /**
   * Check health status of BFL API
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      // Try a simple request to validate API key
      // We'll submit a minimal request and immediately poll it
      const testResponse = await axios.post(
        `${this.baseUrl}/v1/${this._getModelEndpoint()}`,
        {
          prompt: 'test',
          width: 256,
          height: 256
        },
        {
          headers: {
            'x-key': this.apiKey,
            'Content-Type': 'application/json',
            'accept': 'application/json'
          },
          timeout: 10000
        }
      );

      if (testResponse.data?.id) {
        return {
          available: true,
          status: 'healthy',
          message: 'BFL API is accessible',
          model: this.model
        };
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        return {
          available: false,
          status: 'error',
          message: 'Invalid API key',
          error: 'Unauthorized'
        };
      } else if (error.response?.status === 402) {
        return {
          available: false,
          status: 'error',
          message: 'Out of credits',
          error: 'Out of credits'
        };
      } else {
        return {
          available: false,
          status: 'error',
          message: error.message,
          error: error.code || 'Unknown'
        };
      }
    }
  }

  /**
   * Get all available BFL models with descriptions
   * @returns {Object} Available models grouped by series
   */
  static getAvailableModels() {
    return {
      'FLUX.2 (Latest)': {
        'flux-2-max': 'Most powerful model, best quality',
        'flux-2-pro': 'Professional quality, balanced speed/quality',
        'flux-2-flex': 'Flexible model with steps/guidance control',
        'flux-2-klein-4b': 'Fastest, smallest (4B params), Apache 2.0 license',
        'flux-2-klein-9b': '9B variant, slightly slower than 4B but better quality'
      },
      'FLUX.1 (Legacy)': {
        'flux-pro-1.1': 'Professional quality',
        'flux-pro-1.1-ultra': 'Ultra high quality variant',
        'flux-dev': 'Development model'
      }
    };
  }

  /**
   * Map model identifier to API endpoint path
   * BFL models use different endpoint paths: /flux-2-pro, /flux-2-klein-4b, etc.
   * @param {string} modelOverride - Model to use (overrides instance default)
   * @returns {string} Model endpoint path (without /v1/ prefix)
   * @private
   */
  _getModelEndpoint(modelOverride) {
    // Model names can include or exclude the "flux-" prefix
    // Ensure consistent format
    const model = (modelOverride || this.model).toLowerCase();
    // Handle model names like "flux.2-pro" -> "flux-2-pro" mapping
    // BFL API endpoints: https://docs.bfl.ml/
    if (model.startsWith('flux-')) {
      return model;
    }
    // Handle UI model names like "flux.2-pro", "flux.2-flex", etc.
    if (model.startsWith('flux.2-')) {
      const variant = model.replace('flux.2-', '');
      // Map UI names to API endpoints
      const mappings = {
        'pro': 'flux-2-pro',
        'flex': 'flux-2-flex',
        'dev': 'flux-dev',
        'ultra': 'flux-pro-1.1-ultra',
        'klein-4b': 'flux-2-klein-4b',
        'klein-9b': 'flux-2-klein-9b',
        'max': 'flux-2-max'
      };
      const mapped = mappings[variant];
      if (!mapped) {
        throw new Error(
          `Unknown FLUX.2 variant: "${variant}". Valid variants: ${Object.keys(mappings).join(', ')}`
        );
      }
      return mapped;
    }
    // For other model names that don't start with known prefixes, throw error
    throw new Error(
      `Unknown model format: "${model}". Supported formats: flux-2-pro, flux.2-pro, flux-dev, etc.`
    );
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BFLImageProvider;
