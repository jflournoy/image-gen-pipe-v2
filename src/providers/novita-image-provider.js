/**
 * @file Novita AI Image Provider
 * Implements image generation using the Novita AI API
 * Handles async task submission, polling, and image download
 *
 * API docs: https://novita.ai/docs/api-reference/model-apis-text-to-image
 * Model names are simple strings, e.g.:
 *   - "flux2-dev"     (recommended, enhanced realism)
 *   - "flux-schnell"  (fast)
 *   - "flux-dev"      (original flux dev)
 * Full model list: https://novita.ai/models
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');

const NOVITA_BASE_URL = 'https://api.novita.ai/v3/async';
const NOVITA_TASK_URL = 'https://api.novita.ai/v3/async/task-result';

// Novita flux2 models use a dedicated endpoint with a simplified schema:
// - uses `size` ("WIDTHxHEIGHT") instead of width/height
// - no steps, sampler_name, guidance_scale, image_num
const NOVITA_FLUX2_MODELS = /^flux2-/i;

class NovitaImageProvider {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - Novita AI API key (required)
   * @param {string} options.model - Model name e.g. "flux2-dev"
   * @param {string} [options.sessionId] - Session ID for output organization
   * @param {string} [options.outputDir] - Base output directory
   * @param {Object} [options.generation] - Default generation settings
   * @param {number} [options.generation.width]
   * @param {number} [options.generation.height]
   * @param {number} [options.generation.steps]
   * @param {number} [options.generation.guidance]
   * @param {string} [options.generation.sampler] - Sampler name (default: "euler")
   * @param {number} [options.maxPollTime] - Max polling time in ms (default: 300000)
   * @param {number} [options.pollInterval] - Poll interval in ms (default: 2000)
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.NOVITA_API_KEY;
    this.model = options.model || process.env.NOVITA_MODEL || 'flux2-dev';
    this.sessionId = options.sessionId;
    this.outputDir = options.outputDir || 'output';

    const gen = options.generation || {};
    this.generation = {
      width: gen.width ?? 1024,
      height: gen.height ?? 1024,
      steps: gen.steps ?? 20,
      guidance: gen.guidance ?? 7.5,
      sampler: gen.sampler ?? 'euler'
    };

    this.maxPollTime = options.maxPollTime ?? 300000;
    this.pollInterval = options.pollInterval ?? 2000;

    if (!this.apiKey) {
      throw new Error('Novita AI API key is required (set NOVITA_API_KEY or pass apiKey option)');
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
   * @param {string} [options.negativePrompt]
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
    const width = options.width ?? this.generation.width;
    const height = options.height ?? this.generation.height;
    const steps = options.steps ?? this.generation.steps;
    const guidance = options.guidance ?? this.generation.guidance;

    // flux2-* models use a simplified schema (no steps/sampler/guidance)
    const isFlux2 = NOVITA_FLUX2_MODELS.test(model);

    let requestBody;
    if (isFlux2) {
      requestBody = {
        request: {
          model_name: model,
          prompt,
          size: `${width}*${height}`,
          seed: options.seed ?? -1
        }
      };
    } else {
      requestBody = {
        request: {
          model_name: model,
          prompt,
          width,
          height,
          image_num: 1,
          steps,
          guidance_scale: guidance,
          sampler_name: this.generation.sampler,
          seed: options.seed ?? -1
        }
      };
      if (options.negativePrompt) {
        requestBody.request.negative_prompt = options.negativePrompt;
      }
    }

    console.log(`[Novita] model=${model}${isFlux2 ? ' (flux2)' : ''}, size=${width}x${height}${isFlux2 ? '' : `, steps=${steps}`}`);
    console.log(`[Novita] Submitting: "${prompt.substring(0, 50)}..."`);

    const taskId = await this._submitTask(requestBody);
    console.log(`[Novita] Task created: id=${taskId}`);

    const result = await this._pollForCompletion(taskId);
    console.log(`[Novita] Task succeeded: id=${taskId}, ${result.imgs.length} image(s)`);

    const imageUrl = result.imgs[0];
    if (!imageUrl) {
      throw new Error('Novita returned no image URL');
    }

    const imageBuffer = await this._downloadImage(imageUrl, taskId);
    console.log(`[Novita] Downloaded ${imageBuffer.length} bytes`);

    const sessionId = options.sessionId || this.sessionId;
    let finalPath = null;
    if (sessionId && options.iteration !== undefined && options.candidateId !== undefined) {
      finalPath = await this._saveToSessionDir(imageBuffer, options.iteration, options.candidateId, sessionId);
      console.log(`[Novita] Saved to: ${finalPath}`);
    }

    return {
      url: undefined,
      localPath: finalPath,
      revisedPrompt: undefined,
      metadata: {
        model,
        prompt,
        width,
        height,
        ...(!isFlux2 && { steps, guidance }),
        ...(options.seed !== undefined && options.seed !== -1 && { seed: options.seed }),
        novita: { task_id: taskId }
      }
    };
  }

  /**
   * Submit txt2img task to Novita
   * @param {Object} body
   * @returns {Promise<string>} task_id
   * @private
   */
  async _submitTask(body) {
    try {
      const response = await axios.post(
        `${NOVITA_BASE_URL}/txt2img`,
        body,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const taskId = response.data?.task_id;
      if (!taskId) {
        throw new Error(`Unexpected response: ${JSON.stringify(response.data)}`);
      }
      return taskId;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Novita API: Invalid API key');
      } else if (error.response?.status === 402) {
        throw new Error('Novita API: Insufficient credits');
      } else if (error.response?.status === 429) {
        throw new Error('Novita API: Rate limit exceeded');
      } else if (error.response?.data?.message) {
        throw new Error(`Novita API: ${error.response.data.message}`);
      }
      throw new Error(`Novita API request failed: ${error.message}`);
    }
  }

  /**
   * Poll Novita task result endpoint until SUCCEED or FAILED
   * @param {string} taskId
   * @returns {Promise<Object>} Result with imgs array
   * @private
   */
  async _pollForCompletion(taskId) {
    const start = Date.now();
    let pollCount = 0;

    while (true) {
      if (Date.now() - start > this.maxPollTime) {
        throw new Error(`Novita timeout: exceeded ${this.maxPollTime}ms for task ${taskId}`);
      }

      await this._sleep(this.pollInterval);

      let data;
      try {
        const response = await axios.get(NOVITA_TASK_URL, {
          params: { task_id: taskId },
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          timeout: 10000
        });
        data = response.data;
      } catch (error) {
        throw new Error(`Novita polling failed: ${error.message}`);
      }

      pollCount++;
      console.log(`[Novita] Poll ${pollCount} task=${taskId}: status=${data.status}`);

      if (data.status === 'SUCCEED') {
        if (!data.imgs || data.imgs.length === 0) {
          throw new Error('Novita task succeeded but returned no images');
        }
        return data;
      }
      if (data.status === 'FAILED') {
        const reason = data.reason || data.message || 'Unknown failure';
        throw new Error(`Novita task failed: ${reason}`);
      }
      // QUEUED | PROCESSING → keep polling
    }
  }

  async _downloadImage(url, taskId) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      return Buffer.from(response.data, 'binary');
    } catch (error) {
      throw new Error(`Failed to download Novita image (task=${taskId}): ${error.message}`);
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
    // Novita doesn't have a dedicated health endpoint; try a minimal task list call
    try {
      await axios.get('https://api.novita.ai/v3/model', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        params: { filter: { visibility: 'public', type: 'txt2img' } },
        timeout: 8000
      });
      return { available: true, status: 'healthy', model: this.model };
    } catch (error) {
      if (error.response?.status === 401) {
        return { available: false, status: 'error', message: 'Invalid API key' };
      }
      return { available: false, status: 'error', message: error.message };
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = NovitaImageProvider;
