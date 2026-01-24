/**
 * Local VLM Provider
 * Uses llama-cpp-python with multimodal GGUF models for pairwise image comparison.
 * Implements ImageRanker interface for integration with beam search.
 * Supports tournament-style ranking with transitive inference.
 */

const axios = require('axios');

const DEFAULT_API_URL = process.env.LOCAL_VLM_URL || 'http://localhost:8004';
const DEFAULT_MODEL = 'llava-v1.6-mistral-7b.Q4_K_M.gguf';

// Multi-factor ranking weights (matching ImageRanker)
// Default: 70% alignment (prompt match), 30% aesthetics
const DEFAULT_ALIGNMENT_WEIGHT = 0.7;

/**
 * Comparison Graph for transitive inference
 * Tracks A > B relationships and infers A > C when A > B and B > C
 */
class ComparisonGraph {
  constructor() {
    this.beats = new Map();  // candidateId → Set of candidateIds it beats
    this.losesTo = new Map(); // candidateId → Set of candidateIds it loses to
  }

  recordComparison(idA, idB, winner) {
    const winnerId = winner === 'A' ? idA : idB;
    const loserId = winner === 'A' ? idB : idA;

    if (!this.beats.has(winnerId)) this.beats.set(winnerId, new Set());
    if (!this.losesTo.has(loserId)) this.losesTo.set(loserId, new Set());

    this.beats.get(winnerId).add(loserId);
    this.losesTo.get(loserId).add(winnerId);

    this._propagateTransitivity(winnerId, loserId);
  }

  _propagateTransitivity(winnerId, loserId) {
    // All candidates that beat winner also beat loser
    const beatWinner = this.losesTo.get(winnerId) || new Set();
    for (const superiorId of beatWinner) {
      if (!this.beats.has(superiorId)) this.beats.set(superiorId, new Set());
      this.beats.get(superiorId).add(loserId);
      if (!this.losesTo.has(loserId)) this.losesTo.set(loserId, new Set());
      this.losesTo.get(loserId).add(superiorId);
    }

    // Winner beats all candidates that loser beats
    const loserBeats = this.beats.get(loserId) || new Set();
    for (const inferiorId of loserBeats) {
      if (!this.beats.has(winnerId)) this.beats.set(winnerId, new Set());
      this.beats.get(winnerId).add(inferiorId);
      if (!this.losesTo.has(inferiorId)) this.losesTo.set(inferiorId, new Set());
      this.losesTo.get(inferiorId).add(winnerId);
    }
  }

  canInferWinner(idA, idB) {
    if (this.beats.has(idA) && this.beats.get(idA).has(idB)) {
      return { winner: idA, inferred: true };
    }
    if (this.beats.has(idB) && this.beats.get(idB).has(idA)) {
      return { winner: idB, inferred: true };
    }
    return null;
  }
}

