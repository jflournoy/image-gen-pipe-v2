/**
 * TDD RED Phase: Beam Search Orchestrator Tests
 *
 * Tests for the streaming parallel beam search orchestrator.
 * Reference: docs/streaming-parallel-architecture.md
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');

describe('Beam Search Orchestrator', () => {
  describe('rankAndSelect', () => {
    test('should rank candidates by totalScore descending', async () => {
      const { rankAndSelect } = require('../../src/orchestrator/beam-search.js');

      const candidates = [
        { id: 1, totalScore: 75 },
        { id: 2, totalScore: 90 },
        { id: 3, totalScore: 60 }
      ];

      const result = rankAndSelect(candidates, 3);

      assert.strictEqual(result[0].id, 2, 'First should be highest score (90)');
      assert.strictEqual(result[1].id, 1, 'Second should be middle score (75)');
      assert.strictEqual(result[2].id, 3, 'Third should be lowest score (60)');
    });

    test('should keep only top M candidates', async () => {
      const { rankAndSelect } = require('../../src/orchestrator/beam-search.js');

      const candidates = [
        { id: 1, totalScore: 75 },
        { id: 2, totalScore: 90 },
        { id: 3, totalScore: 60 },
        { id: 4, totalScore: 85 },
        { id: 5, totalScore: 70 }
      ];

      const result = rankAndSelect(candidates, 3);

      assert.strictEqual(result.length, 3, 'Should keep only 3 candidates');
      assert.strictEqual(result[0].totalScore, 90, 'Top candidate score');
      assert.strictEqual(result[1].totalScore, 85, 'Second candidate score');
      assert.strictEqual(result[2].totalScore, 75, 'Third candidate score');
    });

    test('should not mutate original candidates array', async () => {
      const { rankAndSelect } = require('../../src/orchestrator/beam-search.js');

      const candidates = [
        { id: 1, totalScore: 75 },
        { id: 2, totalScore: 90 }
      ];

      const original = [...candidates];
      rankAndSelect(candidates, 2);

      assert.deepStrictEqual(candidates, original, 'Original array should be unchanged');
    });

    test('should handle keepTop larger than candidate count', async () => {
      const { rankAndSelect } = require('../../src/orchestrator/beam-search.js');

      const candidates = [
        { id: 1, totalScore: 75 },
        { id: 2, totalScore: 90 }
      ];

      const result = rankAndSelect(candidates, 10);

      assert.strictEqual(result.length, 2, 'Should return all candidates if keepTop > count');
    });
  });

  describe('calculateTotalScore', () => {
    test('should calculate weighted score with default alpha=0.7', async () => {
      const { calculateTotalScore } = require('../../src/orchestrator/beam-search.js');

      const alignmentScore = 80; // 0-100
      const aestheticScore = 7;  // 0-10

      const result = calculateTotalScore(alignmentScore, aestheticScore);

      // Expected: 0.7 * 80 + 0.3 * (7 * 10) = 56 + 21 = 77
      assert.strictEqual(result, 77, 'Should calculate weighted score correctly');
    });

    test('should calculate weighted score with custom alpha', async () => {
      const { calculateTotalScore } = require('../../src/orchestrator/beam-search.js');

      const alignmentScore = 80;
      const aestheticScore = 8;
      const alpha = 0.5; // Equal weighting

      const result = calculateTotalScore(alignmentScore, aestheticScore, alpha);

      // Expected: 0.5 * 80 + 0.5 * (8 * 10) = 40 + 40 = 80
      assert.strictEqual(result, 80, 'Should use custom alpha');
    });

    test('should normalize aesthetic score from 0-10 to 0-100 scale', async () => {
      const { calculateTotalScore } = require('../../src/orchestrator/beam-search.js');

      const alignmentScore = 0;
      const aestheticScore = 10; // Max aesthetic
      const alpha = 0; // Only aesthetic matters

      const result = calculateTotalScore(alignmentScore, aestheticScore, alpha);

      // Expected: 0 * 0 + 1.0 * (10 * 10) = 100
      assert.strictEqual(result, 100, 'Should normalize aesthetic to 100 scale');
    });

    test('should handle edge cases', async () => {
      const { calculateTotalScore } = require('../../src/orchestrator/beam-search.js');

      // All zeros
      assert.strictEqual(
        calculateTotalScore(0, 0),
        0,
        'Should handle all zeros'
      );

      // Max values
      assert.strictEqual(
        calculateTotalScore(100, 10),
        100,
        'Should handle max values'
      );

      // Alpha = 1 (only alignment)
      assert.strictEqual(
        calculateTotalScore(80, 5, 1.0),
        80,
        'Should handle alpha=1 (alignment only)'
      );

      // Alpha = 0 (only aesthetic)
      assert.strictEqual(
        calculateTotalScore(80, 5, 0.0),
        50,
        'Should handle alpha=0 (aesthetic only)'
      );
    });
  });
});
