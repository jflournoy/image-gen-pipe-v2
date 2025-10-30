/**
 * TDD GREEN Phase: Beam Search Orchestrator
 *
 * Implements streaming parallel beam search for image generation.
 * Reference: docs/streaming-parallel-architecture.md
 */

/**
 * Rank candidates by total score and select top M
 * @param {Array<Object>} candidates - Candidates with totalScore property
 * @param {number} keepTop - Number of top candidates to keep
 * @returns {Array<Object>} Top M candidates sorted by score (descending)
 */
function rankAndSelect(candidates, keepTop) {
  // Create a copy to avoid mutating original array
  const sorted = [...candidates].sort((a, b) => b.totalScore - a.totalScore);

  // Return top M candidates (or all if keepTop > candidate count)
  return sorted.slice(0, keepTop);
}

/**
 * Calculate total score from alignment and aesthetic scores
 * @param {number} alignmentScore - Alignment score (0-100)
 * @param {number} aestheticScore - Aesthetic score (0-10)
 * @param {number} alpha - Weight for alignment (default 0.7). Range 0-1.
 * @returns {number} Total score (0-100)
 */
function calculateTotalScore(alignmentScore, aestheticScore, alpha = 0.7) {
  // Normalize aesthetic score from 0-10 scale to 0-100 scale
  const normalizedAesthetic = aestheticScore * 10;

  // Weighted combination: alpha * alignment + (1-alpha) * aesthetic
  const totalScore = alpha * alignmentScore + (1 - alpha) * normalizedAesthetic;

  return totalScore;
}

module.exports = {
  rankAndSelect,
  calculateTotalScore
};
