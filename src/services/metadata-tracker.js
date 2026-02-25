/**
 * 🟢 TDD GREEN Phase: Metadata Tracker
 *
 * Tracks complete beam search session metadata including prompts, critiques,
 * scores, parent-child relationships, and lineage in a single JSON file.
 *
 * Related Issue: #8
 */

const fs = require('fs').promises;
const path = require('path');
const OutputPathManager = require('../utils/output-path-manager.js');

class MetadataTracker {
  /**
   * Create a new MetadataTracker
   * @param {Object} options - Configuration options
   * @param {string} options.outputDir - Base output directory
   * @param {string} options.sessionId - Unique session identifier
   * @param {string} [options.userPrompt] - Original user prompt
   * @param {Object} [options.config] - Beam search configuration
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || OutputPathManager.DEFAULT_OUTPUT_DIR;
    this.sessionId = options.sessionId;
    this.userPrompt = options.userPrompt || '';
    this.config = options.config || {};

    // In-memory metadata structure
    this.metadata = {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      userPrompt: this.userPrompt,
      config: this.config,
      iterations: [],
      finalWinner: null,
      lineage: null
    };

    // Write queue to serialize metadata writes and prevent file contention
    // Multiple candidates writing in parallel would cause file lock issues
    this.writeQueue = Promise.resolve();
  }

  /**
   * Get path to metadata.json file
   * Uses date-based structure: output/YYYY-MM-DD/ses-HHMMSS/metadata.json
   * @returns {string} Path to metadata file
   * @private
   */
  _getMetadataPath() {
    return OutputPathManager.buildMetadataPath(this.outputDir, this.sessionId);
  }

  /**
   * Initialize metadata file
   * Creates the metadata.json file with initial session info
   * @returns {Promise<void>}
   */
  async initialize() {
    const metadataPath = this._getMetadataPath();
    const dir = path.dirname(metadataPath);

    // Create directory
    await fs.mkdir(dir, { recursive: true });

    // Write initial metadata
    await this._writeMetadata();
  }

  /**
   * Write current metadata to disk
   * Uses a write queue to serialize writes and prevent file contention
   * when multiple candidates are processed in parallel.
   * @returns {Promise<void>}
   * @private
   */
  async _writeMetadata() {
    // Queue the write operation to prevent concurrent writes to same file
    this.writeQueue = this.writeQueue.then(async () => {
      const metadataPath = this._getMetadataPath();
      const json = JSON.stringify(this.metadata, null, 2);
      await fs.writeFile(metadataPath, json, 'utf8');
    });

    // Wait for this write to complete before returning
    await this.writeQueue;
  }

  /**
   * Get current metadata
   * @returns {Promise<Object>} Current metadata object
   */
  async getMetadata() {
    return this.metadata;
  }

  /**
   * Find or create iteration entry
   * @param {number} iterationNumber - Iteration number
   * @param {string} dimension - Dimension (what/how)
   * @returns {Object} Iteration entry
   * @private
   */
  _getOrCreateIteration(iterationNumber, dimension) {
    let iteration = this.metadata.iterations.find(it => it.iteration === iterationNumber);

    if (!iteration) {
      iteration = {
        iteration: iterationNumber,
        dimension: dimension,
        candidates: [],
        bestCandidateId: null,
        bestScore: null
      };
      this.metadata.iterations.push(iteration);
    }

    return iteration;
  }

