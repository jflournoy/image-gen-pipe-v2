/**
 * TDD GREEN Phase: Mock Scoring Provider
 *
 * Combines alignment and aesthetic scores to rank candidates.
 * Formula: totalScore = alpha * alignment + (1 - alpha) * (aesthetic * 10)
 * Where:
 * - alignment is 0-100
 * - aesthetic is 0-10 (scaled to 0-100 for calculation)
 * - alpha is weight for alignment vs aesthetic (0.0-1.0)
 */

class MockScoringProvider {
  constructor() {
    this.name = 'mock-scoring-provider';
  }

  /**
   * Score a candidate image by combining alignment and aesthetic scores
   * @param {Object} candidate - The candidate to score
   * @param {string} candidate.prompt - Original prompt
   * @param {string} candidate.imageUrl - URL of generated image
   * @param {number} candidate.alignmentScore - Text-image alignment (0-100)
   * @param {Object} options - Scoring options
   * @param {number} options.alpha - Weight for alignment vs aesthetic (0.0-1.0), default 0.7
   * @returns {Promise<Object>} Scoring results with total and breakdown
   */
  async scoreCandidate(candidate, options = {}) {
    // Validate candidate
    if (!candidate) {
      throw new Error('candidate is required and cannot be null or undefined');
    }

    if (!candidate.prompt || !candidate.imageUrl || candidate.alignmentScore === undefined) {
      throw new Error('Candidate validation failed: prompt, imageUrl, and alignmentScore are all required');
    }

    // Validate and default options
    const { alpha = 0.7 } = options;

    // Validate alpha
    if (typeof alpha !== 'number' || alpha < 0 || alpha > 1) {
      throw new Error('alpha out of range: must be between 0.0 and 1.0');
    }

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 5));

    // Get alignment score (already 0-100)
    const alignmentScore = candidate.alignmentScore;

    // Calculate aesthetic score (0-10 scale)
    const aestheticScore = this._calculateAestheticScore(candidate.imageUrl, candidate.prompt);

    // Calculate combined score
    // Formula: alpha * alignment + (1 - alpha) * (aesthetic * 10)
    // Aesthetic is scaled from 0-10 to 0-100 for combination
    const totalScore = alpha * alignmentScore + (1 - alpha) * (aestheticScore * 10);

    return {
      totalScore: Math.round(totalScore * 100) / 100, // Round to 2 decimal places
      breakdown: {
        alignment: alignmentScore,
        aesthetic: aestheticScore
      },
      metadata: {
        model: 'mock-scorer',
        alpha,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Calculate aesthetic score (0-10) based on image quality indicators
   * @private
   */
  _calculateAestheticScore(imageUrl, prompt) {
    // Deterministic scoring for testing
    const urlLower = imageUrl.toLowerCase();
    const promptLower = prompt.toLowerCase();

    // Base score
    let score = 6.5;

    // Quality indicators in URL
    if (urlLower.includes('hq') || urlLower.includes('high') || urlLower.includes('quality')) {
      score += 1.5;
    }

    if (urlLower.includes('perfect') || urlLower.includes('excellent')) {
      score += 1.0;
    }

    if (urlLower.includes('good')) {
      score += 0.5;
    }

    if (urlLower.includes('bad') || urlLower.includes('poor') || urlLower.includes('low')) {
      score -= 2.0;
    }

    // Prompt complexity (more complex prompts suggest higher effort)
    const wordCount = promptLower.split(/\s+/).length;
    if (wordCount > 10) {
      score += 0.5;
    }

    // Ensure score is in 0-10 range
    score = Math.max(0, Math.min(10, score));

    // Round to 1 decimal place
    return Math.round(score * 10) / 10;
  }
}

module.exports = MockScoringProvider;
