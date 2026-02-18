/**
 * Evaluation Tracker
 *
 * Manages Human-in-the-Loop (HITL) evaluation sessions for beam search results.
 * Stores pairwise comparison data for AI evaluation using Bradley-Terry model.
 *
 * Uses transitive inference (via ComparisonGraph) to skip redundant comparisons:
 * if A > B and B > C, then A > C is inferred without asking the human.
 * This reduces comparisons from C(N,2) to roughly O(N log N).
 *
 * Evaluation Flow:
 * 1. Load completed beam search session
 * 2. Generate all pairwise comparisons C(N, 2) = N*(N-1)/2
 * 3. Present pairs to evaluator (skipping inferrable pairs)
 * 4. Collect comparison results (A wins, B wins, or tie)
 * 5. Export data for statistical analysis
 */

const fs = require('fs').promises;
const path = require('path');
const { ComparisonGraph } = require('../utils/comparison-graph.js');
const OutputPathManager = require('../utils/output-path-manager.js');

/**
 * Build a globally unique ID for a candidate
 * @param {Object} candidate - Candidate with iteration and candidateId
 * @returns {string} Global ID like "i0c1"
 */
function globalId(candidate) {
  return `i${candidate.iteration}c${candidate.candidateId}`;
}

class EvaluationTracker {
  /**
   * Create a new EvaluationTracker
   * @param {Object} options - Configuration options
   * @param {string} options.outputDir - Base output directory
   * @param {string} options.evaluationId - Unique evaluation identifier
   * @param {string} options.sessionId - Reference to beam search session
   * @param {string} [options.evaluatorId] - Evaluator identifier (default: anonymous)
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || OutputPathManager.DEFAULT_OUTPUT_DIR;
    this.evaluationId = options.evaluationId;
    this.sessionId = options.sessionId;
    this.evaluatorId = options.evaluatorId || 'anonymous';

    // Comparison graph for transitive inference
    this._comparisonGraph = new ComparisonGraph();

    // In-memory evaluation structure
    this.evaluation = {
      evaluationId: this.evaluationId,
      sessionId: this.sessionId,
      evaluatorId: this.evaluatorId,
      createdAt: new Date().toISOString(),
      completedAt: null,
      status: 'in_progress', // or 'completed'
      userPrompt: '', // Copied from beam search session
      candidates: [], // Candidate info for this evaluation
      comparisons: [], // Pairwise comparison results
      progress: {
        totalPairs: 0,
        completedPairs: 0,
        manualPairs: 0,
        inferredPairs: 0
      }
    };

    // Write queue to serialize writes
    this.writeQueue = Promise.resolve();
  }

  /**
   * Get path to evaluation.json file
   * Stored alongside metadata.json: output/YYYY-MM-DD/ses-HHMMSS/evaluation-{evaluationId}.json
   * @returns {string} Path to evaluation file
   * @private
   */
  _getEvaluationPath() {
    const sessionPath = OutputPathManager.buildSessionPath(this.outputDir, this.sessionId);
    return path.join(sessionPath, `evaluation-${this.evaluationId}.json`);
  }

  /**
   * Initialize evaluation from beam search metadata
   * Loads candidates and generates pairwise comparison tasks
   * @param {Object} beamSearchMetadata - Metadata from completed beam search
   * @returns {Promise<void>}
   */
  async initialize(beamSearchMetadata) {
    // Copy user prompt for context
    this.evaluation.userPrompt = beamSearchMetadata.userPrompt;

    // Extract all candidates from all iterations
    const candidates = [];
    for (const iteration of beamSearchMetadata.iterations) {
      for (const candidate of iteration.candidates) {
        candidates.push({
          candidateId: candidate.candidateId,
          iteration: iteration.iteration,
          localPath: candidate.image.localPath,
          combined: candidate.combined,
          whatPrompt: candidate.whatPrompt,
          howPrompt: candidate.howPrompt,
          originalScore: candidate.totalScore
        });
      }
    }

    this.evaluation.candidates = candidates;

    // Calculate total pairs: C(N, 2) = N * (N-1) / 2
    const n = candidates.length;
    this.evaluation.progress.totalPairs = (n * (n - 1)) / 2;

    // Write initial evaluation file
    await this._writeEvaluation();
  }