  /**
   * Record a candidate result
   * @param {Object} candidate - Candidate data from beam search
   * @param {Object} options - Recording options
   * @param {boolean} options.survived - Whether candidate survived selection
   * @returns {Promise<void>}
   */
  async recordCandidate(candidate, options = {}) {
    const { survived = false } = options;
    const { iteration, candidateId, dimension, parentId } = candidate.metadata;

    // Get or create iteration entry
    const iterationEntry = this._getOrCreateIteration(iteration, dimension);

    // Build candidate record
    const candidateRecord = {
      candidateId,
      parentId: parentId !== undefined ? parentId : null,
      whatPrompt: candidate.whatPrompt,
      howPrompt: candidate.howPrompt,
      combined: candidate.combined,
      negativePrompt: candidate.negativePrompt || null,
      negativePromptMetadata: candidate.negativePromptMetadata || null,
      critique: candidate.critique || null,
      image: {
        url: candidate.image.url,
        localPath: candidate.image.localPath
      },
      evaluation: {
        alignmentScore: candidate.evaluation.alignmentScore,
        aestheticScore: candidate.evaluation.aestheticScore,
        analysis: candidate.evaluation.analysis,
        strengths: candidate.evaluation.strengths || [],
        weaknesses: candidate.evaluation.weaknesses || []
      },
      totalScore: candidate.totalScore,
      survived
    };

    // Add to iteration
    iterationEntry.candidates.push(candidateRecord);

    // Update best candidate for iteration
    if (iterationEntry.bestScore === null || candidate.totalScore > iterationEntry.bestScore) {
      iterationEntry.bestCandidateId = candidateId;
      iterationEntry.bestScore = candidate.totalScore;
    }

    // Persist to disk
    await this._writeMetadata();
  }

  /**
   * Record an attempt before processing (defensive metadata)
   * Records what/how prompts and metadata BEFORE risky operations.
   * This ensures we have a record of what was attempted even if processing fails.
   *
   * @param {Object} attemptInfo - Attempt information
   * @param {string} attemptInfo.whatPrompt - Content prompt
   * @param {string} attemptInfo.howPrompt - Style prompt
   * @param {Object} attemptInfo.metadata - Metadata with iteration, candidateId, dimension
   * @param {string} [attemptInfo.critique] - Optional critique that prompted this attempt
   * @returns {Promise<void>}
   */
  async recordAttempt(attemptInfo) {
    const { whatPrompt, howPrompt, metadata, critique } = attemptInfo;
    const { iteration, candidateId, dimension, parentId } = metadata;

    // Get or create iteration entry
    const iterationEntry = this._getOrCreateIteration(iteration, dimension);

    // Build minimal candidate record with attempt status
    const candidateRecord = {
      candidateId,
      parentId: parentId !== undefined ? parentId : null,
      whatPrompt,
      howPrompt,
      critique: critique || null,
      status: 'attempted',
      combined: null,
      negativePrompt: null,
      negativePromptMetadata: null,
      image: null,
      evaluation: null,
      totalScore: null,
      survived: null,
      comparisons: [],
      aggregatedFeedback: null
    };

    // Add to iteration
    iterationEntry.candidates.push(candidateRecord);

    // Persist to disk immediately (before any risky operations)
    await this._writeMetadata();
  }

