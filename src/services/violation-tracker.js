/**
 * Violation Tracker
 *
 * Tracks content moderation violations (failures and successes) and provides
 * similarity-based search to find relevant past examples for guiding future refinements.
 *
 * Uses simple cosine similarity on term frequency vectors to find similar prompts
 * without requiring external embedding APIs.
 */

class ViolationTracker {
  constructor(options = {}) {
    this.maxHistory = options.maxHistory !== undefined ? options.maxHistory : 100;
    this.similarityThreshold = options.similarityThreshold !== undefined ? options.similarityThreshold : 0.3;

    this.failures = [];
    this.successes = [];
  }

  /**
   * Track a failed violation (max retries exceeded)
   * @param {Object} violation - Violation details
   * @param {string} violation.original - Original problematic prompt
   * @param {number} violation.attempts - Number of attempts made
   * @param {string[]} violation.refinements - Refinement attempts that failed
   */
  trackFailure(violation) {
    this.failures.push({
      ...violation,
      timestamp: new Date().toISOString()
    });

    // Limit history size
    if (this.failures.length > this.maxHistory) {
      this.failures.shift();
    }
  }

  /**
   * Track a successful refinement
   * @param {Object} success - Success details
   * @param {string} success.original - Original problematic prompt
   * @param {string} success.refined - Refined prompt that succeeded
   * @param {number} success.attempts - Number of attempts needed
   */
  trackSuccess(success) {
    this.successes.push({
      ...success,
      timestamp: new Date().toISOString()
    });

    // Limit history size
    if (this.successes.length > this.maxHistory) {
      this.successes.shift();
    }
  }

  /**
   * Find similar violations/successes using cosine similarity
   * @param {string} prompt - Prompt to find similar examples for
   * @param {Object} options - Search options
   * @param {number} [options.maxResults=5] - Maximum results to return
   * @returns {Array} Similar examples sorted by similarity score
   */
  findSimilar(prompt, options = {}) {
    const maxResults = options.maxResults !== undefined ? options.maxResults : 5;

    // Only search in successes (most useful for guidance)
    if (this.successes.length === 0) {
      return [];
    }

    // Calculate similarity scores
    const scored = this.successes.map(success => ({
      ...success,
      score: this._calculateSimilarity(prompt, success.original)
    }));

    // Filter by threshold and sort by score
    const filtered = scored
      .filter(item => item.score >= this.similarityThreshold)
      .sort((a, b) => b.score - a.score);

    // Return top N results
    return filtered.slice(0, maxResults);
  }

  /**
   * Get violation statistics
   * @returns {Object} Statistics about violations
   */
  getStats() {
    const totalViolations = this.failures.length + this.successes.length;
    const successfulRefinements = this.successes.length;
    const failedRefinements = this.failures.length;

    let averageAttempts = 0;
    if (totalViolations > 0) {
      const totalAttempts = [
        ...this.failures.map(f => f.attempts),
        ...this.successes.map(s => s.attempts)
      ].reduce((sum, attempts) => sum + attempts, 0);

      averageAttempts = totalAttempts / totalViolations;
    }

    return {
      totalViolations,
      successfulRefinements,
      failedRefinements,
      successRate: totalViolations > 0 ? successfulRefinements / totalViolations : 0,
      averageAttempts
    };
  }

  /**
   * Get all failures
   * @returns {Array} Failure records
   */
  getFailures() {
    return [...this.failures];
  }

  /**
   * Get all successes
   * @returns {Array} Success records
   */
  getSuccesses() {
    return [...this.successes];
  }

  /**
   * Clear all history
   */
  clear() {
    this.failures = [];
    this.successes = [];
  }

  /**
   * Calculate cosine similarity between two prompts
   * Uses simple term frequency vectors
   * @private
   * @param {string} prompt1 - First prompt
   * @param {string} prompt2 - Second prompt
   * @returns {number} Similarity score 0-1
   */
  _calculateSimilarity(prompt1, prompt2) {
    // Tokenize and normalize
    const tokens1 = this._tokenize(prompt1.toLowerCase());
    const tokens2 = this._tokenize(prompt2.toLowerCase());

    // Build term frequency vectors
    const allTerms = new Set([...tokens1, ...tokens2]);
    const vector1 = [];
    const vector2 = [];

    for (const term of allTerms) {
      vector1.push(tokens1.filter(t => t === term).length);
      vector2.push(tokens2.filter(t => t === term).length);
    }

    // Calculate cosine similarity
    return this._cosineSimilarity(vector1, vector2);
  }

  /**
   * Tokenize text into words
   * @private
   * @param {string} text - Text to tokenize
   * @returns {Array<string>} Tokens
   */
  _tokenize(text) {
    // Remove punctuation and split on whitespace
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0);
  }

  /**
   * Calculate cosine similarity between two vectors
   * @private
   * @param {number[]} vec1 - First vector
   * @param {number[]} vec2 - Second vector
   * @returns {number} Cosine similarity 0-1
   */
  _cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length || vec1.length === 0) {
      return 0;
    }

    // Dot product
    let dotProduct = 0;
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
    }

    // Magnitudes
    const mag1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const mag2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));

    // Avoid division by zero
    if (mag1 === 0 || mag2 === 0) {
      return 0;
    }

    return dotProduct / (mag1 * mag2);
  }
}

module.exports = ViolationTracker;
