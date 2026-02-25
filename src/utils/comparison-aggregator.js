/**
 * Pure utility functions for building per-candidate comparison data
 * from ComparisonGraph directComparisons and ranking results.
 */

/**
 * Build per-candidate comparison records from the comparison graph.
 * Filters directComparisons for entries involving the given candidate
 * and transforms them into candidate-centric records.
 *
 * @param {string} candidateId - Global candidate ID (e.g. "i0c1")
 * @param {Array} directComparisons - From ComparisonGraph.toJSON().directComparisons
 * @returns {Array<{opponentId: string, result: 'win'|'loss', myRanks: object|null, opponentRanks: object|null, timestamp: string}>}
 */
export function buildCandidateComparisons(candidateId, directComparisons) {
  return directComparisons
    .filter(c => c.idA === candidateId || c.idB === candidateId)
    .map(c => {
      const isA = c.idA === candidateId;
      const iWon = (isA && c.winner === 'A') || (!isA && c.winner === 'B');
      return {
        opponentId: isA ? c.idB : c.idA,
        result: iWon ? 'win' : 'loss',
        myRanks: isA ? (c.ranksA ?? null) : (c.ranksB ?? null),
        opponentRanks: isA ? (c.ranksB ?? null) : (c.ranksA ?? null),
        timestamp: c.timestamp
      };
    });
}

/**
 * Build aggregated feedback for a candidate from their ranking entry
 * and optionally from per-comparison scores in the graph.
 *
 * @param {object|null} rankingEntry - Ranking result for this candidate (from rankAndSelectComparative)
 * @param {Array<{alignment: number, aesthetics: number, combined: number}>} [candidateScores=[]] - Per-comparison scores from ComparisonGraph
 * @returns {object|null} Aggregated feedback or null if no ranking data
 */
export function buildAggregatedFeedback(rankingEntry, candidateScores = []) {
  if (!rankingEntry) return null;

  const strengths = [...new Set(rankingEntry.strengths || [])];
  const weaknesses = [...new Set(rankingEntry.weaknesses || [])];

  const ranks = candidateScores.length > 0
    ? {
      alignment: avg(candidateScores.map(s => s.alignment)),
      aesthetics: avg(candidateScores.map(s => s.aesthetics)),
      combined: avg(candidateScores.map(s => s.combined))
    }
    : rankingEntry.ranks || null;

  return {
    strengths,
    weaknesses,
    ranks,
    improvementSuggestion: rankingEntry.improvementSuggestion || null
  };
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