  /**
   * Update an attempt with processing results
   * Called after successful processing to update the attempt with actual results.
   *
   * @param {number} iteration - Iteration number
   * @param {number} candidateId - Candidate ID
   * @param {Object} results - Processing results
   * @param {string} results.combined - Combined prompt
   * @param {Object} results.image - Image data
   * @param {Object} results.evaluation - Evaluation data
   * @param {number} results.totalScore - Total score
   * @param {Object} options - Update options
   * @param {boolean} options.survived - Whether candidate survived selection
   * @returns {Promise<void>}
   */
  async updateAttemptWithResults(iteration, candidateId, results, options = {}) {
    const { survived = false } = options;

    // Find the iteration
    const iterationEntry = this.metadata.iterations.find(it => it.iteration === iteration);
    if (!iterationEntry) {
      throw new Error(`Iteration ${iteration} not found`);
    }

    // Find the candidate
    const candidate = iterationEntry.candidates.find(c => c.candidateId === candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${candidateId} not found in iteration ${iteration}`);
    }

    // Update with results
    candidate.status = 'completed';
    candidate.combined = results.combined;
    candidate.negativePrompt = results.negativePrompt || null;
    candidate.negativePromptMetadata = results.negativePromptMetadata || null;
    if (candidate.negativePrompt) {
      console.log(`[MetadataTracker] Recording negative prompt for iter ${iteration} cand ${candidateId}: "${candidate.negativePrompt.substring(0, 80)}..."`);
    } else {
      console.log(`[MetadataTracker] No negative prompt for iter ${iteration} cand ${candidateId} (received: ${results.negativePrompt === undefined ? 'undefined' : results.negativePrompt === null ? 'null' : `"${results.negativePrompt}"`})`);
    }
    candidate.image = {
      url: results.image.url,
      localPath: results.image.localPath,
      ...(results.image.baseImagePath && { baseImagePath: results.image.baseImagePath })
    };

    // Handle evaluation (null when using ranking-based flow)
    if (results.evaluation) {
      candidate.evaluation = {
        alignmentScore: results.evaluation.alignmentScore,
        aestheticScore: results.evaluation.aestheticScore,
        analysis: results.evaluation.analysis,
        strengths: results.evaluation.strengths || [],
        weaknesses: results.evaluation.weaknesses || []
      };
    } else {
      candidate.evaluation = null; // Will be populated by ranking step
    }

    candidate.totalScore = results.totalScore;
    candidate.survived = survived;

    // Update best candidate for iteration (only if using score-based ranking)
    if (results.totalScore !== null) {
      if (iterationEntry.bestScore === null || results.totalScore > iterationEntry.bestScore) {
        iterationEntry.bestCandidateId = candidateId;
        iterationEntry.bestScore = results.totalScore;
      }
    }

    // Persist to disk
    await this._writeMetadata();
  }

  /**
   * Enrich a candidate record with ranking data from pairwise comparisons.
   * Called after ranking completes to attach per-comparison details and
   * aggregated feedback to the candidate's metadata record.
   *
   * @param {number} iteration - Iteration number
   * @param {number} candidateId - Candidate ID
   * @param {Object} rankingData - Ranking enrichment data
   * @param {Array} rankingData.comparisons - Per-pairwise comparison results
   * @param {Object|null} rankingData.aggregatedFeedback - Merged feedback from all comparisons
   * @param {Object} [rankingData.critique] - Optional critique object
   * @returns {Promise<void>}
   */
  async enrichCandidateWithRankingData(iteration, candidateId, rankingData) {
    const { comparisons, aggregatedFeedback, critique } = rankingData;

    const iterationEntry = this.metadata.iterations.find(it => it.iteration === iteration);
    if (!iterationEntry) {
      throw new Error(`Iteration ${iteration} not found`);
    }

    const candidate = iterationEntry.candidates.find(c => c.candidateId === candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${candidateId} not found in iteration ${iteration}`);
    }

    candidate.comparisons = comparisons || [];
    candidate.aggregatedFeedback = aggregatedFeedback || null;
    if (critique) candidate.critique = critique;

    // Update bestCandidateId for ranking-based flow (where totalScore is null)
    // Use combined rank from aggregated feedback — lower rank is better
    if (aggregatedFeedback?.ranks?.combined != null) {
      const candidateRank = aggregatedFeedback.ranks.combined;
      if (iterationEntry.bestScore === null || candidateRank < iterationEntry.bestScore) {
        iterationEntry.bestCandidateId = candidateId;
        iterationEntry.bestScore = candidateRank;
      }
    }

