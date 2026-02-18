/**
 * ComparisonGraph - Shared module for transitive pairwise comparison tracking
 *
 * Tracks A > B relationships and infers A > C when A > B and B > C.
 * Used by both AI ranking (ImageRanker, LocalVLMProvider) and
 * human evaluation (EvaluationTracker) for transitive inference.
 *
 * Supports serialization for persistence and visualization data export.
 */

class ComparisonGraph {
  constructor() {
    // Map: candidateId → Set of candidateIds it beats
    this.beats = new Map();
    // Map: candidateId → Set of candidateIds it loses to
    this.losesTo = new Map();
    // Map: candidateId → Array of { alignment, aesthetics, combined } scores across all comparisons
    this.candidateScores = new Map();
    // Ordered list of direct comparisons (for persistence and visualization)
    this.directComparisons = [];
  }

  /**
   * Record a comparison result
   * @param {string|number} idA - First candidate ID
   * @param {string|number} idB - Second candidate ID
   * @param {string} winner - 'A' or 'B'
   * @param {Object} [ranksA] - Optional ranks for candidate A: { alignment, aesthetics, combined }
   * @param {Object} [ranksB] - Optional ranks for candidate B: { alignment, aesthetics, combined }
   */
  recordComparison(idA, idB, winner, ranksA = null, ranksB = null) {
    const winnerId = winner === 'A' ? idA : idB;
    const loserId = winner === 'A' ? idB : idA;

    // Track direct comparison for persistence/visualization
    this.directComparisons.push({
      idA,
      idB,
      winner,
      ranksA,
      ranksB,
      timestamp: new Date().toISOString()
    });

    // Direct relationship
    if (!this.beats.has(winnerId)) this.beats.set(winnerId, new Set());
    if (!this.losesTo.has(loserId)) this.losesTo.set(loserId, new Set());

    this.beats.get(winnerId).add(loserId);
    this.losesTo.get(loserId).add(winnerId);

    // Store scores if provided (for aggregate statistics)
    if (ranksA) {
      if (!this.candidateScores.has(idA)) this.candidateScores.set(idA, []);
      this.candidateScores.get(idA).push(ranksA);
    }
    if (ranksB) {
      if (!this.candidateScores.has(idB)) this.candidateScores.set(idB, []);
      this.candidateScores.get(idB).push(ranksB);
    }

    // Transitive closure: if A > B and B > C, then A > C
    this._propagateTransitivity(winnerId, loserId);
  }

  /**
   * Propagate transitive relationships after a new comparison
   * @private
   * @param {string|number} winnerId - Winner of comparison
   * @param {string|number} loserId - Loser of comparison
   */
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

  /**
   * Check if we can infer winner from existing comparisons
   * @param {string|number} idA - First candidate ID
   * @param {string|number} idB - Second candidate ID
   * @returns {{winner: string|number, inferred: boolean} | null}
   */
  canInferWinner(idA, idB) {
    if (this.beats.has(idA) && this.beats.get(idA).has(idB)) {
      return { winner: idA, inferred: true };
    }

    if (this.beats.has(idB) && this.beats.get(idB).has(idA)) {
      return { winner: idB, inferred: true };
    }

    return null;
  }

  /**
   * Get aggregate statistics for a candidate across all comparisons
   * @param {string|number} candidateId - Candidate ID
   * @returns {{avgAlignment: number, avgAesthetics: number, avgCombined: number, totalComparisons: number, wins: number, losses: number} | null}
   */
  getAggregateStats(candidateId) {
    const scores = this.candidateScores.get(candidateId);
    if (!scores || scores.length === 0) return null;

    const avg = (arr) => arr.reduce((sum, val) => sum + val, 0) / arr.length;

    return {
      avgAlignment: avg(scores.map(s => s.alignment)),
      avgAesthetics: avg(scores.map(s => s.aesthetics)),
      avgCombined: avg(scores.map(s => s.combined)),
      totalComparisons: scores.length,
      wins: this.beats.get(candidateId)?.size || 0,
      losses: this.losesTo.get(candidateId)?.size || 0
    };
  }

  /**
   * Derive rankings from win counts
   * @param {Array<string|number>} candidateIds - All candidate IDs to rank
   * @returns {Array<{candidateId: string|number, rank: number, wins: number, losses: number, aggregateStats: Object|null}>}
   */
  getRankings(candidateIds) {
    return candidateIds
      .map(id => ({
        candidateId: id,
        wins: this.beats.get(id)?.size || 0,
        losses: this.losesTo.get(id)?.size || 0,
        aggregateStats: this.getAggregateStats(id)
      }))
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
  }

  /**
   * Get all edges for DAG visualization
   * Returns both direct comparisons and transitive inferences as edges
   * @returns {Array<{from: string|number, to: string|number, type: 'direct'|'inferred'}>}
   */
  getEdges() {
    // Build set of direct edges for fast lookup
    const directEdges = new Set();
    for (const comp of this.directComparisons) {
      const winnerId = comp.winner === 'A' ? comp.idA : comp.idB;
      const loserId = comp.winner === 'A' ? comp.idB : comp.idA;
      directEdges.add(`${winnerId}->${loserId}`);
    }

    // Collect all edges from the beats map
    const edges = [];
    for (const [winnerId, losers] of this.beats) {
      for (const loserId of losers) {
        const edgeKey = `${winnerId}->${loserId}`;
        edges.push({
          from: winnerId,
          to: loserId,
          type: directEdges.has(edgeKey) ? 'direct' : 'inferred'
        });
      }
    }

    return edges;
  }

  /**
   * Get adjacency matrix for matrix visualization
   * @param {Array<string|number>} candidateIds - Ordered candidate IDs (determines row/column order)
   * @returns {Array<Array<{result: 'win'|'loss'|'tie'|'unknown'|'self', type: 'direct'|'inferred'|null}>>}
   */
  getAdjacencyMatrix(candidateIds) {
    // Build set of direct edges for fast lookup
    const directEdges = new Set();
    for (const comp of this.directComparisons) {
      const winnerId = comp.winner === 'A' ? comp.idA : comp.idB;
      const loserId = comp.winner === 'A' ? comp.idB : comp.idA;
      directEdges.add(`${winnerId}->${loserId}`);
    }

    return candidateIds.map((rowId, i) =>
      candidateIds.map((colId, j) => {
        if (i === j) return { result: 'self', type: null };

        const rowBeatsCol = this.beats.get(rowId)?.has(colId);
        const colBeatsRow = this.beats.get(colId)?.has(rowId);

        if (rowBeatsCol) {
          const isDirect = directEdges.has(`${rowId}->${colId}`);
          return { result: 'win', type: isDirect ? 'direct' : 'inferred' };
        }
        if (colBeatsRow) {
          const isDirect = directEdges.has(`${colId}->${rowId}`);
          return { result: 'loss', type: isDirect ? 'direct' : 'inferred' };
        }

        return { result: 'unknown', type: null };
      })
    );
  }

  /**
   * Serialize for persistence
   * Only stores directComparisons — beats/losesTo are derived via replay
   * @returns {Object}
   */
  toJSON() {
    return {
      directComparisons: this.directComparisons
    };
  }

  /**
   * Reconstruct graph from persisted data
   * @param {Object} data - Serialized graph data from toJSON()
   * @returns {ComparisonGraph}
   */
  static fromJSON(data) {
    const graph = new ComparisonGraph();
    for (const comp of (data.directComparisons || [])) {
      graph.recordComparison(comp.idA, comp.idB, comp.winner, comp.ranksA, comp.ranksB);
    }
    return graph;
  }
}

module.exports = { ComparisonGraph };
