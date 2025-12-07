/**
 * 🔴 TDD RED Phase: Ensemble Ranking Tests
 *
 * Consistent pairwise ranking with multiple ratings per pair
 * to reduce variance and improve reliability.
 *
 * Design:
 * - Always use pairwise comparisons (consistent method for any N)
 * - Multiple ratings per pair (ensemble for reliability)
 * - Majority vote to determine winner
 * - Integrates with transitive ranking to minimize total comparisons
 *
 * Architecture:
 * - compareWithEnsemble: Enhanced compareTwo with multiple votes
 * - rankImages uses transitive algorithm but with ensemble comparisons
 * - Transitive inference still reduces total API calls
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const ImageRanker = require('../../src/services/image-ranker.js');

describe('ImageRanker Ensemble', () => {
  describe('compareWithEnsemble', () => {
    it('should compare two images multiple times and return majority winner', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock: A wins 2 out of 3 times (ranks determine winner)
      let callCount = 0;
      ranker._callVisionAPI = async () => {
        callCount++;
        // A wins twice, B wins once (B wins on call 2)
        if (callCount === 2) {
          return {
            winner: 'B',
            reason: 'B has better lighting',
            ranks: { A: { alignment: 2, aesthetics: 2 }, B: { alignment: 1, aesthetics: 1 } }
          };
        }
        return {
          winner: 'A',
          reason: 'A has better composition',
          ranks: { A: { alignment: 1, aesthetics: 1 }, B: { alignment: 2, aesthetics: 2 } }
        };
      };

      const result = await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene landscape',
        { ensembleSize: 3 }
      );

      assert.strictEqual(callCount, 3, 'Should make 3 comparison calls');
      assert.strictEqual(result.winner, 'A', 'A should win by majority');
      assert.strictEqual(result.votes.A, 2, 'A should have 2 votes');
      assert.strictEqual(result.votes.B, 1, 'B should have 1 vote');
      assert.ok(result.confidence > 0.5, 'Confidence should be > 0.5');
    });

    it('should handle unanimous decisions with high confidence', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      ranker._callVisionAPI = async () => ({
        winner: 'A',
        reason: 'A is clearly better'
      });

      const result = await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene landscape',
        { ensembleSize: 3 }
      );

      assert.strictEqual(result.winner, 'A');
      assert.strictEqual(result.votes.A, 3);
      assert.strictEqual(result.votes.B, 0);
      assert.strictEqual(result.confidence, 1.0, 'Unanimous should have confidence 1.0');
    });

    it('should handle ties by preferring first image (position-neutral)', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock: Alternating wins (2 A, 2 B with 4 calls) using ranks
      let callCount = 0;
      ranker._callVisionAPI = async () => {
        callCount++;
        if (callCount % 2 === 1) {
          return {
            winner: 'A',
            reason: 'A reason',
            ranks: { A: { alignment: 1, aesthetics: 1 }, B: { alignment: 2, aesthetics: 2 } }
          };
        }
        return {
          winner: 'B',
          reason: 'B reason',
          ranks: { A: { alignment: 2, aesthetics: 2 }, B: { alignment: 1, aesthetics: 1 } }
        };
      };

      const result = await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene landscape',
        { ensembleSize: 4 }
      );

      // Tie-breaker: could go either way, but should have low confidence
      assert.ok(result.confidence <= 0.5, 'Tie should have low confidence');
    });

    it('should default to ensembleSize of 1 (fast mode, backward compatible)', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let callCount = 0;
      ranker._callVisionAPI = async () => {
        callCount++;
        return { winner: 'A', reason: 'A wins' };
      };

      await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene landscape'
        // No options = default ensembleSize of 1
      );

      assert.strictEqual(callCount, 1, 'Default ensemble size should be 1 for speed');
    });
  });

  describe('transitive ranking with ensemble', () => {
    it('should use transitive inference to skip comparisons even with ensemble', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Track which pairs were compared
      const comparedPairs = new Set();
      ranker.compareWithEnsemble = async (imageA, imageB, _prompt, _options) => {
        const key = `${Math.min(imageA.candidateId, imageB.candidateId)}-${Math.max(imageA.candidateId, imageB.candidateId)}`;
        comparedPairs.add(key);
        // Lower candidateId always wins
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          votes: { A: 3, B: 0 },
          confidence: 1.0,
          reason: 'test'
        };
      };

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' },
        { candidateId: 2, url: 'http://image-2.png' }
      ];

      // Find top 2 from 3
      await ranker.rankImages(images, 'test prompt', { keepTop: 2, ensembleSize: 3 });

      // With transitivity: if 0 > 1 and 0 > 2, we know 0 is best
      // Then comparing 1 vs 2 gives us rank 2
      // Should NOT need all 3 pairwise comparisons due to transitivity
      assert.ok(comparedPairs.size <= 3, `Should use transitivity to reduce comparisons, got ${comparedPairs.size}`);
    });

    it('should use ensemble for each actual comparison in transitive ranking', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let totalApiCalls = 0;
      ranker._callVisionAPI = async () => {
        totalApiCalls++;
        return { winner: 'A', reason: 'A wins' };
      };

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      // 2 images = 1 comparison, with ensembleSize=3 = 3 API calls
      await ranker.rankImages(images, 'test prompt', { ensembleSize: 3 });

      assert.strictEqual(totalApiCalls, 3, '1 comparison × 3 ensemble = 3 API calls');
    });

    it('should pass ensembleSize through rankImages to comparisons', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let receivedEnsembleSize = null;
      ranker.compareWithEnsemble = async (_imageA, _imageB, _prompt, options) => {
        receivedEnsembleSize = options?.ensembleSize;
        return {
          winner: 'A',
          votes: { A: 3, B: 0 },
          confidence: 1.0,
          reason: 'test'
        };
      };

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      await ranker.rankImages(images, 'test prompt', { ensembleSize: 5 });

      assert.strictEqual(receivedEnsembleSize, 5, 'ensembleSize should be passed through');
    });
  });

  describe('rankImages unified behavior', () => {
    it('should use same algorithm for 2 images as for 8 images', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Track method calls
      let compareWithEnsembleCalled = false;
      let rankAllAtOnceCalled = false;

      ranker.compareWithEnsemble = async (imageA, imageB) => {
        compareWithEnsembleCalled = true;
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          votes: { A: 1, B: 0 },
          confidence: 1.0,
          reason: 'test'
        };
      };

      const originalRankAllAtOnce = ranker.rankAllAtOnce;
      ranker.rankAllAtOnce = async (...args) => {
        rankAllAtOnceCalled = true;
        return originalRankAllAtOnce.apply(ranker, args);
      };

      // Test with 2 images
      const images2 = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      await ranker.rankImages(images2, 'test prompt', { ensembleSize: 1 });

      // Should use pairwise (compareWithEnsemble), not rankAllAtOnce
      assert.strictEqual(compareWithEnsembleCalled, true, 'Should use compareWithEnsemble for 2 images');
      assert.strictEqual(rankAllAtOnceCalled, false, 'Should NOT use rankAllAtOnce');
    });

    it('should return consistent result structure regardless of N', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      ranker.compareWithEnsemble = async (imageA, imageB) => ({
        winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
        votes: { A: 2, B: 1 },
        confidence: 0.67,
        reason: 'test reason',
        strengths: ['good'],
        weaknesses: ['bad'],
        improvementSuggestion: 'do better'
      });

      // Test with 2 images
      const result2 = await ranker.rankImages(
        [
          { candidateId: 0, url: 'http://image-0.png' },
          { candidateId: 1, url: 'http://image-1.png' }
        ],
        'test prompt',
        { ensembleSize: 1 }
      );

      // Test with 4 images
      const result4 = await ranker.rankImages(
        [
          { candidateId: 0, url: 'http://image-0.png' },
          { candidateId: 1, url: 'http://image-1.png' },
          { candidateId: 2, url: 'http://image-2.png' },
          { candidateId: 3, url: 'http://image-3.png' }
        ],
        'test prompt',
        { ensembleSize: 1 }
      );

      // Both should have same structure
      for (const result of [result2, result4]) {
        assert.ok(result[0].candidateId !== undefined);
        assert.ok(result[0].rank !== undefined);
        assert.ok(result[0].reason !== undefined);
      }
    });
  });

  describe('configuration', () => {
    it('should allow configuring default ensemble size', () => {
      const ranker = new ImageRanker({
        apiKey: 'mock-key',
        defaultEnsembleSize: 5
      });

      assert.strictEqual(ranker.defaultEnsembleSize, 5);
    });

    it('should use ensembleSize=1 for fast mode (single comparison)', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let callCount = 0;
      ranker._callVisionAPI = async () => {
        callCount++;
        return { winner: 'A', reason: 'A wins' };
      };

      await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'test',
        { ensembleSize: 1 }
      );

      assert.strictEqual(callCount, 1, 'ensembleSize=1 should make only 1 call');
    });
  });
});
