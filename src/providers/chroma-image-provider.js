/**
 * @file Chroma Image Provider
 * Implements image generation using Chroma1-HD models via Python service
 * Supports negative prompts and full parameter control
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');
const providerConfig = require('../config/provider-config.js');
const ServiceConnection = require('../utils/service-connection');
const serviceManager = require('../utils/service-manager');

/**
 * Chroma Image Provider
 * Uses Chroma1-HD diffusion models for image generation
 */
class ChromaImageProvider {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - Base URL of the Chroma service
   * @param {string} options.model - Model identifier/path
   * @param {string} options.sessionId - Session ID for output organization
   * @param {string} options.outputDir - Base output directory
   * @param {Object} options.generation - Generation settings (steps, guidance, width, height)
   * @param {Function} options.serviceRestarter - Service restart callback
   * @param {Object} options.serviceConnection - Pre-built ServiceConnection (for testing)
   * @param {Object} options.serviceManager - ServiceManager override (for testing)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8002';
    this.model = options.model || 'chroma-1-hd';
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';

    // ServiceConnection for smart retry/restart on connection errors
    this._serviceConnection = options.serviceConnection || new ServiceConnection({
      serviceName: 'chroma',
      serviceManager: options.serviceManager || serviceManager,
      serviceRestarter: options.serviceRestarter || null,
      onUrlChanged: (newUrl) => { this.apiUrl = newUrl; },
    });

    // Merge generation settings: options > config defaults
    const configDefaults = providerConfig.chroma?.generation || {};
    this.generation = {
      steps: options.generation?.steps ?? configDefaults.steps ?? 20,
      guidance: options.generation?.guidance ?? configDefaults.guidance ?? 7.5,
      width: options.generation?.width ?? configDefaults.width ?? 768,
      height: options.generation?.height ?? configDefaults.height ?? 768,
    };

    // Chroma1-HD supports negative prompts
    this.modelType = 'chroma';
  }

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - Text description of the image
   * @param {Object} options - Generation options
   * @param {number} options.height - Image height (default: 768)
   * @param {number} options.width - Image width (default: 768)
   * @param {number} options.steps - Inference steps (default: 20)
   * @param {number} options.guidance - Guidance scale (default: 7.5)
   * @param {number} options.seed - Random seed for reproducibility
   * @param {string} options.negativePrompt - Negative prompt (things to avoid)
   * @returns {Promise<Object>} Generation result with localPath and metadata
   */
  async generateImage(prompt, options = {}) {
    return this._serviceConnection.withRetry(
      async () => {
        try {
          // Build request payload - merge per-request options with instance defaults
          const payload = {
            model: this.model,
            prompt: prompt,
            height: options.height ?? this.generation.height,
            width: options.width ?? this.generation.width,
            steps: options.steps ?? this.generation.steps,
            guidance: options.guidance ?? this.generation.guidance,
            seed: options.seed !== undefined ? options.seed : null, // null = random
            negativePrompt: options.negativePrompt || '',
          };

          // Add face fixing parameters if provided
          if (options.fix_faces !== undefined) {
            payload.fix_faces = options.fix_faces;
          }
          if (options.restoration_strength !== undefined) {
            payload.restoration_strength = options.restoration_strength;
          }
          if (options.face_upscale !== undefined) {
            payload.face_upscale = options.face_upscale;
          }
          if (options.return_intermediate_images !== undefined) {
            payload.return_intermediate_images = options.return_intermediate_images;
          }

          // Timeout for generation (Chroma is faster than Flux)
          const timeout = 600000; // 10 minutes

          // Make HTTP request to Chroma service
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
          const sessionId = options.sessionId || this.sessionId;
          let finalPath = result.localPath;
          let baseImagePath = null;
          if (sessionId && options.iteration !== undefined && options.candidateId !== undefined) {
            try {
              finalPath = await this._saveToSessionDir(result.localPath, options.iteration, options.candidateId, sessionId);
              console.log(`[Chroma Provider] Saved image to: ${finalPath}`);
            } catch (copyError) {
              console.warn(`[Chroma Provider] Could not copy to session dir, using temp path: ${copyError.message}`);
            }

            // Save base image if returned (pre-face-fixing)
            if (result.base_image) {
              try {
                const baseImageBuffer = Buffer.from(result.base_image, 'base64');
                baseImagePath = await this._saveBufferToSessionDir(baseImageBuffer, options.iteration, options.candidateId, sessionId, 'base');
                console.log(`[Chroma Provider] Saved base image to: ${baseImagePath}`);
              } catch (e) {
                console.warn(`[Chroma Provider] Could not save base image: ${e.message}`);
              }
            }
          }

          // Return result in provider interface format
          const resultObj = {
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
              ...result.metadata
            }
          };

          if (baseImagePath) {
            resultObj.baseImagePath = baseImagePath;
          }

          return resultObj;
        } catch (error) {
          // Let connection errors pass through to ServiceConnection for retry/restart
          if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
            throw error;
          }
          if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            throw new Error(
              'Failed to generate image: Request timed out. The Chroma service may be slow or overloaded. Try again or check service logs.'
            );
          } else if (error.response) {
            throw new Error(
              `Failed to generate image: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`
            );
          } else if (error.request) {
            // Network error — let ServiceConnection handle
            throw error;
          } else {
            throw new Error(`Failed to generate image: ${error.message}`);
          }
        }
      },
      {
        operationName: 'Chroma image generation',
        attemptRestart: true
      }
    );
  }

  /**
   * Copy temp image to proper session directory
   * @param {string} tempPath - Temp file path from Chroma service
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

    // Copy the file
    await fs.copyFile(tempPath, finalPath);

    return finalPath;
  }

  /**
   * Save image buffer to session directory
   * @param {Buffer} imageBuffer - PNG image data
   * @param {number} iteration - Iteration number
   * @param {number} candidateId - Candidate ID
   * @param {string} sessionId - Session ID for path construction
   * @param {string} suffix - Filename suffix
   * @returns {Promise<string>} Final path in session directory
   * @private
   */
  async _saveBufferToSessionDir(imageBuffer, iteration, candidateId, sessionId, suffix = '') {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);
    const suffixPart = suffix ? `-${suffix}` : '';
    const filename = `iter${iteration}-cand${candidateId}${suffixPart}.png`;
    const finalPath = path.join(sessionDir, filename);

    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(finalPath, imageBuffer);

    return finalPath;
  }

  /**
   * Set service restarter callback (dependency injection)
   * @param {Function} restarter - Async function() => { success, error? }
   */
  setServiceRestarter(restarter) {
    this._serviceConnection.setServiceRestarter(restarter);
  }

  /**
   * Check health status of the Chroma service
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

module.exports = ChromaImageProvider;
