/**
 * @file Replicate Image Provider
 * Implements image generation using the Replicate API
 * Handles async prediction polling and image download
 *
 * API docs: https://replicate.com/docs/reference/http
 * Model format: "owner/name" or "owner/name:version"
 * Popular Flux models:
 *   - black-forest-labs/flux-schnell  (~$0.003/image, fastest)
 *   - black-forest-labs/flux-dev      (~$0.030/image, balanced)
 *   - black-forest-labs/flux-1.1-pro  (~$0.055/image, best quality)
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');

const REPLICATE_BASE_URL = 'https://api.replicate.com/v1';

class ReplicateImageProvider {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - Replicate API token (required)
   * @param {string} options.model - Model identifier e.g. "black-forest-labs/flux-schnell"
   * @param {string} [options.sessionId] - Session ID for output organization
   * @param {string} [options.outputDir] - Base output directory
   * @param {Object} [options.generation] - Default generation settings
   * @param {number} [options.generation.width]
   * @param {number} [options.generation.height]
   * @param {number} [options.generation.steps]
   * @param {number} [options.generation.guidance]
   * @param {number} [options.maxPollTime] - Max polling time in ms (default: 300000)
   * @param {number} [options.pollInterval] - Poll interval in ms (default: 1000)
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.REPLICATE_API_KEY;
    this.model = options.model || process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell';
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';

    const gen = options.generation || {};
    this.generation = {
      width: gen.width ?? 1024,
      height: gen.height ?? 1024,
      steps: gen.steps ?? null,     // null = use model default
      guidance: gen.guidance ?? null
    };

    this.maxPollTime = options.maxPollTime ?? 300000;
    this.pollInterval = options.pollInterval ?? 1000;

    if (!this.apiKey) {
      throw new Error('Replicate API key is required (set REPLICATE_API_KEY or pass apiKey option)');
    }
  }

  /**
   * Generate an image from a text prompt
   * @param {string} prompt
   * @param {Object} options
   * @param {string} [options.model] - Override model for this request
   * @param {number} [options.width]
   * @param {number} [options.height]
   * @param {number} [options.steps]
   * @param {number} [options.guidance]
   * @param {number} [options.seed]
   * @param {number} [options.iteration] - For file naming
   * @param {number} [options.candidateId] - For file naming
   * @param {string} [options.sessionId]
   * @returns {Promise<{url: undefined, localPath: string|null, revisedPrompt: undefined, metadata: Object}>}
   */
  async generateImage(prompt, options = {}) {
    if (!prompt || prompt.trim() === '') {
      throw new Error('Prompt is required for image generation');
    }

    const model = options.model || this.model;

    // Build input - Replicate model inputs vary by model
    // These are standard Flux params; unknown extras are ignored by the API
    const input = {
      prompt,
      width: options.width ?? this.generation.width,
      height: options.height ?? this.generation.height
    };

    if ((options.steps ?? this.generation.steps) !== null) {
      input.num_inference_steps = options.steps ?? this.generation.steps;
    }
    if ((options.guidance ?? this.generation.guidance) !== null) {
      input.guidance_scale = options.guidance ?? this.generation.guidance;
    }
    if (options.seed !== undefined && options.seed !== null) {
      input.seed = options.seed;
    }

    console.log(`[Replicate] model=${model}, size=${input.width}x${input.height}`);
    console.log(`[Replicate] Submitting: "${prompt.substring(0, 50)}..."`);

    const prediction = await this._createPrediction(model, input);
    console.log(`[Replicate] Prediction created: id=${prediction.id}`);

    const result = await this._pollForCompletion(prediction.id, prediction.urls.get);
    console.log(`[Replicate] Prediction succeeded: id=${prediction.id}`);

    // Output is an array of URLs (or a single URL string for some models)
    const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
    if (!imageUrl) {
      throw new Error('Replicate returned no output URL');
    }

    const imageBuffer = await this._downloadImage(imageUrl, prediction.id);
    console.log(`[Replicate] Downloaded ${imageBuffer.length} bytes`);

    const sessionId = options.sessionId || this.sessionId;
    let finalPath = null;
    if (sessionId && options.iteration !== undefined && options.candidateId !== undefined) {
      finalPath = await this._saveToSessionDir(imageBuffer, options.iteration, options.candidateId, sessionId);
      console.log(`[Replicate] Saved to: ${finalPath}`);
    }

    return {
      url: undefined, // Replicate URLs expire
      localPath: finalPath,
      revisedPrompt: undefined,
      metadata: {
        model,
        prompt,
        width: input.width,
        height: input.height,
        ...(input.num_inference_steps && { steps: input.num_inference_steps }),
        ...(input.guidance_scale && { guidance: input.guidance_scale }),
        ...(input.seed !== undefined && { seed: input.seed }),
        replicate: { id: prediction.id }
      }
    };
  }

  /**
   * Submit a prediction to Replicate
   * @param {string} model - "owner/name" or "owner/name:version"
   * @param {Object} input
   * @returns {Promise<Object>} Prediction object with id and urls
   * @private
   */
  async _createPrediction(model, input) {
    // Replicate has two URL patterns:
    // 1. Pinned version:  POST /predictions  body: { version: "sha256hash", input }
    // 2. Latest version:  POST /models/{owner}/{name}/predictions  body: { input }
    const hasVersion = model.includes(':');
    let url;
    let body;

    if (hasVersion) {
      const [, version] = model.split(':');
      url = `${REPLICATE_BASE_URL}/predictions`;
      body = { version, input };
    } else {
      // model is "owner/name" — use the model-specific endpoint (no version pin needed)
      url = `${REPLICATE_BASE_URL}/models/${model}/predictions`;
      body = { input };
    }

    try {
      const response = await axios.post(
        url,
        body,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait=5' // Short synchronous wait before falling back to polling
          },
          timeout: 15000
        }
      );

      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Replicate API: Invalid API token');
      } else if (error.response?.status === 422) {
        const detail = error.response.data?.detail || 'Validation error';
        throw new Error(`Replicate API: ${detail}`);
      } else if (error.response?.status === 429) {
        throw new Error('Replicate API: Rate limit exceeded');
      }
      throw new Error(`Replicate API request failed: ${error.message}`);
    }
  }

  /**
   * Poll until prediction succeeds or fails
   * @param {string} id
   * @param {string} pollUrl
   * @returns {Promise<Object>} Completed prediction
   * @private
   */
  async _pollForCompletion(id, pollUrl) {
    const start = Date.now();
    let pollCount = 0;

    while (true) {
      if (Date.now() - start > this.maxPollTime) {
        throw new Error(`Replicate timeout: exceeded ${this.maxPollTime}ms for prediction ${id}`);
      }

      // First poll is immediate (prediction may already be done if Prefer:wait returned it)
      if (pollCount > 0) {
        await this._sleep(this.pollInterval);
      }

      let data;
      try {
        const response = await axios.get(pollUrl, {
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          timeout: 10000
        });
        data = response.data;
      } catch (error) {
        throw new Error(`Replicate polling failed: ${error.message}`);
      }

      pollCount++;
      console.log(`[Replicate] Poll ${pollCount} id=${id}: status=${data.status}`);

      if (data.status === 'succeeded') {
        return data;
      }
      if (data.status === 'failed' || data.status === 'canceled') {
        const err = data.error || data.status;
        throw new Error(`Replicate prediction ${data.status}: ${err}`);
      }
      // starting | processing → keep polling
    }
  }

  async _downloadImage(url, id) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      return Buffer.from(response.data, 'binary');
    } catch (error) {
      throw new Error(`Failed to download Replicate output (id=${id}): ${error.message}`);
    }
  }

  async _saveToSessionDir(imageBuffer, iteration, candidateId, sessionId) {
    const sessionDir = OutputPathManager.buildSessionPath(this.outputDir, sessionId);
    const filename = `iter${iteration}-cand${candidateId}.png`;
    const finalPath = path.join(sessionDir, filename);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(finalPath, imageBuffer);
    return finalPath;
  }

  async healthCheck() {
    // Validate the API key with a lightweight account request
    try {
      await axios.get(`${REPLICATE_BASE_URL}/account`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        timeout: 8000
      });
      return { available: true, status: 'healthy', model: this.model };
    } catch (error) {
      if (error.response?.status === 401) {
        return { available: false, status: 'error', message: 'Invalid API token' };
      }
      return { available: false, status: 'error', message: error.message };
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ReplicateImageProvider;