    await this._writeMetadata();
  }

  /**
   * Mark the final winner and compute lineage
   * @param {Object} winner - Final winner info
   * @param {number} winner.iteration - Winner's iteration
   * @param {number} winner.candidateId - Winner's candidate ID
   * @param {number} winner.totalScore - Winner's total score
   * @returns {Promise<void>}
   */
  async markFinalWinner(winner) {
    this.metadata.finalWinner = {
      iteration: winner.iteration,
      candidateId: winner.candidateId,
      totalScore: winner.totalScore
    };

    // Build lineage path from winner back to root
    this.metadata.lineage = this._buildLineage(winner.iteration, winner.candidateId);

    // Persist to disk
    await this._writeMetadata();
  }

  /**
   * Record ranking data for an iteration
   * Writes to a separate rankings.json file alongside metadata.json
   * @param {number} iteration - Iteration number
   * @param {Object} rankingData - Ranking results for this iteration
   * @param {Array} rankingData.rankings - Candidate rankings with rank, wins, aggregateStats
   * @param {Array} rankingData.comparisons - Direct comparison results from ComparisonGraph
   * @param {Array} rankingData.globalRanked - Global rank assignments
   * @returns {Promise<void>}
   */
  async recordIterationRanking(iteration, rankingData) {
    const rankingsPath = this._getRankingsPath();

    // Load existing rankings file or create new
    let rankings;
    try {
      const json = await fs.readFile(rankingsPath, 'utf8');
      rankings = JSON.parse(json);
    } catch {
      rankings = {
        sessionId: this.sessionId,
        iterations: {}
      };
    }

    rankings.iterations[iteration] = rankingData;

    // Write rankings file
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(rankingsPath, JSON.stringify(rankings, null, 2), 'utf8');
    });
    await this.writeQueue;
  }

  /**
   * Record the final global ranking across all iterations
   * @param {Array} finalGlobalRanking - Final ranking with candidateId and globalRank
   * @returns {Promise<void>}
   */
  async recordFinalGlobalRanking(finalGlobalRanking) {
    const rankingsPath = this._getRankingsPath();

    let rankings;
    try {
      const json = await fs.readFile(rankingsPath, 'utf8');
      rankings = JSON.parse(json);
    } catch {
      rankings = {
        sessionId: this.sessionId,
        iterations: {}
      };
    }

    rankings.finalGlobalRanking = finalGlobalRanking;

    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(rankingsPath, JSON.stringify(rankings, null, 2), 'utf8');
    });
    await this.writeQueue;
  }

  /**
   * Get path to rankings.json file
   * @returns {string} Path to rankings file
   * @private
   */
  _getRankingsPath() {
    const metadataPath = this._getMetadataPath();
    return path.join(path.dirname(metadataPath), 'rankings.json');
  }

  /**
   * Get path to tokens.json file
   * @returns {string} Path to tokens file
   * @private
   */
  _getTokensPath() {
    const metadataPath = this._getMetadataPath();
    return path.join(path.dirname(metadataPath), 'tokens.json');
  }

  /**
   * Persist token usage and cost data to tokens.json
   * @param {Object} tokenTracker - TokenTracker instance with getStats(), getEstimatedCost(), getRecords()
   * @returns {Promise<void>}
   */
  async persistTokens(tokenTracker) {
    const tokensPath = this._getTokensPath();
    const stats = tokenTracker.getStats();
    const cost = tokenTracker.getEstimatedCost();

    const tokenData = {
      sessionId: this.sessionId,
      generatedAt: new Date().toISOString(),
      totals: stats,
      estimatedCost: cost,
      records: tokenTracker.getRecords()
    };

    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(tokensPath, JSON.stringify(tokenData, null, 2), 'utf8');
    });
    await this.writeQueue;
  }

  /**
   * Build lineage path from a candidate back to root
   * @param {number} iteration - Current iteration
   * @param {number} candidateId - Current candidate ID
   * @returns {Array<Object>} Lineage path [{iteration, candidateId}, ...]
   * @private
   */
  _buildLineage(iteration, candidateId) {
    const lineage = [];
    let currentIteration = iteration;
    let currentCandidateId = candidateId;

    while (currentIteration !== null && currentIteration !== undefined) {
      // Add current node to lineage
      lineage.unshift({
        iteration: currentIteration,
        candidateId: currentCandidateId
      });

      // Find parent
      const iterationData = this.metadata.iterations.find(it => it.iteration === currentIteration);
      if (!iterationData) break;

      const candidateData = iterationData.candidates.find(c => c.candidateId === currentCandidateId);
      if (!candidateData || candidateData.parentId === null) break;

      // Move to parent (in previous iteration)
      currentIteration = currentIteration - 1;
      currentCandidateId = candidateData.parentId;
    }

    return lineage;
  }
}

module.exports = MetadataTracker;