class LocalVLMProvider {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || DEFAULT_API_URL;
    this.model = options.model || DEFAULT_MODEL;
    // VLM comparisons take 150-160s on 12GB GPU with Qwen2.5-VL-7B
    // Default 180s (3min) with env override for flexibility
    this.timeout = options.timeout || parseInt(process.env.VLM_TIMEOUT_MS || '180000', 10);
    this._axios = axios; // Allow injection for testing
    this._comparisonGraph = new ComparisonGraph();
    this._errors = [];
    // Multi-factor ranking weight (matching ImageRanker)
    this.alignmentWeight = options.alignmentWeight ?? DEFAULT_ALIGNMENT_WEIGHT;
  }

  /**
   * Calculate combined rank score from alignment and aesthetics ranks
   * Lower combined score is better (rank 1 is better than rank 2)
   * @private
   */
  _calculateCombinedRank(imageRanks) {
    const alignWeight = this.alignmentWeight;
    const aestheticWeight = 1 - alignWeight;
    return (alignWeight * imageRanks.alignment) + (aestheticWeight * imageRanks.aesthetics);
  }

  /**
   * Get the image path for VLM comparison
   * Prefers localPath (required for VLM file access), falls back to url
   * @param {Object} image - Image object with localPath and/or url
   * @returns {string} Path to use for comparison
   * @throws {Error} If no valid path is available
   */
  _getImagePath(image) {
    if (image.localPath) {
      return image.localPath;
    }
    if (image.url) {
      // VLM service requires local files - URL-only images aren't supported
      throw new Error(`VLM requires local file paths. Image ${image.candidateId} only has URL (use Flux for local generation).`);
    }
    throw new Error(`Image ${image.candidateId} has no path or URL`);
  }

  /**
   * Compare two images against a prompt
   * Returns structured feedback matching OpenAI ImageRanker.compareTwo() interface
   * @param {string} imageA - Path to first image
   * @param {string} imageB - Path to second image
   * @param {string} prompt - The prompt to evaluate images against
   * @returns {Promise<{choice: 'A'|'B'|'TIE', explanation: string, confidence: number, ranks: Object, winnerStrengths: string[], loserWeaknesses: string[], improvementSuggestion: string}>}
   */
  async compareImages(imageA, imageB, prompt) {
    try {
      const response = await this._axios.post(
        `${this.apiUrl}/compare`,
        {
          image_a: imageA,
          image_b: imageB,
          prompt: prompt
        },
        { timeout: this.timeout }
      );

      const data = response.data;

      // Parse ranks and calculate combined scores
      let ranks = data.ranks || {
        A: { alignment: 1, aesthetics: 1 },
        B: { alignment: 2, aesthetics: 2 }
      };

      // Ensure ranks have alignment and aesthetics
      for (const img of ['A', 'B']) {
        if (ranks[img]) {
          ranks[img].alignment = ranks[img].alignment || 1;
          ranks[img].aesthetics = ranks[img].aesthetics || 1;
          // Calculate combined rank score (lower is better)
          ranks[img].combined = this._calculateCombinedRank(ranks[img]);
        }
      }

      // Map snake_case from Python to camelCase for JS
      return {
        choice: data.choice,
        explanation: data.explanation || '',
        confidence: data.confidence || 0.5,
        ranks: ranks,
        winnerStrengths: data.winner_strengths || [],
        loserWeaknesses: data.loser_weaknesses || [],
        improvementSuggestion: data.improvement_suggestion || ''
      };
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
        throw new Error(`VLM service unavailable at ${this.apiUrl}`);
      }
      if (error.message.includes('not found') || error.message.includes('File not found')) {
        throw new Error(`Image file not found: ${error.message}`);
      }
      if (error.response?.status === 503) {
        throw new Error('VLM model not loaded (503)');
      }
      throw error;
    }
  }

  /**
   * Rank multiple images using pairwise comparisons
   * Implements ImageRanker interface for beam search integration
   * Delegates to rankImagesWithTransitivity for full functionality
   * @param {Array<{localPath: string, candidateId: number, url?: string}>} images - Images to rank
   * @param {string} prompt - The prompt to evaluate against
   * @param {Object} [options] - Ranking options (same as ImageRanker)
   * @param {number} [options.keepTop] - Number of top candidates needed
   * @param {Array} [options.knownComparisons] - Pre-existing comparisons to skip
   * @param {number} [options.ensembleSize] - Ignored (VLM doesn't do ensemble voting)
   * @param {boolean} [options.gracefulDegradation] - Continue on errors
   * @returns {Promise<Array<{candidateId: number, rank: number, reason: string}>>}
   */
  async rankImages(images, prompt, options = {}) {
    if (images.length <= 1) {
      return images.map((img, i) => ({
        ...img,
        candidateId: img.candidateId,
        rank: i + 1,
        reason: 'Only candidate'
      }));
    }

    // Delegate to the full implementation
    return this.rankImagesWithTransitivity(images, prompt, {
      knownComparisons: options.knownComparisons || [],
      gracefulDegradation: options.gracefulDegradation ?? false,
      // Use all-pairs for small sets, tournament for larger
      strategy: images.length <= 8 ? 'all-pairs' : 'tournament'
    });
  }

  /**
   * Rank images using tournament-style selection with transitive inference
   * Mirrors ImageRanker pattern for consistency
   * @param {Array<{localPath: string, candidateId: number}>} images - Images to rank
   * @param {string} prompt - The prompt to evaluate against
   * @param {Object} options - Ranking options
   * @param {Array} [options.knownComparisons] - Pre-existing comparisons to skip
   * @param {string} [options.strategy] - 'all-pairs' or 'tournament'
   * @param {Function} [options.onProgress] - Progress callback
   * @param {boolean} [options.gracefulDegradation] - Continue on errors
   * @returns {Promise<Array<{candidateId: number, rank: number, reason: string, wins?: number}>>}
   */
  async rankImagesWithTransitivity(images, prompt, options = {}) {
    const { knownComparisons = [], strategy, onProgress, gracefulDegradation = false } = options;

    // Reset errors for this ranking session
    this._errors = [];

    // Pre-populate graph with known comparisons
    for (const { winnerId, loserId } of knownComparisons) {
      this._comparisonGraph.recordComparison(winnerId, loserId, 'A');
    }

    // Choose strategy: all-pairs for small N (≤8), tournament for large N
    const useAllPairs = strategy === 'all-pairs' || images.length <= 8;

    try {
      if (useAllPairs) {
        return await this._rankAllPairs(images, prompt, { onProgress, gracefulDegradation });
      } else {
        return await this._rankTournament(images, prompt, { onProgress, gracefulDegradation });
      }
    } catch (error) {
      if (gracefulDegradation) {
        this._errors.push({ message: error.message, type: 'ranking_failure', fatal: true });
        return images.map((img, i) => ({ ...img, rank: i + 1, reason: 'Ranking failed' }));
      }
      throw error;
    }
  }

  /**
   * All-pairs comparison strategy for small N
   * Tracks structured feedback for CritiqueGenerator
   * @private
   */
  async _rankAllPairs(images, prompt, options = {}) {
    const { onProgress, gracefulDegradation } = options;
    const winCounts = new Map(images.map(img => [img.candidateId, 0]));
    const pairs = [];
    // Track feedback per candidate for final ranking
    const candidateFeedback = new Map(images.map(img => [img.candidateId, {
      strengths: [],
      weaknesses: [],
      lastRanks: null,
      improvementSuggestion: ''
    }]));

    // Generate all unique pairs
    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        pairs.push({ a: images[i], b: images[j] });
      }
    }

    let completed = 0;
    const total = pairs.length;

    for (const { a, b } of pairs) {
      // Check if we can infer from transitivity
      const inferred = this._comparisonGraph.canInferWinner(a.candidateId, b.candidateId);

      if (inferred) {
        if (inferred.winner === a.candidateId) {
          winCounts.set(a.candidateId, winCounts.get(a.candidateId) + 1);
        } else {
          winCounts.set(b.candidateId, winCounts.get(b.candidateId) + 1);
        }
        completed++;
        if (onProgress) {
          onProgress({ type: 'comparison', completed, total, candidateA: a.candidateId, candidateB: b.candidateId, inferred: true });
        }
      } else {
        // Need actual comparison
        try {
          const result = await this.compareImages(this._getImagePath(a), this._getImagePath(b), prompt);
          this._comparisonGraph.recordComparison(a.candidateId, b.candidateId, result.choice);

          // Track feedback for winner and loser
          const winnerId = result.choice === 'A' ? a.candidateId : b.candidateId;
          const loserId = result.choice === 'A' ? b.candidateId : a.candidateId;

          if (result.choice === 'A' || result.choice === 'TIE') {
            winCounts.set(a.candidateId, winCounts.get(a.candidateId) + 1);
          } else {
            winCounts.set(b.candidateId, winCounts.get(b.candidateId) + 1);
          }

          // Store feedback for the winner
          const winnerFeedback = candidateFeedback.get(winnerId);
          if (result.winnerStrengths?.length > 0) {
            winnerFeedback.strengths.push(...result.winnerStrengths);
          }
          if (result.ranks) {
            winnerFeedback.lastRanks = result.choice === 'A' ? result.ranks.A : result.ranks.B;
          }
          if (result.improvementSuggestion) {
            winnerFeedback.improvementSuggestion = result.improvementSuggestion;
          }

          // Store weaknesses for the loser
          const loserFeedback = candidateFeedback.get(loserId);
          if (result.loserWeaknesses?.length > 0) {
            loserFeedback.weaknesses.push(...result.loserWeaknesses);
          }

          completed++;
          if (onProgress) {
            onProgress({
              type: 'comparison', completed, total, candidateA: a.candidateId, candidateB: b.candidateId,
              winner: winnerId, inferred: false
            });
          }
        } catch (error) {
          this._errors.push({ message: error.message, type: 'comparison_failure', candidateA: a.candidateId, candidateB: b.candidateId });
          if (!gracefulDegradation) throw error;
          completed++;
          if (onProgress) {
            onProgress({ type: 'comparison', completed, total, candidateA: a.candidateId, candidateB: b.candidateId, error: true });
          }
        }
      }
    }

    // Sort by wins descending
    const ranked = images
      .map(img => ({ ...img, wins: winCounts.get(img.candidateId) || 0 }))
      .sort((a, b) => b.wins - a.wins);

    return ranked.map((img, i) => {
      const feedback = candidateFeedback.get(img.candidateId);
      // Deduplicate strengths/weaknesses
      const uniqueStrengths = [...new Set(feedback.strengths)];
      const uniqueWeaknesses = [...new Set(feedback.weaknesses)];

      return {
        candidateId: img.candidateId,
        localPath: img.localPath,
        rank: i + 1,
        wins: img.wins,
        reason: `Rank ${i + 1} with ${img.wins} wins in all-pairs comparison`,
        // Include structured feedback for CritiqueGenerator
        strengths: uniqueStrengths.length > 0 ? uniqueStrengths : undefined,
        weaknesses: uniqueWeaknesses.length > 0 ? uniqueWeaknesses : undefined,
        ranks: feedback.lastRanks || undefined,
        improvementSuggestion: feedback.improvementSuggestion || undefined
      };
    });
  }

  /**
   * Tournament-style selection for large N
   * Returns structured feedback for CritiqueGenerator
   * @private
   */
  async _rankTournament(images, prompt, options = {}) {
    const { onProgress, gracefulDegradation } = options;
    const ranked = [];
    const remaining = [...images];

    for (let rank = 1; rank <= images.length; rank++) {
      if (remaining.length === 0) break;

      if (remaining.length === 1) {
        ranked.push({
          candidateId: remaining[0].candidateId,
          localPath: remaining[0].localPath,
          rank,
          reason: 'Last remaining candidate'
        });
        break;
      }

      // Find best among remaining using tournament
      const { winner, reason, strengths, weaknesses, ranks, improvementSuggestion } =
        await this._findBestWithTransitivity(remaining, prompt, { onProgress, gracefulDegradation });

      ranked.push({
        candidateId: winner.candidateId,
        localPath: winner.localPath,
        rank,
        reason,
        // Include structured feedback for CritiqueGenerator
        strengths: strengths?.length > 0 ? strengths : undefined,
        weaknesses: weaknesses?.length > 0 ? weaknesses : undefined,
        ranks: ranks || undefined,
        improvementSuggestion: improvementSuggestion || undefined
      });

      const winnerIdx = remaining.findIndex(img => img.candidateId === winner.candidateId);
      remaining.splice(winnerIdx, 1);
    }

    return ranked;
  }

  /**
   * Find best candidate using tournament with transitivity
   * Returns structured feedback for CritiqueGenerator
   * @private
   */
  async _findBestWithTransitivity(candidates, prompt, options = {}) {
    const { onProgress, gracefulDegradation } = options;

    if (candidates.length === 1) {
      return { winner: candidates[0], reason: 'Only candidate', strengths: [], weaknesses: [] };
    }

    let champion = candidates[0];
    let championReason = 'Initial candidate';
    let championStrengths = [];
    let championWeaknesses = [];
    let championRanks = null;
    let championImprovementSuggestion = '';

    for (let i = 1; i < candidates.length; i++) {
      const challenger = candidates[i];
      const inferred = this._comparisonGraph.canInferWinner(champion.candidateId, challenger.candidateId);

      if (inferred) {
        if (inferred.winner !== champion.candidateId) {
          champion = challenger;
          championReason = 'Better than previous champion (inferred via transitivity)';
          // Reset feedback when champion changes via inference
          championStrengths = [];
          championWeaknesses = [];
        }
        if (onProgress) {
          onProgress({ type: 'comparison', candidateA: champion.candidateId, candidateB: challenger.candidateId, inferred: true });
        }
      } else {
        try {
          const result = await this.compareImages(this._getImagePath(champion), this._getImagePath(challenger), prompt);
          this._comparisonGraph.recordComparison(champion.candidateId, challenger.candidateId, result.choice);

          if (result.choice === 'B') {
            champion = challenger;
            championReason = result.explanation || 'Won comparison';
            // Update feedback with winner's strengths
            championStrengths = result.winnerStrengths || [];
            championRanks = result.ranks?.B || null;
          } else {
            championReason = result.explanation || 'Defended championship';
            // Update feedback with winner's strengths
            championStrengths = result.winnerStrengths || [];
            championRanks = result.ranks?.A || null;
          }
          // Store weaknesses from comparison (for loser context)
          championWeaknesses = result.loserWeaknesses || [];
          championImprovementSuggestion = result.improvementSuggestion || '';

          if (onProgress) {
            onProgress({
              type: 'comparison', candidateA: champion.candidateId, candidateB: challenger.candidateId,
              winner: result.choice === 'A' ? champion.candidateId : challenger.candidateId, inferred: false
            });
          }
        } catch (error) {
          this._errors.push({ message: error.message, type: 'comparison_failure' });
          if (!gracefulDegradation) throw error;
        }
      }
    }

    return {
      winner: champion,
      reason: championReason,
      strengths: championStrengths,
      weaknesses: championWeaknesses,
      ranks: championRanks,
      improvementSuggestion: championImprovementSuggestion
    };
  }

  /**
   * Get the comparison graph for external use
   */
  getComparisonGraph() {
    return this._comparisonGraph;
  }

  /**
   * Reset the comparison graph
   */
  resetComparisonGraph() {
    this._comparisonGraph = new ComparisonGraph();
  }

  /**
   * Get errors from last ranking
   */
  getErrors() {
    return this._errors;
  }

  /**
   * Merge sort using VLM pairwise comparisons
   * @private
   */
  async _mergeSort(arr, prompt) {
    if (arr.length <= 1) return arr;

    const mid = Math.floor(arr.length / 2);
    const left = await this._mergeSort(arr.slice(0, mid), prompt);
    const right = await this._mergeSort(arr.slice(mid), prompt);

    return this._merge(left, right, prompt);
  }

  /**
   * Merge two sorted arrays using VLM comparisons
   * @private
   */
  async _merge(left, right, prompt) {
    const result = [];
    let i = 0, j = 0;

    while (i < left.length && j < right.length) {
      const comparison = await this.compareImages(
        this._getImagePath(left[i]),
        this._getImagePath(right[j]),
        prompt
      );

      if (comparison.choice === 'A' || comparison.choice === 'TIE') {
        left[i].wins++;
        result.push(left[i++]);
      } else {
        right[j].wins++;
        result.push(right[j++]);
      }
    }

    return [...result, ...left.slice(i), ...right.slice(j)];
  }

  /**
   * Check service health
   * @returns {Promise<{status: string, model_loaded: boolean, model: string}>}
   */
  async healthCheck() {
    try {
      const response = await this._axios.get(`${this.apiUrl}/health`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Load model explicitly (for GPU coordination)
   */
  async loadModel() {
    const response = await this._axios.post(`${this.apiUrl}/load`, {}, {
      timeout: 120000 // 2 minutes for model loading
    });
    return response.data;
  }

  /**
   * Unload model to free GPU memory
   */
  async unloadModel() {
    const response = await this._axios.post(`${this.apiUrl}/unload`, {}, {
      timeout: 30000
    });
    return response.data;
  }
}

module.exports = LocalVLMProvider;
