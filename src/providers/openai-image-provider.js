/**
 * TDD GREEN Phase: OpenAI Image Provider
 *
 * Real OpenAI API implementation for image generation.
 * Uses DALL-E 3 to generate images from text prompts.
 * Supports local storage with beam search directory structure.
 */

const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

class OpenAIImageProvider {
  constructor(apiKey, options = {}) {
    // Validate API key
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('API key is required');
    }

    this.name = 'openai-image-provider';
    this.apiKey = apiKey;

    // Configuration options
    this.model = options.model || 'dall-e-3';
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 60000; // Image generation takes longer

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: this.apiKey,
      maxRetries: this.maxRetries,
      timeout: this.timeout
    });

    // DALL-E 3 constraints
    this.validSizes = ['1024x1024', '1024x1792', '1792x1024'];
    this.validQualities = ['standard', 'hd'];
    this.validStyles = ['vivid', 'natural'];

    // Local storage configuration
    this.saveLocally = options.saveLocally !== undefined ? options.saveLocally : true;
    this.outputDir = options.outputDir || path.join(process.cwd(), 'output');
    this.sessionId = options.sessionId || this._generateSessionId();
  }

  /**
   * Generate a session ID based on current time
   * @returns {string} Session ID in format: session-HHMMSS
   * @private
   */
  _generateSessionId() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `session-${hours}${minutes}${seconds}`;
  }

  /**
   * Get the current date in YYYY-MM-DD format
   * @returns {string} Date string
   * @private
   */
  _getCurrentDate() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Build the directory path for a candidate
   * @param {Object} beamSearch - Beam search context
   * @param {number} beamSearch.iteration - Zero-indexed iteration number
   * @param {number} beamSearch.candidateId - Zero-indexed candidate ID
   * @param {string} beamSearch.dimension - Refinement dimension (what/how)
   * @returns {string} Full directory path
   * @private
   */
  _buildCandidatePath(beamSearch) {
    const { iteration, candidateId, dimension } = beamSearch;
    const date = this._getCurrentDate();
    const iterDir = `iter-${String(iteration).padStart(2, '0')}`;
    const candDir = `candidate-${String(candidateId).padStart(2, '0')}-${dimension}`;
    return path.join(this.outputDir, date, this.sessionId, iterDir, candDir);
  }

  /**
   * Download image from URL to local file
   * @param {string} url - Image URL
   * @param {string} filePath - Destination file path
   * @returns {Promise<void>}
   * @private
   */
  async _downloadImage(url, filePath) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            await fs.writeFile(filePath, buffer);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Save candidate files to disk
   * @param {string} candidatePath - Directory path for candidate
   * @param {string} url - Image URL
   * @param {string} prompt - Text prompt
   * @param {Object} score - Scoring data (optional)
   * @returns {Promise<string>} Local path to saved image
   * @private
   */
  async _saveCandidateFiles(candidatePath, url, prompt, score = null) {
    // Create directory
    await fs.mkdir(candidatePath, { recursive: true });

    // Save prompt.txt
    const promptPath = path.join(candidatePath, 'prompt.txt');
    await fs.writeFile(promptPath, prompt, 'utf8');

    // Download and save image.png
    const imagePath = path.join(candidatePath, 'image.png');
    await this._downloadImage(url, imagePath);

    // Save score.json if provided
    if (score) {
      const scorePath = path.join(candidatePath, 'score.json');
      await fs.writeFile(scorePath, JSON.stringify(score, null, 2), 'utf8');
    }

    return imagePath;
  }

  /**
   * Generate an image using OpenAI's DALL-E model
   * @param {string} prompt - The text prompt for image generation
   * @param {Object} options - Generation options
   * @param {string} options.size - Image size (1024x1024, 1024x1792, or 1792x1024)
   * @param {string} options.quality - Quality setting ('standard' or 'hd')
   * @param {string} options.style - Style setting ('vivid' or 'natural')
   * @param {number} options.iteration - Zero-indexed iteration number (for beam search)
   * @param {number} options.candidateId - Zero-indexed candidate ID (for beam search)
   * @param {string} options.dimension - Refinement dimension: 'what' or 'how'
   * @returns {Promise<Object>} Generated image data
   */
  async generateImage(prompt, options = {}) {
    // Validate prompt
    if (prompt === null || prompt === undefined) {
      throw new Error('Prompt is required and cannot be null or undefined');
    }

    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('Prompt is required and cannot be empty');
    }

    // Validate and default options
    const {
      size = '1024x1024',
      quality = 'standard',
      style = 'vivid',
      iteration,
      candidateId,
      dimension
    } = options;

    // Validate size
    if (!this.validSizes.includes(size)) {
      throw new Error(`Invalid size: ${size}. Must be one of: ${this.validSizes.join(', ')}`);
    }

    // Validate quality
    if (!this.validQualities.includes(quality)) {
      throw new Error(`Invalid quality: ${quality}. Must be one of: ${this.validQualities.join(', ')}`);
    }

    // Validate style
    if (!this.validStyles.includes(style)) {
      throw new Error(`Invalid style: ${style}. Must be one of: ${this.validStyles.join(', ')}`);
    }

    try {
      // Call OpenAI API
      const response = await this.client.images.generate({
        model: this.model,
        prompt: prompt,
        n: 1,
        size: size,
        quality: quality,
        style: style
      });

      const imageData = response.data[0];
      const url = imageData.url;
      const revisedPrompt = imageData.revised_prompt || prompt;

      // Build result object
      const result = {
        url,
        revisedPrompt,
        metadata: {
          model: this.model,
          size,
          quality,
          style,
          timestamp: new Date().toISOString()
        }
      };

      // Save locally if enabled and beam search context provided
      if (this.saveLocally && iteration !== undefined && candidateId !== undefined && dimension) {
        try {
          const beamSearch = { iteration, candidateId, dimension };
          const candidatePath = this._buildCandidatePath(beamSearch);
          const localPath = await this._saveCandidateFiles(candidatePath, url, revisedPrompt);

          // Add local path and beam search context to result
          result.localPath = localPath;
          result.metadata.beamSearch = beamSearch;
        } catch (saveError) {
          // Log error but don't fail the generation
          console.error('Failed to save image locally:', saveError.message);
        }
      }

      return result;
    } catch (error) {
      // Wrap OpenAI errors with more context
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
}

module.exports = OpenAIImageProvider;
