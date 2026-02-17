/**
 * @file Local Vision Provider
 * Implements vision analysis using local CLIP + aesthetic scoring models
 * Communicates with Python FastAPI service for inference
 */

const axios = require('axios');
const ServiceConnection = require('../utils/service-connection');
const serviceManager = require('../utils/service-manager');

/**
 * Local Vision Provider
 * Uses CLIP for semantic alignment and aesthetic model for quality scoring
 */
class LocalVisionProvider {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - Base URL of the local vision service
   * @param {string} options.clipModel - CLIP model identifier
   * @param {string} options.aestheticModel - Aesthetic scoring model identifier
   * @param {Function} options.serviceRestarter - Service restart callback
   * @param {Object} options.serviceConnection - Pre-built ServiceConnection (for testing)
   * @param {Object} options.serviceManager - ServiceManager override (for testing)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8002';
    this.clipModel = options.clipModel || 'openai/clip-vit-base-patch32';
    this.aestheticModel = options.aestheticModel || 'aesthetic_predictor_v2_5';

    // ServiceConnection for smart retry/restart on connection errors
    this._serviceConnection = options.serviceConnection || new ServiceConnection({
      serviceName: 'vision',
      serviceManager: options.serviceManager || serviceManager,
      serviceRestarter: options.serviceRestarter || null,
      onUrlChanged: (newUrl) => { this.apiUrl = newUrl; },
    });
  }

  /**
   * Set service restarter callback (dependency injection)
   * @param {Function} restarter - Async function() => { success, error? }
   */
  setServiceRestarter(restarter) {
    this._serviceConnection.setServiceRestarter(restarter);
  }

  /**
   * Analyze an image for semantic alignment and aesthetic quality
   * @param {string} imageUrl - URL or local file path to the image
   * @param {string} prompt - Text prompt for CLIP alignment scoring
   * @param {Object} options - Additional options for analysis
   * @returns {Promise<Object>} Analysis results with scores and feedback
   */
  async analyzeImage(imageUrl, prompt, options = {}) {
    return this._serviceConnection.withRetry(
      async () => {
        try {
          // Determine if this is a local path or URL
          const isLocalPath = imageUrl.startsWith('/') || imageUrl.startsWith('.') || !imageUrl.includes('://');

          // Build request payload
          const payload = {
            prompt,
            options
          };

          if (isLocalPath) {
            payload.imagePath = imageUrl;
          } else {
            payload.imageUrl = imageUrl;
          }

          // Make HTTP request to local vision service
          const response = await axios.post(
            `${this.apiUrl}/analyze`,
            payload,
            {
              timeout: 30000, // 30 second timeout
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );

          // Validate response
          const result = response.data;

          // Validate score ranges
          if (result.alignmentScore < 0 || result.alignmentScore > 100) {
            throw new Error(`Invalid alignment score: ${result.alignmentScore}. Must be between 0-100.`);
          }

          if (result.aestheticScore < 0 || result.aestheticScore > 10) {
            throw new Error(`Invalid aesthetic score: ${result.aestheticScore}. Must be between 0-10.`);
          }

          return {
            alignmentScore: result.alignmentScore,
            aestheticScore: result.aestheticScore,
            analysis: result.analysis || '',
            strengths: result.strengths || [],
            weaknesses: result.weaknesses || []
          };
        } catch (error) {
          // Let connection errors pass through to ServiceConnection for retry/restart
          if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
            throw error;
          }
          if (error.response) {
            throw new Error(
              `Failed to analyze image: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`
            );
          } else if (error.request) {
            // Network error — let ServiceConnection handle
            throw error;
          } else {
            throw new Error(`Failed to analyze image: ${error.message}`);
          }
        }
      },
      {
        operationName: 'Vision analysis',
        attemptRestart: true
      }
    );
  }

  /**
   * Check health status of the local vision service
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
      if (error.response && error.response.status === 503) {
        throw new Error('Service unavailable - health check failed');
      }
      throw new Error(`Service unavailable: ${error.message}`);
    }
  }
}

module.exports = LocalVisionProvider;
