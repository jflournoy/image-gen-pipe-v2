/**
 * TDD GREEN Phase: OpenAI Image Provider
 *
 * Real OpenAI API implementation for image generation.
 * Uses DALL-E 3 to generate images from text prompts.
 */

const OpenAI = require('openai');

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
  }

  /**
   * Generate an image using OpenAI's DALL-E model
   * @param {string} prompt - The text prompt for image generation
   * @param {Object} options - Generation options
   * @param {string} options.size - Image size (1024x1024, 1024x1792, or 1792x1024)
   * @param {string} options.quality - Quality setting ('standard' or 'hd')
   * @param {string} options.style - Style setting ('vivid' or 'natural')
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
      style = 'vivid'
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

      return {
        url: imageData.url,
        revisedPrompt: imageData.revised_prompt || prompt,
        metadata: {
          model: this.model,
          size,
          quality,
          style,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      // Wrap OpenAI errors with more context
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
}

module.exports = OpenAIImageProvider;
