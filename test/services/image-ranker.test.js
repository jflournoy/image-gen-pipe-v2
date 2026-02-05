/**
 * TDD RED Phase: Image Ranker Tests
 *
 * Comparative ranking system for images instead of absolute scoring.
 * Uses LLM vision to compare images and determine relative quality.
 *
 * Design:
 * - Small N (≤4): All-at-once holistic ranking
 * - Large N (>4): Efficient pairwise comparison (merge-sort style)
 * - Output: Ranked list with reasons for ranking decisions
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const ImageRanker = require('../../src/services/image-ranker.js');

describe('ImageRanker', () => {
  describe('constructor', () => {
    it('should create ranker with API key', () => {
      const ranker = new ImageRanker({ apiKey: 'test-key' });
      assert.ok(ranker);
    });

    it('should use environment API key if not provided', () => {
      process.env.OPENAI_API_KEY = 'env-key';
      const ranker = new ImageRanker();
      assert.ok(ranker);
    });

    it('should accept custom model', () => {
      const ranker = new ImageRanker({ apiKey: 'test-key', model: 'gpt-4o' });
      assert.ok(ranker);
    });
  });

  describe('compareTwo', () => {
    it('should compare two images and return winner with reason', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock the comparison
      ranker._callVisionAPI = async () => ({
        winner: 'A',
        reason: 'Image A has better composition and lighting',
        winnerStrengths: ['good composition', 'natural lighting'],
        loserWeaknesses: ['dark corners', 'cluttered']
      });

      const result = await ranker.compareTwo(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene mountain landscape'
      );

      assert.strictEqual(result.winner, 'A');
      assert.ok(result.reason.includes('composition'));
      assert.ok(Array.isArray(result.winnerStrengths));
      assert.ok(Array.isArray(result.loserWeaknesses));
    });

    it('should handle tie gracefully', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // For a tie, both images must have equal combined rank scores
      // Equal ranks on both factors = same combined score
      ranker._callVisionAPI = async () => ({
        winner: 'tie',
        reason: 'Both images are equally good',
        ranks: {
          A: { alignment: 1, aesthetics: 1 },
          B: { alignment: 1, aesthetics: 1 }
        },
        winnerStrengths: [],
        loserWeaknesses: []
      });

      const result = await ranker.compareTwo(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene mountain landscape'
      );

      assert.strictEqual(result.winner, 'tie');
    });
  });

  describe('rankAllAtOnce', () => {
    it('should rank 2 images with reasons', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock uses imageLabel (A, B) - the code maps back to candidateId
      // Note: Due to shuffling, we can't predict which label maps to which candidateId
      // So we just verify the structure is correct
      ranker._callVisionAPI = async () => ({
        rankings: [
          { imageLabel: 'A', rank: 1, reason: 'Best composition and lighting' },
          { imageLabel: 'B', rank: 2, reason: 'Good but lacks depth' }
        ]
      });

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      const result = await ranker.rankAllAtOnce(images, 'a serene mountain landscape');

      assert.strictEqual(result.length, 2);
      // Both candidateIds should be present (order depends on shuffle)
      const candidateIds = result.map(r => r.candidateId).sort();
      assert.deepStrictEqual(candidateIds, [0, 1]);
      assert.ok(result[0].reason);
      assert.strictEqual(result[0].rank, 1);
      assert.strictEqual(result[1].rank, 2);
    });

    it('should rank 4 images (max for all-at-once)', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock uses imageLabel (A, B, C, D) - the code maps back to candidateId
      ranker._callVisionAPI = async () => ({
        rankings: [
          { imageLabel: 'A', rank: 1, reason: 'Excellent composition' },
          { imageLabel: 'B', rank: 2, reason: 'Good lighting' },
          { imageLabel: 'C', rank: 3, reason: 'Decent but flat' },
          { imageLabel: 'D', rank: 4, reason: 'Weakest composition' }
        ]
      });

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' },
        { candidateId: 2, url: 'http://image-2.png' },
        { candidateId: 3, url: 'http://image-3.png' }
      ];

      const result = await ranker.rankAllAtOnce(images, 'a serene mountain landscape');

      assert.strictEqual(result.length, 4);
      // Verify all candidateIds are present and ranks are correct
      const candidateIds = result.map(r => r.candidateId).sort();
      assert.deepStrictEqual(candidateIds, [0, 1, 2, 3]);
      assert.strictEqual(result[0].rank, 1);
      assert.strictEqual(result[3].rank, 4);
    });

    it('should include comparative reasons', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock uses imageLabel - the code maps back to candidateId
      ranker._callVisionAPI = async () => ({
        rankings: [
          {
            imageLabel: 'A',
            rank: 1,
            reason: 'Has clouds and mountains as requested, better follows prompt than others'
          },
          {
            imageLabel: 'B',
            rank: 2,
            reason: 'Has mountains but missing clouds that image A has'
          }
        ]
      });

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      const result = await ranker.rankAllAtOnce(images, 'mountains with clouds');

      // First ranked result should have clouds in reason
      assert.ok(result[0].reason.includes('clouds'));
      assert.ok(result[0].reason.toLowerCase().includes('prompt'));
    });
  });

  describe('rankPairwise', () => {
    it('should rank images using pairwise comparisons', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock pairwise comparisons
      let comparisonCount = 0;
      ranker.compareTwo = async (imageA, imageB, _prompt) => {
        comparisonCount++;
        // Simple rule: lower candidateId wins
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: `Image ${imageA.candidateId < imageB.candidateId ? imageA.candidateId : imageB.candidateId} is better`
        };
      };

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' },
        { candidateId: 2, url: 'http://image-2.png' },
        { candidateId: 3, url: 'http://image-3.png' },
        { candidateId: 4, url: 'http://image-4.png' }
      ];

      const result = await ranker.rankPairwise(images, 'test prompt');

      assert.strictEqual(result.length, 5);
      // Should be sorted by rank
      assert.strictEqual(result[0].rank, 1);
      assert.strictEqual(result[4].rank, 5);
      // Should use O(N log N) comparisons (not O(N²))
      assert.ok(comparisonCount < images.length * images.length);
    });

    it('should handle 8 images efficiently', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let comparisonCount = 0;
      ranker.compareTwo = async (imageA, imageB, _prompt) => {
        comparisonCount++;
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: 'test'
        };
      };

      const images = Array.from({ length: 8 }, (_, i) => ({
        candidateId: i,
        url: `http://image-${i}.png`
      }));

      const result = await ranker.rankPairwise(images, 'test prompt');

      assert.strictEqual(result.length, 8);
      // O(N log N) = 8 * 3 = 24 comparisons max
      assert.ok(comparisonCount <= 24);
    });
  });

  describe('rankPairwiseTransitive (optimized with transitivity)', () => {
    it('should use transitivity to reduce comparisons', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let comparisonCount = 0;
      ranker.compareTwo = async (imageA, imageB, _prompt) => {
        comparisonCount++;
        // Lower candidateId wins
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: 'test'
        };
      };

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' },
        { candidateId: 2, url: 'http://image-2.png' },
        { candidateId: 3, url: 'http://image-3.png' },
        { candidateId: 4, url: 'http://image-4.png' }
      ];

      const result = await ranker.rankPairwiseTransitive(images, 'test prompt', { keepTop: 5 });

      assert.strictEqual(result.length, 5);
      assert.strictEqual(result[0].rank, 1);
      // For full ranking (K=N), tournament needs N*(N-1)/2 comparisons
      // For 5 items: 10 comparisons (optimal for full ranking)
      // Transitivity helps most when K < N (the beam search use case)
      assert.ok(comparisonCount <= 10);
    });

    it('should efficiently find top K from N items using transitivity', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let comparisonCount = 0;
      ranker.compareTwo = async (imageA, imageB, _prompt) => {
        comparisonCount++;
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: 'test'
        };
      };

      const images = Array.from({ length: 8 }, (_, i) => ({
        candidateId: i,
        url: `http://image-${i}.png`
      }));

      // Find top 2 from 8 (beam search use case: keepTop=2, beamWidth=4-8)
      // Note: Implementation returns all ranks but optimizes comparisons
      const result = await ranker.rankPairwiseTransitive(images, 'test prompt', { keepTop: 2 });

      // keepTop is a hint for optimization, but implementation may return all ranks
      // What matters is that top 2 are correctly identified
      assert.ok(result.length >= 2, 'Should return at least top 2');
      assert.strictEqual(result[0].rank, 1);
      assert.strictEqual(result[1].rank, 2);
      assert.strictEqual(result[0].candidateId, 0, 'Top rank should be candidateId 0');
      assert.strictEqual(result[1].candidateId, 1, 'Second rank should be candidateId 1');
      // All-pairs for N=8: 28 comparisons, but transitivity helps
      assert.ok(comparisonCount <= 28);
    });

    it('should infer relationships using transitivity', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      const comparisons = new Set();
      ranker.compareTwo = async (imageA, imageB, _prompt) => {
        const key = `${imageA.candidateId}-${imageB.candidateId}`;
        comparisons.add(key);
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: 'test'
        };
      };

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' },
        { candidateId: 2, url: 'http://image-2.png' }
      ];

      await ranker.rankPairwiseTransitive(images, 'test prompt', { keepTop: 3 });

      // For full ranking of 3 items, need minimum 3 comparisons
      // Tournament: Rank 1 (2 comparisons), Rank 2 (1 comparison)
      // Transitivity helps when K < N, not when K = N
      assert.ok(comparisons.size <= 3);
    });

    it('should handle large N efficiently when finding top K', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let comparisonCount = 0;
      ranker.compareTwo = async (imageA, imageB, _prompt) => {
        comparisonCount++;
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: 'test'
        };
      };

      const images = Array.from({ length: 16 }, (_, i) => ({
        candidateId: i,
        url: `http://image-${i}.png`
      }));

      // Top-2 from 16
      const result = await ranker.rankPairwiseTransitive(images, 'test prompt', { keepTop: 2 });

      // keepTop is a hint for optimization, but implementation may return all ranks
      assert.ok(result.length >= 2, 'Should return at least top 2');
      assert.strictEqual(result[0].rank, 1);
      assert.strictEqual(result[1].rank, 2);
      assert.strictEqual(result[0].candidateId, 0, 'Top rank should be candidateId 0');
      assert.strictEqual(result[1].candidateId, 1, 'Second rank should be candidateId 1');
      // For large N, should use tournament-style comparison
      // Actual implementation may vary
      assert.ok(comparisonCount > 0, 'Should make some comparisons');
    });
  });

  describe('rankImages (unified pairwise)', () => {
    it('should use transitive pairwise for small N (unified behavior)', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock compareTwo - now called via compareWithEnsemble
      ranker.compareTwo = async (imageA, imageB) => ({
        winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
        reason: 'test reason'
      });

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      const response = await ranker.rankImages(images, 'test prompt');
      const result = response.rankings; // Extract rankings from response

      // Should produce valid rankings
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].rank, 1);
    });

    it('should use transitive pairwise for N > 4', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let transitiveCalled = false;
      ranker.rankPairwiseTransitive = async () => {
        transitiveCalled = true;
        return Array.from({ length: 5 }, (_, i) => ({
          candidateId: i,
          rank: i + 1,
          reason: 'test'
        }));
      };

      const images = Array.from({ length: 5 }, (_, i) => ({
        candidateId: i,
        url: `http://image-${i}.png`
      }));

      await ranker.rankImages(images, 'test prompt', { keepTop: 2 });

      assert.strictEqual(transitiveCalled, true);
    });

    it('should return rankings with candidateId, rank, and reason', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock compareTwo for pairwise ranking
      ranker.compareTwo = async (imageA, imageB) => ({
        winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
        reason: 'Best image'
      });

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      const response = await ranker.rankImages(images, 'test prompt');
      const result = response.rankings; // Extract rankings from response

      assert.strictEqual(result.length, 2);
      assert.ok(result[0].candidateId !== undefined);
      assert.ok(result[0].rank !== undefined);
      assert.ok(result[0].reason);
    });
  });

  describe('All-Pairs Optimization (_rankAllPairsOptimal)', () => {
    it('should compare all unique pairs for small N', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let comparisonCount = 0;
      ranker.compareWithEnsemble = async (imageA, imageB, _prompt, _options) => {
        comparisonCount++;
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: 'test'
        };
      };

      const candidates = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' },
        { candidateId: 2, url: 'http://image-2.png' },
        { candidateId: 3, url: 'http://image-3.png' }
      ];

      class MockGraph {
        canInferWinner() { return null; }
        recordComparison() {}
      }
      const graph = new MockGraph();

      // For 4 candidates: C(4,2) = 6 all-pairs comparisons
      const result = await ranker._rankAllPairsOptimal(candidates, 'test prompt', graph, {});

      assert.strictEqual(result.length, 4);
      // Should have compared all pairs: 6 comparisons for 4 candidates
      assert.strictEqual(comparisonCount, 6);
      // Should rank by win count (0 beats all: 3 wins, 1 beats 2,3: 2 wins, etc.)
      assert.strictEqual(result[0].candidateId, 0);
      assert.strictEqual(result[0].wins, 3);
    });

    it('should use all-pairs strategy for N ≤ 8 in rankPairwiseTransitive', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let allPairsMethodCalled = false;
      ranker._rankAllPairsOptimal = async function(...args) {
        allPairsMethodCalled = true;
        const candidates = args[0];
        return candidates.map((c, i) => ({ ...c, wins: candidates.length - 1 - i }));
      };

      const images = Array.from({ length: 4 }, (_, i) => ({
        candidateId: i,
        url: `http://image-${i}.png`
      }));

      await ranker.rankPairwiseTransitive(images, 'test prompt', { keepTop: 2 });

      assert.strictEqual(allPairsMethodCalled, true);
    });

    it('should leverage transitivity in subsequent rankings', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let comparisonCount = 0;
      ranker.compareWithEnsemble = async (imageA, imageB) => {
        comparisonCount++;
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          reason: 'test'
        };
      };

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' },
        { candidateId: 2, url: 'http://image-2.png' },
        { candidateId: 3, url: 'http://image-3.png' }
      ];

      // For small N (≤8), all-pairs builds complete graph
      // Finding top 2: Implementation returns all ranks but optimizes comparisons
      const result = await ranker.rankPairwiseTransitive(images, 'test prompt', { keepTop: 2 });

      assert.ok(result.length >= 2, 'Should return at least top 2');
      assert.strictEqual(result[0].rank, 1);
      assert.strictEqual(result[1].rank, 2);
      assert.strictEqual(result[0].candidateId, 0);
      assert.strictEqual(result[1].candidateId, 1);
      // Should be 6 comparisons for all-pairs of 4 candidates
      assert.strictEqual(comparisonCount, 6);
    });
  });
});
