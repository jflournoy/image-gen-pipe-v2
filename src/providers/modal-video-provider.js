/**
 * @file Modal Video Provider
 * Implements video generation using Modal cloud GPUs
 * Uses WAN2.2-I2V model for image-to-video generation
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');

/**
 * Modal Video Provider
 * Uses Modal's cloud GPU infrastructure for video generation
 * Takes an image and generates a video from it
 */
class ModalVideoProvider {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - Modal web endpoint URL
   * @param {string} options.tokenId - Modal Token ID (or MODAL_TOKEN_ID env var)
   * @param {string} options.tokenSecret - Modal Token Secret (or MODAL_TOKEN_SECRET env var)
   * @param {string} options.model - Model identifier (wan2.2-i2v-high, etc.)
   * @param {string} options.sessionId - Session ID for output organization
   * @param {string} options.outputDir - Base output directory
   * @param {Object} options.generation - Generation settings (steps, guidance, fps, num_frames)
   * @param {number} options.timeout - Request timeout in ms (default: 600000 for longer video generation)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || process.env.MODAL_VIDEO_ENDPOINT_URL || process.env.MODAL_ENDPOINT_URL;
    this.healthUrl = options.healthUrl || process.env.MODAL_VIDEO_HEALTH_URL;
    this.tokenId = options.tokenId || process.env.MODAL_TOKEN_ID;
    this.tokenSecret = options.tokenSecret || process.env.MODAL_TOKEN_SECRET;
    this.model = options.model || 'wan2.2-i2v-high';
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';

    // Extended timeout for Modal video generation (can take 60-120s)
    this.timeout = options.timeout !== undefined ? options.timeout : 600000; // 10 minutes default

    // Default generation settings
    const configDefaults = options.generation || {};
    this.generation = {
      steps: configDefaults.steps !== undefined ? configDefaults.steps : 30,
      guidance: configDefaults.guidance !== undefined ? configDefaults.guidance : 4.0,
      guidance_2: configDefaults.guidance_2 !== undefined ? configDefaults.guidance_2 : undefined,
      fps: configDefaults.fps !== undefined ? configDefaults.fps : 24,
      num_frames: configDefaults.num_frames !== undefined ? configDefaults.num_frames : 97,
    };

    // Validate required configuration
    if (!this.apiUrl) {
      throw new Error('Modal endpoint URL is required (set MODAL_ENDPOINT_URL environment variable or pass apiUrl option)');
    }

    if (!this.tokenId || !this.tokenSecret) {
      throw new Error('Modal authentication required (set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables or pass tokenId and tokenSecret options)');
    }