  /**
   * Write current evaluation to disk
   * @returns {Promise<void>}
   * @private
   */
  async _writeEvaluation() {
    this.writeQueue = this.writeQueue.then(async () => {
      const evaluationPath = this._getEvaluationPath();
      const dir = path.dirname(evaluationPath);

      // Create directory structure if it doesn't exist
      await fs.mkdir(dir, { recursive: true });

      const json = JSON.stringify(this.evaluation, null, 2);
      await fs.writeFile(evaluationPath, json, 'utf8');
    });

    await this.writeQueue;
  }

  /**
   * Get next pairwise comparison task
   * Returns the next pair that hasn't been evaluated yet and can't be inferred.
   * Pairs where the winner can be inferred via transitivity are auto-recorded.
   *
   * IMPORTANT: Randomizes presentation order to prevent position bias.
   * Without randomization, the first candidate (e.g., i0c0) always appears
   * on the left/A position, causing it to win due to position bias.
   *
   * @returns {Promise<Object|null>} Next comparison task or null if all complete
   */
  async getNextComparison() {
    const candidates = this.evaluation.candidates;
    // Use comparisonId (original pair key) to track completed pairs,
    // since candidateA/B may be swapped for presentation
    const completedPairs = new Set(
      this.evaluation.comparisons.map(c => c.comparisonId)
    );

    // Generate all possible pairs
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const first = candidates[i];
        const second = candidates[j];
        const firstGlobalId = globalId(first);
        const secondGlobalId = globalId(second);
        const pairKey = `${firstGlobalId}-${secondGlobalId}`;

        if (completedPairs.has(pairKey)) continue;

        // Check if winner can be inferred via transitivity
        const inferred = this._comparisonGraph.canInferWinner(firstGlobalId, secondGlobalId);

        if (inferred) {
          // Auto-record inferred comparison
          const winner = inferred.winner === firstGlobalId ? 'A' : 'B';
          const record = {
            comparisonId: pairKey,
            candidateA: firstGlobalId,
            candidateB: secondGlobalId,
            winner,
            responseTimeMs: 0,
            inferred: true,
            presentationOrder: 'original',
            timestamp: new Date().toISOString()
          };

          this.evaluation.comparisons.push(record);
          this.evaluation.progress.completedPairs++;
          this.evaluation.progress.inferredPairs++;
          completedPairs.add(pairKey);

          // Check completion
          if (this.evaluation.progress.completedPairs >= this.evaluation.progress.totalPairs) {
            this.evaluation.status = 'completed';
            this.evaluation.completedAt = new Date().toISOString();
          }
          continue;
        }

        // This pair needs manual evaluation — save inferred results so far and return
        await this._writeEvaluation();

        // Randomize presentation order to mitigate position bias
        // 50% chance to swap A and B positions
        const shouldSwap = Math.random() < 0.5;
        const presentedA = shouldSwap ? second : first;
        const presentedB = shouldSwap ? first : second;

        return {
          comparisonId: pairKey,
          candidateA: presentedA,
          candidateB: presentedB,
          // Track presentation order for bias analysis
          presentationOrder: shouldSwap ? 'swapped' : 'original',
          // Preserve original pair info for correct winner mapping
          originalPair: {
            first: firstGlobalId,
            second: secondGlobalId
          },
          progress: {
            completed: this.evaluation.progress.completedPairs,
            total: this.evaluation.progress.totalPairs,
            manualPairs: this.evaluation.progress.manualPairs,
            inferredPairs: this.evaluation.progress.inferredPairs,
            percentage: Math.round((this.evaluation.progress.completedPairs / this.evaluation.progress.totalPairs) * 100)
          }
        };
      }
    }

    // All pairs evaluated (or inferred) — persist final state
    await this._writeEvaluation();
    return null;
  }

  /**
   * Record a comparison result
   * @param {Object} comparison - Comparison result
   * @param {string} comparison.comparisonId - Comparison identifier (e.g., "i0c0-i0c1")
   * @param {string} comparison.candidateA - First candidate global ID (as presented)
   * @param {string} comparison.candidateB - Second candidate global ID (as presented)
   * @param {string} comparison.winner - Winner: 'A', 'B', or 'tie'
   * @param {number} comparison.responseTimeMs - Time taken to make decision
   * @param {string} [comparison.presentationOrder] - 'original' or 'swapped' for bias analysis
   * @returns {Promise<void>}
   */
  async recordComparison(comparison) {
    // Validate winner
    if (!['A', 'B', 'tie'].includes(comparison.winner)) {
      throw new Error(`Invalid winner: ${comparison.winner}. Must be 'A', 'B', or 'tie'`);
    }

    // Update comparison graph for transitive inference (ties don't contribute)
    if (comparison.winner !== 'tie') {
      // Resolve the global IDs for the presented candidates
      const idA = comparison.candidateA;
      const idB = comparison.candidateB;
      this._comparisonGraph.recordComparison(idA, idB, comparison.winner);
    }

    // Add timestamp and store
    const comparisonRecord = {
      ...comparison,
      timestamp: new Date().toISOString()
    };

    this.evaluation.comparisons.push(comparisonRecord);
    this.evaluation.progress.completedPairs++;
    this.evaluation.progress.manualPairs++;

    // Check if evaluation is complete
    if (this.evaluation.progress.completedPairs >= this.evaluation.progress.totalPairs) {
      this.evaluation.status = 'completed';
      this.evaluation.completedAt = new Date().toISOString();
    }

    await this._writeEvaluation();
  }

  /**
   * Get the comparison graph (for visualization/export)
   * @returns {ComparisonGraph}
   */
  getComparisonGraph() {
    return this._comparisonGraph;
  }

  /**
   * Get current evaluation data
   * @returns {Promise<Object>} Current evaluation object
   */
  async getEvaluation() {
    return this.evaluation;
  }

  /**
   * Export evaluation data for analysis
   * Returns data in format suitable for Bradley-Terry model fitting
   * @returns {Promise<Object>} Exported evaluation data
   */
  async exportForAnalysis() {
    return {
      metadata: {
        evaluationId: this.evaluation.evaluationId,
        sessionId: this.evaluation.sessionId,
        evaluatorId: this.evaluation.evaluatorId,
        userPrompt: this.evaluation.userPrompt,
        createdAt: this.evaluation.createdAt,
        completedAt: this.evaluation.completedAt,
        status: this.evaluation.status
      },
      candidates: this.evaluation.candidates.map(c => ({
        id: c.candidateId,
        iteration: c.iteration,
        prompt: c.combined,
        originalScore: c.originalScore
      })),
      comparisons: this.evaluation.comparisons.map(c => ({
        candidateA: c.candidateA,
        candidateB: c.candidateB,
        winner: c.winner,
        responseTimeMs: c.responseTimeMs,
        timestamp: c.timestamp,
        inferred: c.inferred || false,
        // Include presentation order for position bias analysis
        presentationOrder: c.presentationOrder || 'original'
      })),
      progress: this.evaluation.progress
    };
  }

  /**
   * Load existing evaluation from disk
   * Rebuilds the comparison graph from persisted comparisons for transitive inference.
   * @param {string} outputDir - Base output directory
   * @param {string} sessionId - Session identifier
   * @param {string} evaluationId - Evaluation identifier
   * @returns {Promise<EvaluationTracker>} Loaded evaluation tracker
   */
  static async load(outputDir, sessionId, evaluationId) {
    const tracker = new EvaluationTracker({
      outputDir,
      sessionId,
      evaluationId
    });

    const evaluationPath = tracker._getEvaluationPath();
    const json = await fs.readFile(evaluationPath, 'utf8');
    tracker.evaluation = JSON.parse(json);

    // Rebuild comparison graph from persisted comparisons
    for (const comp of tracker.evaluation.comparisons) {
      if (comp.winner !== 'tie' && !comp.inferred) {
        tracker._comparisonGraph.recordComparison(
          comp.candidateA,
          comp.candidateB,
          comp.winner
        );
      }
    }

    // Ensure progress fields exist (backward compat with old evaluations)
    if (tracker.evaluation.progress.manualPairs === undefined) {
      const manual = tracker.evaluation.comparisons.filter(c => !c.inferred).length;
      const inferred = tracker.evaluation.comparisons.filter(c => c.inferred).length;
      tracker.evaluation.progress.manualPairs = manual;
      tracker.evaluation.progress.inferredPairs = inferred;
    }

    return tracker;
  }
}

module.exports = EvaluationTracker;
