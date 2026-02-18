/**
 * Ranking Agreement Metrics
 *
 * Pure functions for comparing two rankings and computing agreement metrics.
 * Used to compare human (HITL) rankings with AI (VLM) rankings.
 */

const { ComparisonGraph } = require('./comparison-graph.js');

/**
 * Compute Spearman rank correlation coefficient
 * Measures monotonic relationship between two rankings.
 * Returns value in [-1, 1]: 1 = perfect agreement, -1 = perfectly reversed, 0 = no correlation.
 *
 * @param {Array<string>} orderA - Ordered candidate IDs (rank 1 first)
 * @param {Array<string>} orderB - Ordered candidate IDs (rank 1 first)
 * @returns {number} Spearman's rho
 */
function computeSpearmanCorrelation(orderA, orderB) {
  const n = orderA.length;
  if (n <= 1) return 1;

  const rankA = new Map(orderA.map((id, idx) => [id, idx + 1]));
  const rankB = new Map(orderB.map((id, idx) => [id, idx + 1]));

  // Sum of squared rank differences
  let sumD2 = 0;
  for (const id of orderA) {
    const d = (rankA.get(id) || n) - (rankB.get(id) || n);
    sumD2 += d * d;
  }

  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

/**
 * Compute Kendall's tau rank correlation coefficient
 * Measures ordinal association between two rankings based on concordant/discordant pairs.
 * Returns value in [-1, 1]: 1 = same order, -1 = reversed, 0 = independent.
 *
 * @param {Array<string>} orderA - Ordered candidate IDs (rank 1 first)
 * @param {Array<string>} orderB - Ordered candidate IDs (rank 1 first)
 * @returns {number} Kendall's tau
 */
function computeKendallTau(orderA, orderB) {
  const n = orderA.length;
  if (n <= 1) return 1;

  const rankB = new Map(orderB.map((id, idx) => [id, idx]));

  let concordant = 0;
  let discordant = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bI = rankB.get(orderA[i]) ?? n;
      const bJ = rankB.get(orderA[j]) ?? n;
      if (bI < bJ) concordant++;
      else if (bI > bJ) discordant++;
    }
  }

  const total = n * (n - 1) / 2;
  if (total === 0) return 1;
  return (concordant - discordant) / total;
}

/**
 * Compute top-K overlap between two rankings
 * @param {Array<string>} orderA - Ordered candidate IDs (rank 1 first)
 * @param {Array<string>} orderB - Ordered candidate IDs (rank 1 first)
 * @param {number} k - Number of top items to compare
 * @returns {{count: number, fraction: number, items: Array<string>}}
 */
function computeTopKOverlap(orderA, orderB, k) {
  const topA = new Set(orderA.slice(0, k));
  const topB = new Set(orderB.slice(0, k));
  const overlap = [...topA].filter(id => topB.has(id));

  return {
    count: overlap.length,
    fraction: overlap.length / Math.max(k, 1),
    items: overlap
  };
}

/**
 * Derive rankings from human pairwise comparison data
 * Builds a ComparisonGraph from the evaluation comparisons and produces a ranking.
 *
 * @param {Object} evaluation - Evaluation data (from EvaluationTracker)
 * @returns {{rankings: Array, graph: ComparisonGraph}}
 */
function deriveRankingsFromComparisons(evaluation) {
  const graph = new ComparisonGraph();

  for (const comp of evaluation.comparisons) {
    if (comp.winner !== 'tie') {
      graph.recordComparison(comp.candidateA, comp.candidateB, comp.winner);
    }
  }

  const candidateIds = evaluation.candidates.map(c =>
    `i${c.iteration}c${c.candidateId}`
  );

  return {
    rankings: graph.getRankings(candidateIds),
    graph
  };
}

/**
 * Compute full agreement metrics between two rankings
 * @param {Array<Object>} aiRankings - AI rankings with candidateId and rank/globalRank
 * @param {Array<Object>} humanRankings - Human-derived rankings with candidateId and rank
 * @returns {Object|null} Agreement metrics or null if data insufficient
 */
function computeAgreementMetrics(aiRankings, humanRankings) {
  if (!aiRankings || !humanRankings || aiRankings.length === 0 || humanRankings.length === 0) {
    return null;
  }

  const aiOrder = aiRankings
    .sort((a, b) => (a.rank ?? a.globalRank) - (b.rank ?? b.globalRank))
    .map(r => r.candidateId);

  const humanOrder = humanRankings
    .sort((a, b) => a.rank - b.rank)
    .map(r => r.candidateId);

  return {
    spearmanRho: computeSpearmanCorrelation(aiOrder, humanOrder),
    kendallTau: computeKendallTau(aiOrder, humanOrder),
    topKOverlap: {
      top1: aiOrder[0] === humanOrder[0],
      top3: computeTopKOverlap(aiOrder, humanOrder, 3),
      top5: computeTopKOverlap(aiOrder, humanOrder, 5)
    },
    totalCandidates: aiOrder.length,
    positionDifferences: aiOrder.map((id, idx) => {
      const humanIdx = humanOrder.indexOf(id);
      return {
        candidateId: id,
        aiRank: idx + 1,
        humanRank: humanIdx >= 0 ? humanIdx + 1 : null,
        difference: humanIdx >= 0 ? (humanIdx + 1) - (idx + 1) : null
      };
    })
  };
}

module.exports = {
  computeSpearmanCorrelation,
  computeKendallTau,
  computeTopKOverlap,
  deriveRankingsFromComparisons,
  computeAgreementMetrics
};
