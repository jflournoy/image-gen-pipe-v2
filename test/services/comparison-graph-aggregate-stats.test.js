/**
 * 🔴 TDD RED - ComparisonGraph Aggregate Statistics
 *
 * Problem: Rankings show misleading scores from only the final comparison
 * Solution: Track ALL comparison scores and provide aggregate statistics
 *
 * Example of broken behavior:
 *   i1c1: 5 wins, scores 1.00/1.00 (only from final comparison)
 *   i1c3: 2 wins, scores 1.00/1.00 (only from final comparison)
 *   → Makes them look equal when i1c1 won 2.5× more!
 *
 * Desired behavior:
 *   i1c1: 5/8 wins (62.5%), avg scores 1.12/1.25/1.16 (across ALL comparisons)
 *   i1c3: 2/5 wins (40.0%), avg scores 1.20/1.40/1.27 (across ALL comparisons)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// We need to test ComparisonGraph directly, so we'll extract it
// First, let's verify the current implementation DOESN'T have this feature
describe('ComparisonGraph Aggregate Statistics (TDD RED)', () => {
  let ComparisonGraph;
  let graph;

  beforeEach(() => {
    // Import the REAL ComparisonGraph (now exported for testing)
    const imageRankerModule = require('../../src/services/image-ranker.js');
    ComparisonGraph = imageRankerModule.ComparisonGraph;

    assert.ok(ComparisonGraph, 'ComparisonGraph must be exported from image-ranker.js');
    graph = new ComparisonGraph();
  });

  it('🔴 should track scores from multiple comparisons per candidate', () => {
    // Simulate 3 comparisons involving candidateId 'i1c1'
    // i1c1 vs i0c0: i1c1 wins with perfect scores
    graph.recordComparison('i1c1', 'i0c0', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 },
      { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    // i1c1 vs i0c2: i1c1 wins but with mixed scores
    graph.recordComparison('i1c1', 'i0c2', 'A',
      { alignment: 1, aesthetics: 2, combined: 1.33 },
      { alignment: 2, aesthetics: 1, combined: 1.67 }
    );

    // i1c1 vs i1c3: i1c1 wins with perfect scores again
    graph.recordComparison('i1c1', 'i1c3', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 },
      { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    // i1c1 should have 3 score records tracked
    assert.ok(graph.candidateScores, 'Should have candidateScores Map');
    const scores = graph.candidateScores.get('i1c1');
    assert.ok(scores, 'Should track scores for i1c1');
    assert.strictEqual(scores.length, 3, 'Should track all 3 comparisons');

    // Verify scores are stored correctly
    assert.strictEqual(scores[0].combined, 1.00);
    assert.strictEqual(scores[1].combined, 1.33);
    assert.strictEqual(scores[2].combined, 1.00);
  });

  it('🔴 should calculate average scores across all comparisons', () => {
    // i1c1 participates in 3 comparisons with varying performance
    graph.recordComparison('i1c1', 'i0c0', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 },
      { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    graph.recordComparison('i1c1', 'i0c2', 'A',
      { alignment: 1, aesthetics: 2, combined: 1.33 },
      { alignment: 2, aesthetics: 1, combined: 1.67 }
    );

    graph.recordComparison('i1c1', 'i1c3', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 },
      { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    const stats = graph.getAggregateStats('i1c1');

    // Average alignment: (1 + 1 + 1) / 3 = 1.00
    assert.strictEqual(stats.avgAlignment, 1.00, 'Should average alignment ranks');

    // Average aesthetics: (1 + 2 + 1) / 3 = 1.33...
    assert.ok(Math.abs(stats.avgAesthetics - 1.33) < 0.01, 'Should average aesthetics ranks');

    // Average combined: (1.00 + 1.33 + 1.00) / 3 = 1.11
    assert.ok(Math.abs(stats.avgCombined - 1.11) < 0.01, 'Should average combined scores');
  });

  it('🔴 should track total comparisons and win count separately', () => {
    // i1c1 wins 2 out of 3 comparisons
    graph.recordComparison('i1c1', 'i0c0', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 },
      { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    graph.recordComparison('i1c1', 'i0c2', 'B', // i1c1 LOSES this one
      { alignment: 2, aesthetics: 2, combined: 2.00 },
      { alignment: 1, aesthetics: 1, combined: 1.00 }
    );

    graph.recordComparison('i1c1', 'i1c3', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 },
      { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    const stats = graph.getAggregateStats('i1c1');

    assert.strictEqual(stats.totalComparisons, 3, 'Should track total comparisons');
    assert.strictEqual(stats.wins, 2, 'Should track wins');
    assert.strictEqual(stats.losses, 1, 'Should track losses');

    // Win rate: 2/3 = 66.67%
    const winRate = stats.wins / stats.totalComparisons;
    assert.ok(Math.abs(winRate - 0.6667) < 0.01, 'Should calculate win rate');
  });

  it('🔴 should handle candidates with no comparisons gracefully', () => {
    const stats = graph.getAggregateStats('nonexistent');
    assert.strictEqual(stats, null, 'Should return null for unknown candidate');
  });

  it('🔴 should track scores for losing candidates too', () => {
    // i0c0 loses to i1c1
    graph.recordComparison('i1c1', 'i0c0', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 },
      { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    // i0c0 should still have score tracked (even though it lost)
    const stats = graph.getAggregateStats('i0c0');
    assert.ok(stats, 'Should have stats for losing candidate');
    assert.strictEqual(stats.totalComparisons, 1);
    assert.strictEqual(stats.wins, 0);
    assert.strictEqual(stats.losses, 1);
    assert.strictEqual(stats.avgCombined, 2.00, 'Should track loser scores');
  });

  it('🔴 should provide meaningful comparison between candidates', () => {
    // Scenario from user's confusion:
    // i1c1: 5 wins with varying scores
    // i1c3: 2 wins with perfect scores

    // i1c1 comparisons (5 wins, varying quality)
    graph.recordComparison('i1c1', 'c1', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 }, { alignment: 2, aesthetics: 2, combined: 2.00 }
    );
    graph.recordComparison('i1c1', 'c2', 'A',
      { alignment: 1, aesthetics: 2, combined: 1.33 }, { alignment: 2, aesthetics: 1, combined: 1.67 }
    );
    graph.recordComparison('i1c1', 'c3', 'A',
      { alignment: 1, aesthetics: 2, combined: 1.33 }, { alignment: 2, aesthetics: 1, combined: 1.67 }
    );
    graph.recordComparison('i1c1', 'c4', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 }, { alignment: 2, aesthetics: 2, combined: 2.00 }
    );
    graph.recordComparison('i1c1', 'c5', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 }, { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    // i1c3 comparisons (2 wins, perfect scores)
    graph.recordComparison('i1c3', 'c6', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 }, { alignment: 2, aesthetics: 2, combined: 2.00 }
    );
    graph.recordComparison('i1c3', 'c7', 'A',
      { alignment: 1, aesthetics: 1, combined: 1.00 }, { alignment: 2, aesthetics: 2, combined: 2.00 }
    );

    const stats1c1 = graph.getAggregateStats('i1c1');
    const stats1c3 = graph.getAggregateStats('i1c3');

    // i1c1 should have MORE wins
    assert.strictEqual(stats1c1.wins, 5, 'i1c1 should have 5 wins');
    assert.strictEqual(stats1c3.wins, 2, 'i1c3 should have 2 wins');

    // But i1c3 might have BETTER average scores (all perfect)
    assert.strictEqual(stats1c3.avgCombined, 1.00, 'i1c3 perfect average');
    assert.ok(stats1c1.avgCombined > 1.00, 'i1c1 has some imperfect scores');

    // This shows: MORE wins ≠ BETTER scores
    // Users need BOTH metrics to understand performance
    assert.ok(
      stats1c1.wins > stats1c3.wins && stats1c1.avgCombined > stats1c3.avgCombined,
      'Should show quantity (wins) vs quality (avg scores) trade-off'
    );
  });
});
