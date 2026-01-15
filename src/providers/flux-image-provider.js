/**
 * @file Flux Image Provider
 * Implements image generation using local Flux/SDXL models via Python service
 * Supports LoRA adapters, negative prompts, and full parameter control
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');

/**
 * Flux Image Provider
 * Uses local diffusion models (Flux/SDXL) for image generation
 */
class FluxImageProvider {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - Base URL of the Flux service
   * @param {string} options.model - Model identifier/path
   * @param {string} options.sessionId - Session ID for output organization
   * @param {string} options.outputDir - Base output directory
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8001';
    this.model = options.model || 'flux-dev'; // Default to FLUX.1-dev (quality + LoRA, auto fp8)
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';
  }

  /**
   * Check if model is downloaded/cached
   * @returns {Promise<Object>} Download status
   */
  async checkModelStatus() {
    try {
      const response = await axios.get(`${this.apiUrl}/download/status`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      return { status: 'unknown', message: error.message };
    }
  }

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - Text description of the image
   * @param {Object} options - Generation options
   * @param {number} options.height - Image height (default: 1024)
   * @param {number} options.width - Image width (default: 1024)
   * @param {number} options.steps - Inference steps (default: 30)
   * @param {number} options.guidance - Guidance scale (default: 7.5)
   * @param {number} options.seed - Random seed for reproducibility
   * @param {string} options.negativePrompt - Negative prompt (things to avoid)
   * @param {Array} options.loras - LoRA configurations [{path, trigger, weight}]
   * @returns {Promise<Object>} Generation result with localPath and metadata
   */
  async generateImage(prompt, options = {}) {
    try {
      // Check if model needs downloading (first-time use)
      const modelStatus = await this.checkModelStatus();
      const isFirstTimeDownload = modelStatus.status === 'not_downloaded';

      // Build request payload
      const payload = {
        model: this.model,
        prompt: prompt,
        height: options.height || 1024,
        width: options.width || 1024,
        steps: options.steps || 30,
        guidance: options.guidance || 7.5,
        seed: options.seed !== undefined ? options.seed : null, // null = random
        negativePrompt: options.negativePrompt || '',
        loras: options.loras || []
      };

      // Use extended timeout if model needs downloading (~12GB can take 30+ min)
      // Normal generation: 5 minutes (sequential offload is slow), First-time download: 45 minutes
      const timeout = isFirstTimeDownload ? 2700000 : 300000;

      if (isFirstTimeDownload) {
        console.log('[Flux Provider] Model not cached - using extended timeout for first-time download');
      }

      // Make HTTP request to Flux service
      const response = await axios.post(
        `${this.apiUrl}/generate`,
        payload,
        {
          timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // Validate response
      const result = response.data;

      if (!result.localPath) {
        throw new Error('Response missing localPath - image generation may have failed');
      }

      // Copy temp file to proper location if we have session info
      // Check both constructor sessionId and options.sessionId for flexibility
      const sessionId = options.sessionId || this.sessionId;
      let finalPath = result.localPath;
      if (sessionId && options.iteration !== undefined && options.candidateId !== undefined) {
        try {
          finalPath = await this._saveToSessionDir(result.localPath, options.iteration, options.candidateId, sessionId);
          console.log(`[Flux Provider] Saved image to: ${finalPath}`);
        } catch (copyError) {
          console.warn(`[Flux Provider] Could not copy to session dir, using temp path: ${copyError.message}`);
        }
      }

      // Return result in provider interface format
      return {
        url: undefined, // Local provider doesn't use URLs
        localPath: finalPath,
        revisedPrompt: result.metadata?.revisedPrompt || undefined,
        metadata: {
          model: this.model,
          prompt: prompt,
          height: payload.height,
          width: payload.width,
          steps: payload.steps,
          guidance: payload.guidance,
          seed: result.metadata?.seed || payload.seed,
          negativePrompt: payload.negativePrompt,
          loras: payload.loras,
          ...result.metadata
        }
      };
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        // Check if this might be due to model download
        const modelStatus = await this.checkModelStatus().catch(() => ({ status: 'unknown' }));
        const downloadMsg = modelStatus.status === 'not_downloaded'
          ? ' The Flux model (~12GB) may still be downloading. Check service logs for progress.'
          : '';
        throw new Error(
          `Failed to generate image: Request timed out.${downloadMsg} Try again or check if the Flux service is responding.`
        );
      } else if (error.response) {
        // HTTP error from the service
        throw new Error(
          `Failed to generate image: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        // Network error - service not reachable
        throw new Error(
          `Failed to generate image: Cannot reach Flux service at ${this.apiUrl}. Is the service running?`
        );
      } else {
        // Other error (including validation errors)
        throw new Error(`Failed to generate image: ${error.message}`);
      }
    }
  }

  /**
   * Copy temp image to proper session directory
   * @param {string} tempPath - Temp file path from Flux service
   * @param {number} iteration - Iteration number
   * @param {number} candidateId - Candidate ID
   * @param {string} sessionId - Session ID for path construction
   * @returns {Promise<string>} Final path in session directory
   * @private
   */
  async _saveToSessionDir(tempPath, iteration, candidateId, sessionId) {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);
    const filename = `iter${iteration}-cand${candidateId}.png`;
    const finalPath = path.join(sessionDir, filename);

    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    // Copy the file (don't move in case Flux service needs it)
    await fs.copyFile(tempPath, finalPath);

    return finalPath;
  }

  /**
   * Check health status of the Flux service
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.apiUrl}/health`, {
        timeout: 5000
      });

      if (response.status !== 200) {
        throw new Error('Service unavailable');
      }

      return response.data;
    } catch (error) {
      throw new Error(`Service unavailable: ${error.message}`);
    }
  }
}

module.exports = FluxImageProvider;
