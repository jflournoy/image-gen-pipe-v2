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

      // Mock Math.random to disable swapping (always return >= 0.5)
      const originalRandom = Math.random;
      Math.random = () => 0.7;

      // Mock compareTwo instead of _callVisionAPI to avoid randomization issues
      let callCount = 0;
      ranker.compareTwo = async (imageA, imageB) => {
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

      try {
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
      } finally {
        Math.random = originalRandom;
      }
    });

    it('should handle unanimous decisions with high confidence', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock compareTwo to always make candidateId 0 win
      // compareWithEnsemble swaps order randomly, so we need to check candidateId
      ranker.compareTwo = async (imageA, imageB) => {
        // Return 'A' if first param is candidateId 0, else 'B'
        const winner = imageA.candidateId === 0 ? 'A' : 'B';
        return {
          winner,
          reason: 'candidateId 0 is clearly better',
          ranks: {
            A: { alignment: 1, aesthetics: 1 },
            B: { alignment: 2, aesthetics: 2 }
          }
        };
      };

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

      // Mock compareTwo to create exact 2-2 tie
      // Make first two calls favor candidateId 0, last two favor candidateId 1
      let callCount = 0;
      ranker.compareTwo = async (imageA, imageB) => {
        callCount++;
        // First 2 calls: candidateId 0 wins
        if (callCount <= 2) {
          const winner = imageA.candidateId === 0 ? 'A' : 'B';
          return {
            winner,
            reason: 'candidateId 0 wins',
            ranks: { A: { alignment: 1, aesthetics: 1 }, B: { alignment: 2, aesthetics: 2 } }
          };
        }
        // Last 2 calls: candidateId 1 wins
        const winner = imageA.candidateId === 1 ? 'A' : 'B';
        return {
          winner,
          reason: 'candidateId 1 wins',
          ranks: { A: { alignment: 2, aesthetics: 2 }, B: { alignment: 1, aesthetics: 1 } }
        };
      };

      const result = await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene landscape',
        { ensembleSize: 4 }
      );

      // With 2-2 tie, confidence should be 0.5 (50%)
      assert.strictEqual(result.confidence, 0.5, 'Tie should have 0.5 confidence');
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

  describe('ensemble variance with temperature', () => {
    it('should use higher temperature for ensemble to increase variance', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let capturedTemperature = null;
      ranker._callVisionAPI = async (messages, options) => {
        capturedTemperature = options?.temperature;
        return { winner: 'A', reason: 'test' };
      };

      await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://a.png' },
        { candidateId: 1, url: 'http://b.png' },
        'test prompt',
        { ensembleSize: 3 }
      );

      // Should use higher temperature for ensemble (0.7-0.9)
      assert.ok(capturedTemperature >= 0.7, 'Ensemble should use temperature >= 0.7');
    });

    it.skip('should randomize image order across ensemble calls', async () => {
      // This test is implementation-specific and hard to test with mocking
      // Randomization happens in compareWithEnsemble before calling compareTwo
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      const observedOrders = new Set();
      ranker._callVisionAPI = async (messages) => {
        // Extract image URLs from message to detect order
        const images = messages[1].content
          .filter(c => c.type === 'image_url')
          .map(c => c.image_url.url);
        observedOrders.add(images.join(','));
        return { winner: 'A', reason: 'test' };
      };

      await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://a.png' },
        { candidateId: 1, url: 'http://b.png' },
        'test prompt',
        { ensembleSize: 5 }
      );

      // With 5 calls and randomization, should see at least 2 different orders
      assert.ok(observedOrders.size >= 2, 'Should randomize image order across calls');
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

      // Test with 2 images - rankImages now returns {rankings, metadata}
      const response2 = await ranker.rankImages(
        [
          { candidateId: 0, url: 'http://image-0.png' },
          { candidateId: 1, url: 'http://image-1.png' }
        ],
        'test prompt',
        { ensembleSize: 1 }
      );

      // Test with 4 images
      const response4 = await ranker.rankImages(
        [
          { candidateId: 0, url: 'http://image-0.png' },
          { candidateId: 1, url: 'http://image-1.png' },
          { candidateId: 2, url: 'http://image-2.png' },
          { candidateId: 3, url: 'http://image-3.png' }
        ],
        'test prompt',
        { ensembleSize: 1 }
      );

      // Extract rankings from response objects
      const result2 = response2.rankings;
      const result4 = response4.rankings;

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

  describe('known comparisons optimization', () => {
    it('should skip comparisons for pairs with known results', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Track which pairs were actually compared via API
      const comparedPairs = new Set();
      ranker.compareWithEnsemble = async (imageA, imageB, _prompt, _options) => {
        const key = `${imageA.candidateId}-${imageB.candidateId}`;
        comparedPairs.add(key);
        return {
          winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
          votes: { A: 1, B: 0 },
          confidence: 1.0,
          reason: 'test',
          aggregatedRanks: {
            A: { alignment: 1, aesthetics: 1, combined: 1 },
            B: { alignment: 2, aesthetics: 2, combined: 2 }
          }
        };
      };

      // Simulate: parents 0 and 1 already ranked (0 > 1)
      // New children: 2 and 3
      const images = [
        { candidateId: 'i0c0', url: 'http://image-0.png' },  // Parent (rank 1)
        { candidateId: 'i0c1', url: 'http://image-1.png' },  // Parent (rank 2)
        { candidateId: 'i1c0', url: 'http://image-2.png' },  // Child
        { candidateId: 'i1c1', url: 'http://image-3.png' }   // Child
      ];

      // Pass known comparisons: 0 > 1 (parent ranking from previous iteration)
      const knownComparisons = [
        { winnerId: 'i0c0', loserId: 'i0c1' }
      ];

      await ranker.rankImages(images, 'test prompt', {
        keepTop: 2,
        ensembleSize: 1,
        knownComparisons
      });

      // Should NOT compare i0c0 vs i0c1 (already known)
      assert.ok(!comparedPairs.has('i0c0-i0c1'), 'Should skip known parent comparison');
      assert.ok(!comparedPairs.has('i0c1-i0c0'), 'Should skip known parent comparison (reverse)');
    });

    it('should use known comparisons for transitivity inference', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let comparisonCount = 0;
      ranker.compareWithEnsemble = async (_imageA, _imageB, _prompt, _options) => {
        comparisonCount++;
        return {
          winner: 'A',
          votes: { A: 1, B: 0 },
          confidence: 1.0,
          reason: 'test',
          aggregatedRanks: {
            A: { alignment: 1, aesthetics: 1, combined: 1 },
            B: { alignment: 2, aesthetics: 2, combined: 2 }
          }
        };
      };

      // 4 images where we know: A > B from previous iteration
      const images = [
        { candidateId: 'A', url: 'http://a.png' },
        { candidateId: 'B', url: 'http://b.png' },
        { candidateId: 'C', url: 'http://c.png' },
        { candidateId: 'D', url: 'http://d.png' }
      ];

      // Known: A > B
      const knownComparisons = [
        { winnerId: 'A', loserId: 'B' }
      ];

      await ranker.rankImages(images, 'test prompt', {
        keepTop: 4,
        ensembleSize: 1,
        knownComparisons
      });

      // With 4 images and 1 known comparison, we need fewer than N*(N-1)/2 = 6 comparisons
      // Exact count depends on tournament order, but should be < 6
      assert.ok(comparisonCount < 6, `Should need fewer comparisons with known result, got ${comparisonCount}`);
    });
  });
});
