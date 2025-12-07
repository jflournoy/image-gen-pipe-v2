/**
 * 🔴 TDD RED Phase: Multi-Factor Pairwise Comparison Tests
 *
 * Pairwise comparisons evaluate multiple factors using RANKS (not scores):
 * - Alignment rank (1 or 2): Which image better matches the prompt?
 * - Aesthetics rank (1 or 2): Which image has better visual quality?
 *
 * The winner is determined by weighted rank combination:
 * combined = alignment_rank * 0.7 + aesthetics_rank * 0.3
 * Lower combined score wins (rank 1 is better than rank 2)
 *
 * Example:
 *   A: alignment=1, aesthetics=2 → combined = 1*0.7 + 2*0.3 = 1.3
 *   B: alignment=2, aesthetics=1 → combined = 2*0.7 + 1*0.3 = 1.7
 *   Winner: A (lower combined score)
 *
 * Note: Shuffling is disabled to ensure deterministic behavior.
 * Position bias is mitigated through explicit labeling (A/B).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const ImageRanker = require('../../src/services/image-ranker.js');

describe('ImageRanker Multi-Factor Comparison', () => {
  describe('compareTwo multi-factor ranking', () => {
    it('should return separate ranks for alignment and aesthetics', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Mock API to return multi-factor ranks
      ranker._callVisionAPI = async () => ({
        winner: 'A',
        reason: 'Image A better matches prompt, B has better aesthetics',
        ranks: {
          A: { alignment: 1, aesthetics: 2 },
          B: { alignment: 2, aesthetics: 1 }
        },
        winnerStrengths: ['prompt match', 'color'],
        loserWeaknesses: ['missing elements']
      });

      const result = await ranker.compareTwo(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene mountain landscape'
      );

      // Should have ranks for both images
      assert.ok(result.ranks, 'Should include ranks object');
      assert.ok(result.ranks.A, 'Should have ranks for image A');
      assert.ok(result.ranks.B, 'Should have ranks for image B');

      // Each should have alignment and aesthetics ranks (1 or 2)
      assert.ok([1, 2].includes(result.ranks.A.alignment), 'A alignment should be 1 or 2');
      assert.ok([1, 2].includes(result.ranks.A.aesthetics), 'A aesthetics should be 1 or 2');
      assert.ok([1, 2].includes(result.ranks.B.alignment), 'B alignment should be 1 or 2');
      assert.ok([1, 2].includes(result.ranks.B.aesthetics), 'B aesthetics should be 1 or 2');
    });

    it('should determine winner based on weighted rank combination', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // A wins on alignment (rank 1), B wins on aesthetics (rank 1)
      // With default weighting (70% alignment, 30% aesthetics):
      // A combined = 1 * 0.7 + 2 * 0.3 = 0.7 + 0.6 = 1.3
      // B combined = 2 * 0.7 + 1 * 0.3 = 1.4 + 0.3 = 1.7
      // A should win (lower combined score)
      ranker._callVisionAPI = async () => ({
        winner: 'A',
        reason: 'A has better weighted rank',
        ranks: {
          A: { alignment: 1, aesthetics: 2 },
          B: { alignment: 2, aesthetics: 1 }
        }
      });

      const result = await ranker.compareTwo(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'a serene mountain landscape'
      );

      assert.strictEqual(result.winner, 'A', 'A should win with lower combined rank score');

      // Verify combined rank scores are calculated
      assert.ok(result.ranks.A.combined !== undefined, 'Should have combined rank for A');
      assert.ok(result.ranks.B.combined !== undefined, 'Should have combined rank for B');

      // A: 1*0.7 + 2*0.3 = 1.3, B: 2*0.7 + 1*0.3 = 1.7
      assert.ok(
        Math.abs(result.ranks.A.combined - 1.3) < 0.01,
        `A combined should be 1.3, got ${result.ranks.A.combined}`
      );
      assert.ok(
        Math.abs(result.ranks.B.combined - 1.7) < 0.01,
        `B combined should be 1.7, got ${result.ranks.B.combined}`
      );
      assert.ok(result.ranks.A.combined < result.ranks.B.combined, 'A should have lower (better) combined');
    });

    it('should allow configuring alignment vs aesthetics weight', async () => {
      const ranker = new ImageRanker({
        apiKey: 'mock-key',
        alignmentWeight: 0.5  // 50% alignment, 50% aesthetics
      });

      // With 50/50 weighting:
      // A combined = 1 * 0.5 + 2 * 0.5 = 0.5 + 1.0 = 1.5
      // B combined = 2 * 0.5 + 1 * 0.5 = 1.0 + 0.5 = 1.5
      // Should be a tie!
      ranker._callVisionAPI = async () => ({
        winner: 'A',
        reason: 'Tie breaker',
        ranks: {
          A: { alignment: 1, aesthetics: 2 },
          B: { alignment: 2, aesthetics: 1 }
        }
      });

      const result = await ranker.compareTwo(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'test prompt'
      );

      // With 50/50 weight, combined ranks should be equal
      // A: 1*0.5 + 2*0.5 = 1.5, B: 2*0.5 + 1*0.5 = 1.5
      assert.ok(
        Math.abs(result.ranks.A.combined - 1.5) < 0.01,
        `A combined should be 1.5, got ${result.ranks.A.combined}`
      );
      assert.ok(
        Math.abs(result.ranks.B.combined - 1.5) < 0.01,
        `B combined should be 1.5, got ${result.ranks.B.combined}`
      );
    });

    it('should handle when one image wins both factors', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // A wins both (rank 1 for both)
      ranker._callVisionAPI = async () => ({
        winner: 'A',
        reason: 'A dominates on both factors',
        ranks: {
          A: { alignment: 1, aesthetics: 1 },
          B: { alignment: 2, aesthetics: 2 }
        }
      });

      const result = await ranker.compareTwo(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'test prompt'
      );

      assert.strictEqual(result.winner, 'A');
      // A: 1*0.7 + 1*0.3 = 1.0, B: 2*0.7 + 2*0.3 = 2.0
      assert.ok(
        Math.abs(result.ranks.A.combined - 1.0) < 0.01,
        `A combined should be 1.0, got ${result.ranks.A.combined}`
      );
      assert.ok(
        Math.abs(result.ranks.B.combined - 2.0) < 0.01,
        `B combined should be 2.0, got ${result.ranks.B.combined}`
      );
    });

    it('should include factor breakdown in the reason', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      ranker._callVisionAPI = async () => ({
        winner: 'A',
        reason: 'A better matches prompt (alignment rank 1) despite lower aesthetics (rank 2)',
        ranks: {
          A: { alignment: 1, aesthetics: 2 },
          B: { alignment: 2, aesthetics: 1 }
        }
      });

      const result = await ranker.compareTwo(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'test prompt'
      );

      // Reason should mention both factors
      assert.ok(result.reason.toLowerCase().includes('alignment') ||
                result.reason.toLowerCase().includes('prompt'),
                'Reason should mention alignment/prompt');
      assert.ok(result.reason.toLowerCase().includes('aesthetic'),
                'Reason should mention aesthetics');
    });
  });

  describe('deterministic ordering (no shuffling)', () => {
    it('should process images in consistent order (no random shuffling)', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      // Track the order images are presented to the API
      const presentationOrders = [];

      ranker._callVisionAPI = async (messages) => {
        // Extract image URLs from the message to see presentation order
        const userContent = messages[1].content;
        const imageUrls = userContent
          .filter(c => c.type === 'image_url')
          .map(c => c.image_url.url);
        presentationOrders.push(imageUrls);

        return {
          winner: 'A',
          reason: 'test',
          ranks: {
            A: { alignment: 1, aesthetics: 1 },
            B: { alignment: 2, aesthetics: 2 }
          }
        };
      };

      // Run the same comparison multiple times
      for (let i = 0; i < 3; i++) {
        await ranker.compareTwo(
          { candidateId: 0, url: 'http://image-a.png' },
          { candidateId: 1, url: 'http://image-b.png' },
          'test prompt'
        );
      }

      // All presentations should be in the same order
      assert.strictEqual(presentationOrders.length, 3);
      assert.deepStrictEqual(
        presentationOrders[0],
        presentationOrders[1],
        'Order should be consistent across calls'
      );
      assert.deepStrictEqual(
        presentationOrders[1],
        presentationOrders[2],
        'Order should be consistent across calls'
      );
    });

    it('should present images in candidateId order (A=lower, B=higher)', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let imageOrder = null;

      ranker._callVisionAPI = async (messages) => {
        const userContent = messages[1].content;
        const imageUrls = userContent
          .filter(c => c.type === 'image_url')
          .map(c => c.image_url.url);
        imageOrder = imageUrls;

        return {
          winner: 'A',
          reason: 'test',
          ranks: {
            A: { alignment: 1, aesthetics: 1 },
            B: { alignment: 2, aesthetics: 2 }
          }
        };
      };

      await ranker.compareTwo(
        { candidateId: 5, url: 'http://image-five.png' },
        { candidateId: 2, url: 'http://image-two.png' },
        'test prompt'
      );

      // First image should be candidateId 2 (lower), second should be 5 (higher)
      // A = lower candidateId, B = higher candidateId
      assert.strictEqual(imageOrder[0], 'http://image-two.png', 'Image A should be lower candidateId');
      assert.strictEqual(imageOrder[1], 'http://image-five.png', 'Image B should be higher candidateId');
    });
  });

  describe('compareWithEnsemble with multi-factor ranks', () => {
    it('should aggregate ranks across ensemble votes', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      let callCount = 0;
      ranker._callVisionAPI = async () => {
        callCount++;
        // Different ranks each call to test aggregation
        if (callCount === 1) {
          return {
            winner: 'A',
            reason: 'A wins round 1',
            ranks: {
              A: { alignment: 1, aesthetics: 2 },
              B: { alignment: 2, aesthetics: 1 }
            }
          };
        } else if (callCount === 2) {
          return {
            winner: 'A',
            reason: 'A wins round 2',
            ranks: {
              A: { alignment: 1, aesthetics: 1 },
              B: { alignment: 2, aesthetics: 2 }
            }
          };
        } else {
          return {
            winner: 'B',
            reason: 'B wins round 3',
            ranks: {
              A: { alignment: 2, aesthetics: 2 },
              B: { alignment: 1, aesthetics: 1 }
            }
          };
        }
      };

      const result = await ranker.compareWithEnsemble(
        { candidateId: 0, url: 'http://image-a.png' },
        { candidateId: 1, url: 'http://image-b.png' },
        'test prompt',
        { ensembleSize: 3 }
      );

      // A wins 2 out of 3
      assert.strictEqual(result.winner, 'A', 'A should win by majority');
      assert.strictEqual(result.votes.A, 2);
      assert.strictEqual(result.votes.B, 1);

      // Should have aggregated/averaged ranks
      assert.ok(result.aggregatedRanks, 'Should have aggregated ranks');
      assert.ok(result.aggregatedRanks.A, 'Should have A aggregated ranks');
      assert.ok(result.aggregatedRanks.B, 'Should have B aggregated ranks');

      // A average alignment: (1 + 1 + 2) / 3 = 1.33
      // A average aesthetics: (2 + 1 + 2) / 3 = 1.67
      assert.ok(
        Math.abs(result.aggregatedRanks.A.alignment - 1.33) < 0.1,
        `A alignment should average to ~1.33, got ${result.aggregatedRanks.A.alignment}`
      );
    });
  });

  describe('ranking output includes ranks', () => {
    it('should include factor ranks in ranking results', async () => {
      const ranker = new ImageRanker({ apiKey: 'mock-key' });

      ranker.compareTwo = async (imageA, imageB) => ({
        winner: imageA.candidateId < imageB.candidateId ? 'A' : 'B',
        reason: 'test',
        ranks: {
          A: { alignment: 1, aesthetics: 2, combined: 1.3 },
          B: { alignment: 2, aesthetics: 1, combined: 1.7 }
        }
      });

      const images = [
        { candidateId: 0, url: 'http://image-0.png' },
        { candidateId: 1, url: 'http://image-1.png' }
      ];

      const result = await ranker.rankImages(images, 'test prompt');

      // Rankings should include ranks
      assert.ok(result[0].ranks, 'Rank 1 should have ranks');
      assert.ok(result[0].ranks.alignment !== undefined, 'Should have alignment rank');
      assert.ok(result[0].ranks.aesthetics !== undefined, 'Should have aesthetics rank');
      assert.ok(result[0].ranks.combined !== undefined, 'Should have combined rank score');
    });
  });
});
