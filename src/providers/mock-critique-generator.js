/**
 * Mock Critique Generator
 * Simple mock for testing critique generation without API calls
 */

class MockCritiqueGenerator {
  constructor(options = {}) {
    this.model = options.model || 'mock';
    this.apiKey = undefined; // Mock doesn't use API key
  }

  /**
   * Generate mock critique for testing
   * @param {Object} feedback - Vision provider evaluation or ranking results
   * @param {Object} prompts - The prompts used
   * @param {string} userPrompt - Original user request
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Mock structured critique
   */
  async generateCritique(feedback, prompts, userPrompt, options) {
    // Validate required parameters (same as real implementation)
    if (!feedback) {
      throw new Error('feedback is required');
    }

    if (!prompts) {
      throw new Error('prompts are required');
    }

    if (!options || !options.dimension) {
      throw new Error('dimension is required in options');
    }

    const { dimension } = options;

    // Validate dimension
    if (dimension !== 'what' && dimension !== 'how') {
      throw new Error('dimension must be either "what" or "how"');
    }

    // Extract scores from feedback (supports both evaluation and ranking feedback)
    const alignmentScore = feedback.alignmentScore || (feedback.rank ? (4 - feedback.rank) * 25 : 50);
    const aestheticScore = feedback.aestheticScore;

    // Determine relevant score based on dimension
    let relevantScore = alignmentScore;
    let scoreType = 'alignment';

    if (dimension === 'how' && aestheticScore !== undefined) {
      relevantScore = aestheticScore * 10; // Convert to 0-100 scale
      scoreType = 'aesthetic';
    }

    // Generate mock critique based on score
    let critique, recommendation, reason;

    if (relevantScore >= 80) {
      critique = `Mock: The ${dimension} prompt is performing well.`;
      recommendation = `Mock: Add subtle refinements to ${dimension.toUpperCase()}.`;
      reason = 'Mock: Minor refinements improve results.';
    } else if (relevantScore >= 60) {
      critique = `Mock: The ${dimension} prompt needs moderate improvement.`;
      recommendation = `Mock: Revise ${dimension.toUpperCase()} for better results.`;
      reason = `Mock: Addressing weaknesses improves ${dimension === 'how' ? 'visual quality' : 'content alignment'}.`;
    } else {
      critique = `Mock: The ${dimension} prompt requires significant revision.`;
      recommendation = `Mock: Completely rework ${dimension.toUpperCase()}.`;
      reason = `Mock: Major revisions needed for ${dimension === 'how' ? 'visual quality' : 'content alignment'}.`;
    }

    return {
      critique,
      recommendation,
      reason,
      dimension,
      metadata: {
        alignmentScore,
        aestheticScore,
        relevantScore: dimension === 'how' && aestheticScore !== undefined ? aestheticScore : alignmentScore,
        scoreType,
        method: 'mock',
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = MockCritiqueGenerator;
