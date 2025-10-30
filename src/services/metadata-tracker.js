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
    this.outputDir = options.outputDir || path.join(process.cwd(), 'output');
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
  }

  /**
   * Get path to metadata.json file
   * @returns {string} Path to metadata file
   * @private
   */
  _getMetadataPath() {
    return path.join(this.outputDir, 'sessions', this.sessionId, 'metadata.json');
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
   * @returns {Promise<void>}
   * @private
   */
  async _writeMetadata() {
    const metadataPath = this._getMetadataPath();
    const json = JSON.stringify(this.metadata, null, 2);
    await fs.writeFile(metadataPath, json, 'utf8');
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
