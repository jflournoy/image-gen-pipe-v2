/**
 * TDD GREEN Phase: Mock Vision Provider
 *
 * Minimal implementation for image analysis and alignment scoring.
 * Simulates vision model behavior for testing the orchestrator.
 */

/* global URL */

class MockVisionProvider {
  constructor() {
    this.name = 'mock-vision-provider';
  }

  /**
   * Analyze an image and calculate alignment with prompt
   * @param {string} imageUrl - URL of the image to analyze
   * @param {string} prompt - Original prompt used to generate the image
   * @param {Object} options - Analysis options
   * @param {string[]} options.focusAreas - Specific areas to focus on (e.g., ['composition', 'lighting'])
   * @returns {Promise<Object>} Analysis results with alignment score
   */
  async analyzeImage(imageUrl, prompt, options = {}) {
    // Validate imageUrl
    if (imageUrl === null || imageUrl === undefined) {
      throw new Error('imageUrl is required and cannot be null or undefined');
    }

    if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
      throw new Error('imageUrl is required and cannot be empty');
    }

    // Validate URL format
    if (!this._isValidUrl(imageUrl)) {
      throw new Error('Invalid URL format for imageUrl');
    }

    // Validate prompt
    if (prompt === null || prompt === undefined) {
      throw new Error('prompt is required and cannot be null or undefined');
    }

    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('prompt is required and cannot be empty');
    }

    const { focusAreas = [] } = options;

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Generate deterministic alignment score based on URL and prompt
    const alignmentScore = this._calculateAlignmentScore(imageUrl, prompt);

    // Generate analysis text
    const analysis = this._generateAnalysis(imageUrl, prompt, focusAreas);

    // Optional caption (shorter description)
    const caption = this._generateCaption(imageUrl, prompt);

    // Calculate mock token usage
    const tokensUsed = this._calculateTokenUsage(analysis, imageUrl);

    return {
      analysis,
      alignmentScore,
      caption,
      metadata: {
        model: 'mock-gpt-4-vision',
        tokensUsed,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Validate URL format
   * @private
   */
  _isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Calculate alignment score (0-100) based on semantic matching
   * @private
   */
  _calculateAlignmentScore(imageUrl, prompt) {
    // Deterministic score for testing
    // Extract key terms from URL and prompt for "semantic" matching
    const urlLower = imageUrl.toLowerCase();
    const promptLower = prompt.toLowerCase();

    // Extract potential subject from prompt
    const promptWords = promptLower.split(/\s+/).filter(w => w.length > 3);

    // Calculate how many prompt words appear in URL
    let matches = 0;
    for (const word of promptWords) {
      if (urlLower.includes(word)) {
        matches++;
      }
    }

    // Base score + bonus for matches
    const baseScore = 65;
    const matchBonus = Math.min(matches * 10, 30);
    const score = Math.min(baseScore + matchBonus, 100);

    return Math.round(score);
  }

  /**
   * Generate descriptive analysis of the image
   * @private
   */
  _generateAnalysis(imageUrl, prompt, focusAreas) {
    let analysis = `This image appears to depict ${prompt}. `;

    if (focusAreas.length > 0) {
      analysis += `Focusing on ${focusAreas.join(', ')}: `;

      for (const area of focusAreas) {
        if (area.toLowerCase() === 'composition') {
          analysis += 'The composition follows standard visual principles. ';
        } else if (area.toLowerCase() === 'lighting') {
          analysis += 'The lighting creates appropriate mood and depth. ';
        } else if (area.toLowerCase() === 'color') {
          analysis += 'The color palette complements the subject matter. ';
        } else {
          analysis += `The ${area} contributes to the overall effect. `;
        }
      }
    } else {
      analysis += 'The image demonstrates good technical quality with clear subject matter and appropriate styling. ';
    }

    analysis += 'The visual elements align well with the intended prompt.';

    return analysis;
  }

  /**
   * Generate a concise caption
   * @private
   */
  _generateCaption(imageUrl, prompt) {
    // Simple caption based on prompt
    return `An image showing ${prompt}`;
  }

  /**
   * Calculate token usage (text + image tokens)
   * @private
   */
  _calculateTokenUsage(analysis, _imageUrl) {
    // Text tokens (~4 chars per token)
    const textTokens = Math.floor(analysis.length / 4);

    // Image tokens (vision models use fixed tokens for images, roughly 85-170 for standard images)
    // imageUrl could be used to estimate size, but mock provider uses fixed value
    const imageTokens = 100;

    return textTokens + imageTokens + 50; // + overhead
  }
}

module.exports = MockVisionProvider;
