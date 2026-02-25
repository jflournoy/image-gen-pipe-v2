import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateComparisons, buildAggregatedFeedback } from '../../src/utils/comparison-aggregator.js';

describe('comparison-aggregator', () => {

  describe('buildCandidateComparisons', () => {
    const directComparisons = [
      {
        idA: 'i0c0', idB: 'i0c1', winner: 'A',
        ranksA: { alignment: 4, aesthetics: 3, combined: 3.5 },
        ranksB: { alignment: 2, aesthetics: 2, combined: 2 },
        timestamp: '2026-02-23T10:00:00Z'
      },
      {
        idA: 'i0c0', idB: 'i0c2', winner: 'B',
        ranksA: { alignment: 2, aesthetics: 2, combined: 2 },
        ranksB: { alignment: 4, aesthetics: 4, combined: 4 },
        timestamp: '2026-02-23T10:01:00Z'
      },
      {
        idA: 'i0c1', idB: 'i0c2', winner: 'A',
        ranksA: { alignment: 3, aesthetics: 3, combined: 3 },
        ranksB: { alignment: 2, aesthetics: 1, combined: 1.5 },
        timestamp: '2026-02-23T10:02:00Z'
      },
      {
        idA: 'i0c2', idB: 'i0c3', winner: 'B',
        ranksA: { alignment: 1, aesthetics: 2, combined: 1.5 },
        ranksB: { alignment: 4, aesthetics: 4, combined: 4 },
        timestamp: '2026-02-23T10:03:00Z'
      }
    ];

    it('returns comparisons where candidate is idA and wins', () => {
      const result = buildCandidateComparisons('i0c0', directComparisons);
      const vsC1 = result.find(c => c.opponentId === 'i0c1');
      assert.ok(vsC1);
      assert.strictEqual(vsC1.result, 'win');
      assert.deepStrictEqual(vsC1.myRanks, { alignment: 4, aesthetics: 3, combined: 3.5 });
      assert.deepStrictEqual(vsC1.opponentRanks, { alignment: 2, aesthetics: 2, combined: 2 });
      assert.strictEqual(vsC1.timestamp, '2026-02-23T10:00:00Z');
    });

    it('returns comparisons where candidate is idA and loses', () => {
      const result = buildCandidateComparisons('i0c0', directComparisons);
      const vsC2 = result.find(c => c.opponentId === 'i0c2');
      assert.ok(vsC2);
      assert.strictEqual(vsC2.result, 'loss');
      assert.deepStrictEqual(vsC2.myRanks, { alignment: 2, aesthetics: 2, combined: 2 });
      assert.deepStrictEqual(vsC2.opponentRanks, { alignment: 4, aesthetics: 4, combined: 4 });
    });

    it('returns comparisons where candidate is idB and wins', () => {
      const result = buildCandidateComparisons('i0c3', directComparisons);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].opponentId, 'i0c2');
      assert.strictEqual(result[0].result, 'win');
      assert.deepStrictEqual(result[0].myRanks, { alignment: 4, aesthetics: 4, combined: 4 });
      assert.deepStrictEqual(result[0].opponentRanks, { alignment: 1, aesthetics: 2, combined: 1.5 });
    });

    it('returns comparisons where candidate is idB and loses', () => {
      const result = buildCandidateComparisons('i0c1', directComparisons);
      // i0c1 appears as idB in comparison[0] where winner is A → loss
      const vsC0 = result.find(c => c.opponentId === 'i0c0');
      assert.ok(vsC0);
      assert.strictEqual(vsC0.result, 'loss');
      assert.deepStrictEqual(vsC0.myRanks, { alignment: 2, aesthetics: 2, combined: 2 });
    });

    it('returns correct number of comparisons for a candidate in multiple matchups', () => {
      // i0c2 appears in 3 comparisons: vs i0c0, vs i0c1, vs i0c3
      const result = buildCandidateComparisons('i0c2', directComparisons);
      assert.strictEqual(result.length, 3);
    });

    it('returns empty array for candidate not in any comparison', () => {
      const result = buildCandidateComparisons('i0c99', directComparisons);
      assert.deepStrictEqual(result, []);
    });

    it('handles null ranks gracefully', () => {
      const comparisons = [{
        idA: 'i0c0', idB: 'i0c1', winner: 'A',
        ranksA: null, ranksB: null,
        timestamp: '2026-02-23T10:00:00Z'
      }];
      const result = buildCandidateComparisons('i0c0', comparisons);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].myRanks, null);
      assert.strictEqual(result[0].opponentRanks, null);
    });

    it('handles empty directComparisons array', () => {
      const result = buildCandidateComparisons('i0c0', []);
      assert.deepStrictEqual(result, []);
    });
  });

  describe('buildAggregatedFeedback', () => {
    it('returns aggregated feedback from ranking entry', () => {
      const rankingEntry = {
        rank: 1,
        strengths: ['good composition', 'vivid colors'],
        weaknesses: ['slightly blurry'],
        ranks: { alignment: 4, aesthetics: 3, combined: 3.5 },
        improvementSuggestion: 'Sharpen the edges'
      };
      const result = buildAggregatedFeedback(rankingEntry);
      assert.deepStrictEqual(result.strengths, ['good composition', 'vivid colors']);
      assert.deepStrictEqual(result.weaknesses, ['slightly blurry']);
      assert.strictEqual(result.improvementSuggestion, 'Sharpen the edges');
    });

    it('computes average ranks from candidateScores when provided', () => {
      const rankingEntry = {
        rank: 2,
        strengths: ['nice'],
        weaknesses: [],
        ranks: { alignment: 3, aesthetics: 2, combined: 2.5 },
        improvementSuggestion: null
      };
      const candidateScores = [
        { alignment: 4, aesthetics: 3, combined: 3.5 },
        { alignment: 2, aesthetics: 1, combined: 1.5 },
        { alignment: 3, aesthetics: 2, combined: 2.5 }
      ];
      const result = buildAggregatedFeedback(rankingEntry, candidateScores);
      assert.strictEqual(result.ranks.alignment, 3);
      assert.strictEqual(result.ranks.aesthetics, 2);
      assert.strictEqual(result.ranks.combined, 2.5);
    });

    it('falls back to ranking entry ranks when no candidateScores', () => {
      const rankingEntry = {
        rank: 1,
        strengths: [],
        weaknesses: [],
        ranks: { alignment: 4, aesthetics: 3, combined: 3.5 },
        improvementSuggestion: null
      };
      const result = buildAggregatedFeedback(rankingEntry, []);
      assert.deepStrictEqual(result.ranks, { alignment: 4, aesthetics: 3, combined: 3.5 });
    });

    it('returns null when rankingEntry is null', () => {
      const result = buildAggregatedFeedback(null);
      assert.strictEqual(result, null);
    });

    it('returns null when rankingEntry is undefined', () => {
      const result = buildAggregatedFeedback(undefined);
      assert.strictEqual(result, null);
    });

    it('handles missing fields gracefully', () => {
      const rankingEntry = { rank: 3 };
      const result = buildAggregatedFeedback(rankingEntry);
      assert.deepStrictEqual(result.strengths, []);
      assert.deepStrictEqual(result.weaknesses, []);
      assert.strictEqual(result.ranks, null);
      assert.strictEqual(result.improvementSuggestion, null);
    });

    it('deduplicates strengths and weaknesses', () => {
      const rankingEntry = {
        rank: 1,
        strengths: ['vivid colors', 'vivid colors', 'composition'],
        weaknesses: ['blurry', 'blurry'],
        ranks: null,
        improvementSuggestion: null
      };
      const result = buildAggregatedFeedback(rankingEntry);
      assert.deepStrictEqual(result.strengths, ['vivid colors', 'composition']);
      assert.deepStrictEqual(result.weaknesses, ['blurry']);
    });
  });
});
