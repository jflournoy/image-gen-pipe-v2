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
    // Validate prompt
    if (!prompt || prompt.trim() === '') {
      throw new Error('Prompt is required for image generation');
    }

    try {
      // Build request payload - merge per-request options with instance defaults
      const payload = {
        prompt: prompt,
        model: options.model ?? this.model,
        width: options.width ?? this.generation.width,
        height: options.height ?? this.generation.height,
        steps: options.steps ?? this.generation.steps,
        guidance: options.guidance ?? this.generation.guidance
      };

      // Add optional seed if provided
      if (options.seed !== undefined) {
        payload.seed = options.seed;
      }

      // Add LoRAs if provided (per-request overrides defaults)
      // Format: [{ path: 'lora.safetensors', scale: 0.8 }, ...]
      const loras = options.loras ?? this.generation.loras;
      if (loras && Array.isArray(loras) && loras.length > 0) {
        payload.loras = loras;
      }

      // Add face fixing parameters if provided
      if (options.fix_faces !== undefined) {
        payload.fix_faces = options.fix_faces;
      }
      if (options.face_fidelity !== undefined) {
        payload.face_fidelity = options.face_fidelity;
      }
      if (options.face_upscale !== undefined) {
        payload.face_upscale = options.face_upscale;
      }

      console.log(`[Modal Provider] Generating image with model=${payload.model}: "${prompt.substring(0, 50)}..."`);

      // Make HTTP request to Modal endpoint with authentication headers
      // Modal endpoints are at the root of their URL, not at a /generate path
      const response = await axios.post(
        this.apiUrl,
        payload,
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'Modal-Key': this.tokenId,
            'Modal-Secret': this.tokenSecret
          }
        }
      );

      const result = response.data;

      // Handle response - Modal can return base64 or URL
      let imageBuffer;
      if (result.format === 'base64' || result.image) {
        // Base64 encoded image
        const base64Data = result.image || result.data;
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else if (result.format === 'url' || result.image_url) {
        // URL to download
        const imageUrl = result.image_url || result.url;
        imageBuffer = await this._downloadImage(imageUrl);
      } else {
        throw new Error('Unexpected response format from Modal service');
      }

      // Save to session directory if session info provided
      const sessionId = options.sessionId || this.sessionId;
      let finalPath = null;

      if (sessionId && options.iteration !== undefined && options.candidateId !== undefined) {
        try {
          finalPath = await this._saveToSessionDir(imageBuffer, options.iteration, options.candidateId, sessionId);
          console.log(`[Modal Provider] Saved image to: ${finalPath}`);
        } catch (saveError) {
          console.warn(`[Modal Provider] Could not save to session dir: ${saveError.message}`);
          throw saveError;
        }
      } else if (sessionId) {
        // Save with timestamp if no iteration/candidate info
        finalPath = await this._saveWithTimestamp(imageBuffer, sessionId);
        console.log(`[Modal Provider] Saved image to: ${finalPath}`);
      }

      // Return result in standard provider format
      return {
        url: undefined, // Don't expose internal URLs
        localPath: finalPath,
        revisedPrompt: undefined, // Modal doesn't revise prompts
        metadata: {
          model: this.model,
          prompt: prompt,
          width: payload.width,
          height: payload.height,
          steps: payload.steps,
          guidance: payload.guidance,
          seed: result.metadata?.seed || payload.seed,
          inference_time: result.metadata?.inference_time,
          loras: result.metadata?.loras || payload.loras,
          face_fixing: result.metadata?.face_fixing,
          modal: {
            endpoint: this.apiUrl
          }
        }
      };
    } catch (error) {
      // Handle specific error cases with helpful messages
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new Error(
          'Failed to generate image: Request timed out. Modal cold start may take 60-120 seconds. Try again or check if the Modal service is deployed.'
        );
      } else if (error.response?.status === 401) {
        throw new Error(
          'Failed to generate image: Modal authentication failed. Check your MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.'
        );
      } else if (error.response?.status === 429) {
        throw new Error(
          'Failed to generate image: Modal rate limit exceeded. Wait and try again.'
        );
      } else if (error.response?.status === 404) {
        throw new Error(
          `Failed to generate image: Modal endpoint not found (404). Check your MODAL_ENDPOINT_URL or model: ${this.model}`
        );
      } else if (error.response?.status >= 500) {
        throw new Error(
          `Failed to generate image: Modal server error (${error.response.status}). The service may be overloaded or misconfigured.`
        );
      } else if (error.request) {
        throw new Error(
          `Failed to generate image: Cannot reach Modal service at ${this.apiUrl}. Is the service deployed?`
        );
      } else {
        throw new Error(`Failed to generate image: ${error.message}`);
      }
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
   * Save image buffer with timestamp (when no iteration info provided)
   * @param {Buffer} imageBuffer - PNG image data
   * @param {string} sessionId - Session ID for path construction
   * @returns {Promise<string>} Final path in session directory
   * @private
   */
  async _saveWithTimestamp(imageBuffer, sessionId) {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);
    const timestamp = Date.now();
    const filename = `modal-${timestamp}.png`;
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
