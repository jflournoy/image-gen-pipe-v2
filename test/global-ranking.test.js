/**
 * @file Global Ranking Tests
 * Tests for the computeGlobalRanks function that assigns global ranks across iterations
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const { computeGlobalRanks } = require('../src/orchestrator/beam-search.js');

// Helper to create mock candidates
function createCandidate(iteration, candidateId, rank) {
  return {
    metadata: { iteration, candidateId },
    ranking: { rank },
    combined: `prompt for i${iteration}c${candidateId}`
  };
}

describe('computeGlobalRanks', () => {
  describe('Iteration 0 (Initial Generation)', () => {
    test('should assign sequential global ranks 1 to N', () => {
      // 4 candidates ranked 1, 2, 3, 4
      const candidates = [
        createCandidate(0, 2, 1), // P2 - best
        createCandidate(0, 0, 2), // P0
        createCandidate(0, 3, 3), // P3
        createCandidate(0, 1, 4)  // P1 - worst
      ];

      const result = computeGlobalRanks(candidates, [], 4, 0);

      assert.strictEqual(result.length, 4, 'Should have 4 candidates');
      assert.strictEqual(result[0].globalRank, 1, 'First should be global rank 1');
      assert.strictEqual(result[1].globalRank, 2, 'Second should be global rank 2');
      assert.strictEqual(result[2].globalRank, 3, 'Third should be global rank 3');
      assert.strictEqual(result[3].globalRank, 4, 'Fourth should be global rank 4');
    });
  });

  describe('Iteration 1+ (With Parents)', () => {
    test('should assign sequential ranks when children beat all parents', () => {
      // Parents: P2 (rank 1 in iter 0), P0 (rank 2 in iter 0)
      const parents = [
        createCandidate(0, 2, 1),
        createCandidate(0, 0, 2)
      ];

      // Current iteration ranking: C3 > C1 > P2 > P0 > C2 > C0
      // (2 children beat both parents, 2 children lose to both parents)
      const rankedCandidates = [
        createCandidate(1, 3, 1), // C3 - best child
        createCandidate(1, 1, 2), // C1 - second best child
        createCandidate(0, 2, 3), // P2 - best parent
        createCandidate(0, 0, 4), // P0 - second parent
        createCandidate(1, 2, 5), // C2 - below parents
        createCandidate(1, 0, 6)  // C0 - below parents
      ];

      const floorRank = 4; // From iteration 0 with 4 candidates
      const result = computeGlobalRanks(rankedCandidates, parents, floorRank, 1);

      // Expected:
      // C3: global rank 1 (beat all parents)
      // C1: global rank 2 (beat all parents)
      // P2: global rank 3 (parent)
      // P0: global rank 4 (parent)
      // C2: global rank 4 (tied at floor - below worst parent)
      // C0: global rank 4 (tied at floor - below worst parent)

      assert.strictEqual(result[0].globalRank, 1, 'C3 should be global rank 1');
      assert.strictEqual(result[1].globalRank, 2, 'C1 should be global rank 2');
      assert.strictEqual(result[2].globalRank, 3, 'P2 should be global rank 3');
      assert.strictEqual(result[3].globalRank, 4, 'P0 should be global rank 4');
      assert.strictEqual(result[4].globalRank, floorRank, 'C2 should be tied at floor');
      assert.strictEqual(result[5].globalRank, floorRank, 'C0 should be tied at floor');

      // Check for floor note
      assert.strictEqual(result[4].globalRankNote, 'tied_at_floor');
      assert.strictEqual(result[5].globalRankNote, 'tied_at_floor');
    });

    test('should handle case where all children beat all parents', () => {
      const parents = [
        createCandidate(0, 0, 1),
        createCandidate(0, 1, 2)
      ];

      // All children beat both parents
      const rankedCandidates = [
        createCandidate(1, 0, 1), // C0 - best
        createCandidate(1, 1, 2), // C1
        createCandidate(1, 2, 3), // C2
        createCandidate(1, 3, 4), // C3
        createCandidate(0, 0, 5), // P0 - parent
        createCandidate(0, 1, 6)  // P1 - parent
      ];

      const result = computeGlobalRanks(rankedCandidates, parents, 4, 1);

      // All should get sequential ranks (no one below worst parent)
      assert.strictEqual(result[0].globalRank, 1);
      assert.strictEqual(result[1].globalRank, 2);
      assert.strictEqual(result[2].globalRank, 3);
      assert.strictEqual(result[3].globalRank, 4);
      assert.strictEqual(result[4].globalRank, 5);
      assert.strictEqual(result[5].globalRank, 6);

      // No floor notes
      assert.strictEqual(result[4].globalRankNote, undefined);
      assert.strictEqual(result[5].globalRankNote, undefined);
    });

    test('should handle case where one child beats one parent but loses to the other', () => {
      const parents = [
        createCandidate(0, 0, 1), // P0 - was rank 1
        createCandidate(0, 1, 2)  // P1 - was rank 2
      ];

      // C0 beats P0, P1 beats C1, C1 loses to P1
      const rankedCandidates = [
        createCandidate(1, 0, 1), // C0 - beat P0
        createCandidate(0, 0, 2), // P0
        createCandidate(0, 1, 3), // P1 - worst parent
        createCandidate(1, 1, 4)  // C1 - below P1
      ];

      const result = computeGlobalRanks(rankedCandidates, parents, 4, 1);

      // C0: rank 1 (above all parents)
      // P0: rank 2 (parent)
      // P1: rank 3 (worst parent)
      // C1: rank 4 (tied at floor - below worst parent)
      assert.strictEqual(result[0].globalRank, 1);
      assert.strictEqual(result[1].globalRank, 2);
      assert.strictEqual(result[2].globalRank, 3);
      assert.strictEqual(result[3].globalRank, 4);
      assert.strictEqual(result[3].globalRankNote, 'tied_at_floor');
    });
  });

  describe('Edge Cases', () => {
    test('should handle single candidate', () => {
      const candidates = [createCandidate(0, 0, 1)];
      const result = computeGlobalRanks(candidates, [], 4, 0);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].globalRank, 1);
    });

    test('should handle no parents found (shouldn\'t happen in practice)', () => {
      // If somehow no parents are in the ranking, treat all as above parents
      const parents = [
        createCandidate(0, 0, 1),
        createCandidate(0, 1, 2)
      ];

      // Candidates without parents in the list
      const rankedCandidates = [
        createCandidate(1, 0, 1),
        createCandidate(1, 1, 2),
        createCandidate(1, 2, 3)
      ];

      const result = computeGlobalRanks(rankedCandidates, parents, 4, 1);

      // All should get sequential ranks since no parents found
      assert.strictEqual(result[0].globalRank, 1);
      assert.strictEqual(result[1].globalRank, 2);
      assert.strictEqual(result[2].globalRank, 3);
    });
  });
});

describe('Global Ranking Integration Example', () => {
  test('should match the example from discussion', () => {
    // Gen1: P2 > P1 > P3 > P4 (floor = 4)
    // Gen2: C3 > C4 > C1 > P2 > P1 > C2
    // Expected: C3(1), C4(2), C1(3), P2(4), P1(5), C2(tied at 4)

    // First, gen1 ranking
    const gen1Candidates = [
      createCandidate(0, 1, 1), // P2 (using candidateId 1 for P2)
      createCandidate(0, 0, 2), // P1 (using candidateId 0 for P1)
      createCandidate(0, 2, 3), // P3
      createCandidate(0, 3, 4)  // P4
    ];
    const gen1Result = computeGlobalRanks(gen1Candidates, [], 4, 0);

    assert.strictEqual(gen1Result[0].globalRank, 1, 'P2 should be rank 1');
    assert.strictEqual(gen1Result[1].globalRank, 2, 'P1 should be rank 2');
    assert.strictEqual(gen1Result[2].globalRank, 3, 'P3 should be rank 3');
    assert.strictEqual(gen1Result[3].globalRank, 4, 'P4 should be rank 4');

    // Then gen2 ranking with P2 and P1 as parents
    const parents = [
      createCandidate(0, 1, 1), // P2
      createCandidate(0, 0, 2)  // P1
    ];

    const gen2Candidates = [
      createCandidate(1, 2, 1), // C3
      createCandidate(1, 3, 2), // C4
      createCandidate(1, 0, 3), // C1
      createCandidate(0, 1, 4), // P2
      createCandidate(0, 0, 5), // P1
      createCandidate(1, 1, 6)  // C2
    ];

    const gen2Result = computeGlobalRanks(gen2Candidates, parents, 4, 1);

    // C3, C4, C1 beat all parents -> ranks 1, 2, 3
    assert.strictEqual(gen2Result[0].globalRank, 1, 'C3 should be rank 1');
    assert.strictEqual(gen2Result[1].globalRank, 2, 'C4 should be rank 2');
    assert.strictEqual(gen2Result[2].globalRank, 3, 'C1 should be rank 3');

    // P2, P1 are parents -> ranks 4, 5
    assert.strictEqual(gen2Result[3].globalRank, 4, 'P2 should be rank 4');
    assert.strictEqual(gen2Result[4].globalRank, 5, 'P1 should be rank 5');

    // C2 is below P1 (worst parent) -> tied at floor (4)
    assert.strictEqual(gen2Result[5].globalRank, 4, 'C2 should be tied at floor rank 4');
    assert.strictEqual(gen2Result[5].globalRankNote, 'tied_at_floor', 'C2 should have floor note');
  });
});
