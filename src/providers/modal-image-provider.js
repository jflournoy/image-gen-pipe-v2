/**
 * @file Modal Image Provider
 * Implements image generation using Modal cloud GPUs
 * Supports arbitrary diffusion models (Flux, SDXL, SD3, etc.)
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');

/**
 * Modal Image Provider
 * Uses Modal's cloud GPU infrastructure for image generation
 * Handles authentication, cold starts, and image saving
 */
class ModalImageProvider {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - Modal web endpoint URL
   * @param {string} options.tokenId - Modal Token ID (or MODAL_TOKEN_ID env var)
   * @param {string} options.tokenSecret - Modal Token Secret (or MODAL_TOKEN_SECRET env var)
   * @param {string} options.model - Model identifier (flux-dev, sdxl-turbo, etc.)
   * @param {string} options.sessionId - Session ID for output organization
   * @param {string} options.outputDir - Base output directory
   * @param {Object} options.generation - Generation settings (steps, guidance, width, height)
   * @param {number} options.timeout - Request timeout in ms (default: 300000 for cold starts)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || process.env.MODAL_ENDPOINT_URL;
    this.tokenId = options.tokenId || process.env.MODAL_TOKEN_ID;
    this.tokenSecret = options.tokenSecret || process.env.MODAL_TOKEN_SECRET;
    this.model = options.model || 'flux-dev';
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';

    // Extended timeout for Modal cold starts (containers can take 60-120s to spin up)
    this.timeout = options.timeout ?? 300000; // 5 minutes default

    // Default generation settings
    const configDefaults = options.generation || {};
    this.generation = {
      width: configDefaults.width ?? 1024,
      height: configDefaults.height ?? 1024,
      steps: configDefaults.steps ?? 25,
      guidance: configDefaults.guidance ?? 3.5,
      loras: configDefaults.loras ?? options.loras ?? undefined // Multiple LoRA support
    };

    // Validate required configuration
    if (!this.apiUrl) {
      throw new Error('Modal endpoint URL is required (set MODAL_ENDPOINT_URL environment variable or pass apiUrl option)');
    }

    if (!this.tokenId || !this.tokenSecret) {
      throw new Error('Modal authentication required (set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables or pass tokenId and tokenSecret options)');
    }