    this.modelType = 'video'; // For feature detection
  }

  /**
   * Build request payload from image and prompt, merging with instance defaults
   * @param {Buffer} imageBuffer - Image data as buffer
   * @param {string} prompt - Motion/animation prompt
   * @param {Object} options - Per-request options
   * @returns {Object} Request payload for Modal API
   * @private
   */
  _buildRequestPayload(imageBuffer, prompt, options = {}) {
    // Determine mode: t2v (text-to-video) or i2v (image-to-video)
    const mode = options.mode || (imageBuffer ? 'i2v' : 't2v');

    const payload = {
      mode,
      prompt: prompt || '',
      model: options.model !== undefined ? options.model : this.model,
      steps: options.steps !== undefined ? options.steps : this.generation.steps,
      guidance: options.guidance !== undefined ? options.guidance : this.generation.guidance,
      fps: options.fps !== undefined ? options.fps : this.generation.fps,
      num_frames: options.num_frames !== undefined ? options.num_frames : this.generation.num_frames,
    };

    // Include image for I2V mode
    if (mode === 'i2v' && imageBuffer) {
      payload.image = imageBuffer.toString('base64');
    }

    // Include guidance_2 for MoE low-noise expert (only if set)
    const guidance2 = options.guidance_2 !== undefined ? options.guidance_2 : this.generation.guidance_2;
    if (guidance2 !== undefined) {
      payload.guidance_2 = guidance2;
    }

    // T2V-specific: height/width (no image to infer size from)
    if (options.height !== undefined) payload.height = options.height;
    if (options.width !== undefined) payload.width = options.width;

    if (options.seed !== undefined) payload.seed = options.seed;

    return payload;
  }

  /**
   * Save video buffer to session directory
   * @param {Buffer} videoBuffer - MP4 video data
   * @param {string} sessionId - Session ID for path construction
   * @param {Object} options - Options with iteration, candidateId
   * @returns {Promise<string>} Final path in session directory
   * @private
   */
  async _saveVideoFile(videoBuffer, sessionId, options = {}) {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);

    // Build filename
    let filename;
    if (options.iteration !== undefined && options.candidateId !== undefined) {
      filename = `iter${options.iteration}-cand${options.candidateId}.mp4`;
    } else {
      const timestamp = Date.now();
      filename = `video-${timestamp}.mp4`;
    }

    const finalPath = path.join(sessionDir, filename);

    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    // Write video file
    await fs.writeFile(finalPath, videoBuffer);

    return finalPath;
  }

  /**
   * Format an axios error into a helpful error message
   * @param {Error} error - Axios error
   * @param {string} context - Error context (e.g., 'generate video')
   * @param {string} url - The URL that was called
   * @returns {Error} Formatted error
   * @private
   */
  _formatError(error, context, url) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new Error(`Failed to ${context}: Request timed out. Video generation can take 60-120 seconds. Try again or check if the Modal service is deployed.`);
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
   * Generate a video from an image and prompt
   * @param {Buffer} imageBuffer - Image data as buffer (PNG/JPG)
   * @param {string} prompt - Motion/animation description
   * @param {Object} options - Generation options
   * @param {number} options.steps - Inference steps
   * @param {number} options.guidance - Guidance scale
   * @param {number} options.fps - Frames per second (default: 24)
   * @param {number} options.num_frames - Number of frames to generate (default: 97)
   * @param {number} options.seed - Random seed for reproducibility
   * @param {number} options.iteration - Iteration number for file naming
   * @param {number} options.candidateId - Candidate ID for file naming
   * @param {string} options.sessionId - Session ID override
   * @returns {Promise<Object>} Generation result with videoPath and metadata
   */
  async generateVideo(imageBuffer, prompt, options = {}) {
    const mode = options.mode || (imageBuffer ? 'i2v' : 't2v');

    // Image is required for I2V mode, optional for T2V
    if (mode === 'i2v' && (!imageBuffer || imageBuffer.length === 0)) {
      throw new Error('Image buffer is required for video generation');
    }

    if (!prompt || prompt.trim() === '') {
      throw new Error('Prompt is required for video generation');
    }

    const imageTag = this._getImageTag(options);
    const logPrefix = imageTag ? ` [${imageTag}]` : '';

    try {
      const payload = this._buildRequestPayload(imageBuffer, prompt, options);

      console.log(`[Modal Video Provider]${logPrefix} Generating video with model=${payload.model}, prompt="${prompt.substring(0, 50)}..."`);
      console.log(`[Modal Video Provider]${logPrefix} Settings: steps=${payload.steps}, guidance=${payload.guidance}, fps=${payload.fps}, frames=${payload.num_frames}`);

      const response = await axios.post(
        this.apiUrl,
        payload,
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'Modal-Key': this.tokenId,
            'Modal-Secret': this.tokenSecret,
          },
          responseType: 'arraybuffer', // Get binary response for video data
        }
      );

      // Parse response
      let result;
      try {
        // Try to parse as JSON (error response)
        result = JSON.parse(Buffer.from(response.data).toString('utf-8'));
      } catch {
        // It's binary video data
        result = {
          video: Buffer.from(response.data).toString('base64'),
          format: 'mp4',
        };
      }

      // If we got an error in JSON format
      if (result.error) {
        throw new Error(`Modal API error: ${result.error}`);
      }

      // Decode base64 video if needed
      let videoBuffer;
      if (result.video) {
        videoBuffer = Buffer.from(result.video, 'base64');
      } else if (response.data instanceof Buffer) {
        videoBuffer = response.data;
      } else {
        throw new Error('Unexpected response format from Modal service');
      }

      // Save to session directory
      const sessionId = options.sessionId || this.sessionId;
      let finalPath = null;

      if (sessionId) {
        try {
          finalPath = await this._saveVideoFile(videoBuffer, sessionId, options);
          console.log(`[Modal Video Provider]${logPrefix} Saved video to: ${finalPath}`);
        } catch (saveError) {
          console.warn(`[Modal Video Provider]${logPrefix} Could not save to session dir: ${saveError.message}`);
          throw saveError;
        }
      }

      const resultObj = {
        videoPath: finalPath,
        format: result.format || 'mp4',
        metadata: {
          model: this.model,
          prompt,
          steps: options.steps !== undefined ? options.steps : this.generation.steps,
          guidance: options.guidance !== undefined ? options.guidance : this.generation.guidance,
          fps: result.fps || (options.fps !== undefined ? options.fps : this.generation.fps),
          num_frames: result.num_frames,
          duration_seconds: result.duration_seconds,
          seed: result.metadata?.seed,
          inference_time: result.metadata?.inference_time,
          modal: { endpoint: this.apiUrl },
        }
      };

      return resultObj;

    } catch (error) {
      console.error(`[Modal Video Provider]${logPrefix} Error generating video:`, error.message);
      throw this._formatError(error, 'generate video', this.apiUrl);
    }
  }

  /**
   * Check health status of the Modal service
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const healthUrl = this.healthUrl;
      const response = await axios.get(healthUrl, {
        timeout: 120000, // 2 minutes - allow time for cold start containers
        headers: {
          'Modal-Key': this.tokenId,
          'Modal-Secret': this.tokenSecret,
        },
      });

      const data = response.data;

      return {
        available: true,
        status: data.status || 'healthy',
        model: data.model || this.model,
        gpu: data.gpu,
        container_ready: data.container_ready,
      };
    } catch (error) {
      return {
        available: false,
        status: 'error',
        model: this.model,
        error: error.response?.data?.error || error.message,
      };
    }
  }
}

module.exports = ModalVideoProvider;
