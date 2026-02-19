/**
 * @file Flux Image Provider
 * Implements image generation using local Flux/SDXL models via Python service
 * Supports LoRA adapters, negative prompts, and full parameter control
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');
const providerConfig = require('../config/provider-config.js');
const ServiceConnection = require('../utils/service-connection');
const serviceManager = require('../utils/service-manager');

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
   * @param {Object} options.generation - Generation settings (steps, guidance, width, height, loraScale, scheduler)
   * @param {Function} options.serviceRestarter - Service restart callback
   * @param {Object} options.serviceConnection - Pre-built ServiceConnection (for testing)
   * @param {Object} options.serviceManager - ServiceManager override (for testing)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8001';
    this.model = options.model || 'flux-dev'; // Default to FLUX.1-dev (quality + LoRA, auto fp8)
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';

    // ServiceConnection for smart retry/restart on connection errors
    this._serviceConnection = options.serviceConnection || new ServiceConnection({
      serviceName: 'flux',
      serviceManager: options.serviceManager || serviceManager,
      serviceRestarter: options.serviceRestarter || null,
      onUrlChanged: (newUrl) => { this.apiUrl = newUrl; },
    });

    // Merge generation settings: options > config defaults
    const configDefaults = providerConfig.flux?.generation || {};
    this.generation = {
      steps: options.generation?.steps ?? configDefaults.steps ?? 25,
      guidance: options.generation?.guidance ?? configDefaults.guidance ?? 3.5,
      width: options.generation?.width ?? configDefaults.width ?? 1024,
      height: options.generation?.height ?? configDefaults.height ?? 1024,
      loraScale: options.generation?.loraScale ?? configDefaults.loraScale ?? null,
      scheduler: options.generation?.scheduler ?? configDefaults.scheduler ?? null
    };
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
   * @param {string} options.scheduler - Scheduler: euler, dpmsolver, ddim, pndm (for fine-tunes)
   * @returns {Promise<Object>} Generation result with localPath and metadata
   */
  async generateImage(prompt, options = {}) {
    return this._serviceConnection.withRetry(
      async () => {
        try {
          // Check if model needs downloading (first-time use)
          const modelStatus = await this.checkModelStatus();
          const isFirstTimeDownload = modelStatus.status === 'not_downloaded';

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
            loras: options.loras || [],
            lora_scale: options.loraScale ?? this.generation.loraScale,
            scheduler: options.scheduler ?? this.generation.scheduler  // euler, dpmsolver, ddim, pndm
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

          // Timeouts include model load time (Flux reload after GPU swap takes ~7-10 min)
          // Normal generation (model may need reloading): 15 minutes
          // First-time download (~12GB): 45 minutes
          const timeout = isFirstTimeDownload ? 2700000 : 900000;

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
          // Let connection errors pass through to ServiceConnection for retry/restart
          if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
            throw error;
          }
          if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            // Timeout: service is alive but slow — don't retry/restart
            const modelStatus = await this.checkModelStatus().catch(() => ({ status: 'unknown' }));
            const downloadMsg = modelStatus.status === 'not_downloaded'
              ? ' The Flux model (~12GB) may still be downloading. Check service logs for progress.'
              : '';
            throw new Error(
              `Failed to generate image: Request timed out.${downloadMsg} Try again or check if the Flux service is responding.`
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
        operationName: 'Flux image generation',
        attemptRestart: true
      }
    );
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
   * Set service restarter callback (dependency injection)
   * @param {Function} restarter - Async function() => { success, error? }
   */
  setServiceRestarter(restarter) {
    this._serviceConnection.setServiceRestarter(restarter);
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