    // Set modelType for negative prompt generation and other features
    // Only set to 'modal' for SDXL models (supports negative prompts)
    // Flux models don't support negative prompts
    const modelLower = this.model.toLowerCase();
    if (modelLower.includes('sdxl') || modelLower.includes('sd3')) {
      this.modelType = 'modal'; // SDXL/SD3 on Modal - supports negative prompts
    } else if (modelLower.includes('flux')) {
      this.modelType = 'flux'; // Flux on Modal - no negative prompt support
    } else {
      this.modelType = 'modal'; // Default to modal for unknown models
    }
  }

  /**
   * Build request payload from prompt and options, merging with instance defaults
   * @param {string} prompt - Text prompt
   * @param {Object} options - Per-request options
   * @returns {Object} Request payload for Modal API
   * @private
   */
  _buildRequestPayload(prompt, options = {}) {
    const payload = {
      prompt,
      model: options.model ?? this.model,
      width: options.width ?? this.generation.width,
      height: options.height ?? this.generation.height,
      steps: options.steps ?? this.generation.steps,
      guidance: options.guidance ?? this.generation.guidance
    };

    if (options.seed !== undefined) payload.seed = options.seed;
    // Accept both camelCase (from beam search) and snake_case (from direct calls)
    const negPrompt = options.negative_prompt ?? options.negativePrompt;
    if (negPrompt !== undefined && negPrompt !== null) {
      payload.negative_prompt = negPrompt;
      console.log(`[Modal Provider] Including negative_prompt in payload: "${String(negPrompt).substring(0, 80)}..."`);
    } else {
      console.log(`[Modal Provider] No negative_prompt in payload (negative_prompt=${options.negative_prompt}, negativePrompt=${options.negativePrompt})`);
    }

    const loras = options.loras ?? this.generation.loras;
    if (loras && Array.isArray(loras) && loras.length > 0) {
      payload.loras = loras;
    }

    if (options.inputImage) payload.input_image = options.inputImage;
    if (options.denoiseStrength !== undefined) payload.denoise_strength = options.denoiseStrength;
    if (options.sampler) payload.sampler = options.sampler;
    if (options.scheduler) payload.scheduler = options.scheduler;
    if (options.clip_skip !== undefined) payload.clip_skip = options.clip_skip;
    if (options.fix_faces !== undefined) payload.fix_faces = options.fix_faces;
    if (options.restoration_strength !== undefined) payload.restoration_strength = options.restoration_strength;
    if (options.face_upscale !== undefined) payload.face_upscale = options.face_upscale;
    if (options.return_intermediate_images !== undefined) payload.return_intermediate_images = options.return_intermediate_images;
    if (options.flow_shift !== undefined) payload.flow_shift = options.flow_shift;

    // Include diagnostic tags for Modal logging
    if (options.iteration !== undefined) payload.iteration = options.iteration;
    if (options.candidateId !== undefined) payload.candidateId = options.candidateId;

    return payload;
  }

  /**
   * Decode image from Modal API response and save to session directory
   * @param {Object} result - Single result from Modal API (with image/format fields)
   * @param {string} prompt - Original prompt (for metadata)
   * @param {Object} options - Options with sessionId, iteration, candidateId
   * @param {string} [logPrefix=''] - Prefix for log messages
   * @returns {Promise<Object>} Standard provider result format
   * @private
   */
  async _processImageResult(result, prompt, options = {}, logPrefix = '') {
    // Decode image buffer
    let imageBuffer;
    if (result.format === 'base64' || result.image) {
      const base64Data = result.image || result.data;
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (result.format === 'url' || result.image_url) {
      const imageUrl = result.image_url || result.url;
      imageBuffer = await this._downloadImage(imageUrl);
    } else {
      throw new Error('Unexpected response format from Modal service');
    }

    // Decode base image if available (for debugging face fixing)
    let baseImageBuffer = null;
    if (result.base_image) {
      try {
        baseImageBuffer = Buffer.from(result.base_image, 'base64');
      } catch (e) {
        console.warn(`[Modal Provider]${logPrefix} Could not decode base_image: ${e.message}`);
      }
    }

    // Save to session directory
    const sessionId = options.sessionId || this.sessionId;
    let finalPath = null;
    let baseImagePath = null;

    if (sessionId && options.iteration !== undefined && options.candidateId !== undefined) {
      try {
        finalPath = await this._saveToSessionDir(imageBuffer, options.iteration, options.candidateId, sessionId);
        console.log(`[Modal Provider]${logPrefix} Saved image to: ${finalPath}`);

        // Save base image if available
        if (baseImageBuffer) {
          try {
            baseImagePath = await this._saveToSessionDir(baseImageBuffer, options.iteration, options.candidateId, sessionId, 'base');
            console.log(`[Modal Provider]${logPrefix} Saved base image to: ${baseImagePath}`);
          } catch (e) {
            console.warn(`[Modal Provider]${logPrefix} Could not save base image: ${e.message}`);
          }
        }
      } catch (saveError) {
        console.warn(`[Modal Provider]${logPrefix} Could not save to session dir: ${saveError.message}`);
        throw saveError;
      }
    } else if (sessionId) {
      finalPath = await this._saveWithTimestamp(imageBuffer, sessionId);
      console.log(`[Modal Provider]${logPrefix} Saved image to: ${finalPath}`);

      if (baseImageBuffer) {
        try {
          baseImagePath = await this._saveWithTimestamp(baseImageBuffer, sessionId, 'base');
          console.log(`[Modal Provider]${logPrefix} Saved base image to: ${baseImagePath}`);
        } catch (e) {
          console.warn(`[Modal Provider]${logPrefix} Could not save base image: ${e.message}`);
        }
      }
    }

    const responseNegPrompt = result.metadata?.negative_prompt;
    if (responseNegPrompt) {
      console.log(`[Modal Provider]${logPrefix} Response includes negative_prompt: "${String(responseNegPrompt).substring(0, 80)}..."`);
    } else {
      console.log(`[Modal Provider]${logPrefix} Response has no negative_prompt in metadata`);
    }

    const resultObj = {
      url: undefined,
      localPath: finalPath,
      revisedPrompt: undefined,
      metadata: {
        model: this.model,
        prompt,
        negative_prompt: responseNegPrompt,
        width: options.width ?? this.generation.width,
        height: options.height ?? this.generation.height,
        steps: options.steps ?? this.generation.steps,
        guidance: options.guidance ?? this.generation.guidance,
        seed: result.metadata?.seed,
        inference_time: result.metadata?.inference_time,
        loras: result.metadata?.loras,
        face_fixing: result.metadata?.face_fixing,
        modal: { endpoint: this.apiUrl }
      }
    };

    // Include base image path if available
    if (baseImagePath) {
      resultObj.baseImagePath = baseImagePath;
    }

    return resultObj;
  }

  /**
   * Build an image tag (i0c0 format) from iteration and candidate ID
   * @param {Object} options - Options object with iteration and candidateId
   * @returns {string|null} Tag in format 'i<iteration>c<candidateId>' or null if info not available
   * @private
   */
  _getImageTag(options = {}) {
    if (options.iteration !== undefined && options.candidateId !== undefined) {
      return `i${options.iteration}c${options.candidateId}`;
    }
    return null;
  }

  /**
   * Format an axios error into a helpful error message
   * @param {Error} error - Axios error
   * @param {string} context - Error context (e.g., 'generate image', 'batch generate images')
   * @param {string} url - The URL that was called
   * @returns {Error} Formatted error
   * @private
   */
  _formatError(error, context, url) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new Error(`Failed to ${context}: Request timed out. Modal cold start may take 60-120 seconds. Try again or check if the Modal service is deployed.`);
    } else if (error.response?.status === 401) {
      return new Error(`Failed to ${context}: Modal authentication failed. Check your MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.`);
    } else if (error.response?.status === 429) {
      return new Error(`Failed to ${context}: Modal rate limit exceeded. Wait and try again.`);
    } else if (error.response?.status === 404) {
      return new Error(`Failed to ${context}: Modal endpoint not found (404). Check your MODAL_ENDPOINT_URL or model: ${this.model}`);
    } else if (error.response?.status >= 500) {
      return new Error(`Failed to ${context}: Modal server error (${error.response.status}). The service may be overloaded or misconfigured.`);
    } else if (error.request) {
      return new Error(`Failed to ${context}: Cannot reach Modal service at ${url}. Is the service deployed?`);
    } else {
      return new Error(`Failed to ${context}: ${error.message}`);
    }
  }

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - Text description of the image
   * @param {Object} options - Generation options
   * @param {number} options.width - Image width (default: 1024)
   * @param {number} options.height - Image height (default: 1024)
   * @param {number} options.steps - Inference steps
   * @param {number} options.guidance - Guidance scale
   * @param {number} options.seed - Random seed for reproducibility
   * @param {number} options.iteration - Iteration number for file naming
   * @param {number} options.candidateId - Candidate ID for file naming
   * @param {string} options.sessionId - Session ID override
   * @returns {Promise<Object>} Generation result with localPath and metadata
   */
  async generateImage(prompt, options = {}) {
    if (!prompt || prompt.trim() === '') {
      throw new Error('Prompt is required for image generation');
    }

    const imageTag = this._getImageTag(options);
    const logPrefix = imageTag ? ` [${imageTag}]` : '';

    try {
      const payload = this._buildRequestPayload(prompt, options);

      console.log(`[Modal Provider]${logPrefix} Generating image with model=${payload.model}: "${prompt.substring(0, 50)}..."`);
      if (payload.fix_faces) {
        console.log(`[Modal Provider]${logPrefix} Face fixing enabled: restoration_strength=${payload.restoration_strength}, upscale=${payload.face_upscale}`);
      }

      const response = await axios.post(this.apiUrl, payload, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Modal-Key': this.tokenId,
          'Modal-Secret': this.tokenSecret
        }
      });

      const result = response.data;

      console.log(`[Modal Provider]${logPrefix} Response metadata:`, JSON.stringify(result.metadata || {}, null, 2));
      if (result.metadata?.face_fixing) {
        console.log(`[Modal Provider]${logPrefix} Face fixing metadata received:`, result.metadata.face_fixing);
      } else if (payload.fix_faces) {
        console.log(`[Modal Provider]${logPrefix} WARNING: Face fixing was requested but no metadata received from Modal service`);
      }

      return await this._processImageResult(result, prompt, options, logPrefix);
    } catch (error) {
      console.error(`[Modal Provider]${logPrefix} Error generating image:`, error.message);
      throw this._formatError(error, 'generate image', this.apiUrl);
    }
  }

  /**
   * Download image from URL
   * @param {string} url - Image URL
   * @returns {Promise<Buffer>} Image data as buffer
   * @private
   */
  async _downloadImage(url) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      return Buffer.from(response.data, 'binary');
    } catch (error) {
      throw new Error(`Failed to download image from URL: ${error.message}`);
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
  async _saveToSessionDir(imageBuffer, iteration, candidateId, sessionId, suffix = '') {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);
    const suffixPart = suffix ? `-${suffix}` : '';
    const filename = `iter${iteration}-cand${candidateId}${suffixPart}.png`;
    const finalPath = path.join(sessionDir, filename);

    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    // Write image file
    await fs.writeFile(finalPath, imageBuffer);

    return finalPath;
  }

  /**
   * Save image buffer with timestamp (when no iteration info provided)
   * @param {Buffer} imageBuffer - PNG image data
   * @param {string} sessionId - Session ID for path construction
   * @returns {Promise<string>} Final path in session directory
   * @private
   */
  async _saveWithTimestamp(imageBuffer, sessionId, suffix = '') {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);
    const timestamp = Date.now();
    const suffixPart = suffix ? `-${suffix}` : '';
    const filename = `modal-${timestamp}${suffixPart}.png`;
    const finalPath = path.join(sessionDir, filename);

    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(finalPath, imageBuffer);

    return finalPath;
  }

  /**
   * Derive the health endpoint URL from the generate endpoint URL
   * Modal exposes each method as a separate URL, not as paths
   * Generate: https://user--app-class-generate-HASH.modal.run
   * Health:   https://user--app-class-health.modal.run
   * @returns {string} Health endpoint URL
   */
  getHealthUrl() {
    // Replace generate-HASH with health (no hash on health endpoint)
    return this.apiUrl.replace(/generate-[a-f0-9]+/, 'health');
  }

  /**
   * Derive the batch endpoint URL from the generate endpoint URL
   * Batch: https://user--app-class-batch-generate.modal.run
   * @returns {string} Batch endpoint URL
   */
  getBatchUrl() {
    return this.apiUrl.replace(/generate-[a-f0-9]+/, 'batch-generate');
  }

  /**
   * Generate multiple images in a single HTTP request (batch mode)
   * Sends all requests to Modal's batch endpoint, which processes them
   * sequentially on the same GPU, saving N-1 HTTP round trips.
   *
   * @param {Array<Object>} requests - Array of {prompt, options} objects
   * @param {string} requests[].prompt - Text prompt for image generation
   * @param {Object} requests[].options - Per-image generation options
   * @returns {Promise<Array<Object>>} Array of results in same order as requests
   */
  async generateImages(requests) {
    if (!requests || requests.length === 0) {
      throw new Error('generateImages requires at least one request');
    }

    for (const req of requests) {
      if (!req.prompt || req.prompt.trim() === '') {
        throw new Error('Prompt is required for image generation');
      }
    }

    try {
      const batchPayload = {
        requests: requests.map(req => this._buildRequestPayload(req.prompt, req.options || {}))
      };

      // Send batch to the same generate endpoint (it detects batch via 'requests' key)
      const batchTimeout = this.timeout + (requests.length * 60000);

      console.log(`[Modal Provider] Batch generating ${requests.length} images via ${this.apiUrl}`);
      requests.forEach((req, i) => {
        const tag = this._getImageTag(req.options);
        const tagStr = tag ? ` [${tag}]` : ` [batch item ${i}]`;
        console.log(`[Modal Provider]${tagStr} Prompt: "${req.prompt.substring(0, 60)}..."`);
      });

      const response = await axios.post(this.apiUrl, batchPayload, {
        timeout: batchTimeout,
        headers: {
          'Content-Type': 'application/json',
          'Modal-Key': this.tokenId,
          'Modal-Secret': this.tokenSecret
        }
      });

      const batchResult = response.data;
      const results = batchResult.results || [];

      if (results.length !== requests.length) {
        console.warn(`[Modal Provider] Batch returned ${results.length} results for ${requests.length} requests`);
      }

      const processedResults = await Promise.all(
        results.map(async (result, i) => {
          const req = requests[i];
          const imageTag = this._getImageTag(req.options);
          const logPrefix = imageTag ? ` [${imageTag}]` : ` [batch item ${i}]`;
          return await this._processImageResult(result, req.prompt, req.options || {}, logPrefix);
        })
      );

      console.log(`[Modal Provider] Batch complete: ${processedResults.length} images`);
      return processedResults;

    } catch (error) {
      console.error('[Modal Provider] Error in batch generation:', error.message);
      throw this._formatError(error, 'batch generate images', this.apiUrl);
    }
  }

  /**
   * Check health status of the Modal service
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const healthUrl = this.getHealthUrl();
      const response = await axios.get(healthUrl, {
        timeout: 120000, // 2 minutes - allow time for cold start containers
        headers: {
          'Modal-Key': this.tokenId,
          'Modal-Secret': this.tokenSecret
        }
      });

      const data = response.data;

      return {
        available: true,
        status: data.status || 'healthy',
        model: data.model || this.model,
        gpu: data.gpu,
        container_ready: data.container_ready
      };
    } catch (error) {
      return {
        available: false,
        status: 'error',
        model: this.model,
        error: error.response?.data?.error || error.message
      };
    }
  }
}

module.exports = ModalImageProvider;
