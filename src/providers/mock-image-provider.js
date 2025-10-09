/**
 * TDD GREEN Phase: Mock Image Generation Provider
 *
 * Minimal implementation to make tests pass.
 * This will be used for testing the orchestrator without hitting real APIs.
 */

class MockImageProvider {
  constructor() {
    this.name = 'mock-image-provider';
  }

  /**
   * Generate an image from a prompt (mock implementation)
   * @param {string} prompt - The text prompt for image generation
   * @param {Object} options - Generation options
   * @param {string} options.size - Image size (e.g., '1024x1024')
   * @param {string} options.quality - Quality setting ('standard' or 'hd')
   * @param {string} options.style - Style setting ('vivid' or 'natural')
   * @returns {Promise<Object>} Generated image data
   */
  async generateImage(prompt, options = {}) {
    // Validate prompt
    if (!prompt || prompt.trim() === '') {
      throw new Error('Prompt is required and cannot be empty');
    }

    // Default options
    const {
      size = '1024x1024',
      quality = 'standard',
      style = 'vivid'
    } = options;

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Return mock result matching the expected interface
    return {
      url: `https://mock-image-cdn.example.com/${Date.now()}.png`,
      revisedPrompt: `Enhanced: ${prompt}`,
      metadata: {
        model: 'mock-dall-e-3',
        size,
        quality,
        style,
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = MockImageProvider;
