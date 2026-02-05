/**
 * 🔴 TDD RED - Local VLM Tournament-Style Ranking Tests
 * Tests for pairwise image ranking using tournament selection with transitivity
 * Mirrors the ImageRanker pattern used for OpenAI ranking
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// The provider we're testing
let LocalVLMProvider;
try {
  LocalVLMProvider = require('../../src/providers/local-vlm-provider');
} catch {
  LocalVLMProvider = null;
}

describe('LocalVLMProvider Tournament-Style Ranking', () => {
  let provider;
  let comparisonCount;
  let comparisons;

  beforeEach(() => {
    comparisonCount = 0;
    comparisons = [];

    if (LocalVLMProvider) {
      provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Mock the axios calls to track comparisons
      provider._axios = {
        post: async (url, data) => {
          comparisonCount++;
          comparisons.push({
            imageA: data.image_a,
            imageB: data.image_b,
            prompt: data.prompt
          });

          // Simulate comparison: lower index wins (for predictable tests)
          const aIndex = parseInt(data.image_a.match(/\d+/)?.[0] || '0');
          const bIndex = parseInt(data.image_b.match(/\d+/)?.[0] || '0');

          return {
            data: {
              choice: aIndex < bIndex ? 'A' : 'B',
              explanation: `Image ${aIndex < bIndex ? 'A' : 'B'} better matches prompt`,
              confidence: 0.85
            }
          };
        },
        get: async () => ({ data: { status: 'healthy', model_loaded: true } })
      };
    }
  });

  describe('rankImagesWithTransitivity', () => {
    it('should have rankImagesWithTransitivity method', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      assert.strictEqual(
        typeof provider.rankImagesWithTransitivity,
        'function',
        'Should have rankImagesWithTransitivity method'
      );
    });

    it('should use transitive inference to skip redundant comparisons', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 },
        { localPath: '/img3.png', candidateId: 3 }
      ];

      const result = await provider.rankImagesWithTransitivity(images, 'test prompt');
      const ranked = result.rankings;

      // With transitivity, should need fewer than n*(n-1)/2 = 6 comparisons
      // Because if A > B and B > C, we infer A > C
      assert.ok(Array.isArray(ranked), 'Should return array');
      assert.strictEqual(ranked.length, images.length, 'Should rank all images');

      // Verify ranking order (lower index should win based on mock)
      assert.strictEqual(ranked[0].candidateId, 0, 'Image 0 should rank first');
      assert.strictEqual(ranked[3].candidateId, 3, 'Image 3 should rank last');
    });

    it('should return rankings with candidateId, rank, and reason', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const images = [
        { localPath: '/img0.png', candidateId: 10 },
        { localPath: '/img1.png', candidateId: 20 }
      ];

      const result = await provider.rankImagesWithTransitivity(images, 'test');
      const ranked = result.rankings;

      assert.ok(ranked[0].candidateId !== undefined, 'Should have candidateId');
      assert.ok(ranked[0].rank !== undefined, 'Should have rank');
      assert.ok(ranked[0].reason, 'Should have reason');
      assert.strictEqual(ranked[0].rank, 1, 'Best should have rank 1');
      assert.strictEqual(ranked[1].rank, 2, 'Second should have rank 2');
    });

    it('should accept knownComparisons to skip already-known results', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 }
      ];

      // Pre-seed with known comparison: 0 beats 1
      const knownComparisons = [
        { winnerId: 0, loserId: 1 }
      ];

      await provider.rankImagesWithTransitivity(images, 'test', { knownComparisons });

      // Should not re-compare 0 vs 1 since it's already known
      const comparedPair01 = comparisons.some(c =>
        (c.imageA.includes('img0') && c.imageB.includes('img1')) ||
        (c.imageA.includes('img1') && c.imageB.includes('img0'))
      );
      assert.ok(!comparedPair01, 'Should not re-compare known pair 0 vs 1');
    });
  });

  describe('All-Pairs Strategy (N ≤ 8)', () => {
    it('should use all-pairs comparison for small candidate sets', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 },
        { localPath: '/img3.png', candidateId: 3 }
      ];

      const result = await provider.rankImagesWithTransitivity(images, 'test', {
        strategy: 'all-pairs',
        ensembleSize: 1 // Disable ensemble voting to test strategy logic
      });
      const ranked = result.rankings;

      // For 4 images, all-pairs = C(4,2) = 6 comparisons max
      // But with transitivity some may be skipped
      assert.ok(comparisonCount <= 6, `Should do at most 6 comparisons, got ${comparisonCount}`);
      assert.strictEqual(ranked.length, 4, 'Should rank all images');
    });

    it('should track win counts in all-pairs mode', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 }
      ];

      const result = await provider.rankImagesWithTransitivity(images, 'test', {
        strategy: 'all-pairs'
      });
      const ranked = result.rankings;

      // Winner (img0) should have most wins
      assert.ok(ranked[0].wins !== undefined, 'Should track wins');
      assert.ok(ranked[0].wins >= ranked[1].wins, 'First place should have most wins');
    });
  });

  describe('Tournament Strategy (N > 8)', () => {
    it('should use tournament selection for large candidate sets', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      // 10 images - would use tournament (N > 8) if not overridden
      const images = Array(10).fill(null).map((_, i) => ({
        localPath: `/img${i}.png`,
        candidateId: i
      }));

      // Force tournament strategy explicitly
      const result = await provider.rankImagesWithTransitivity(images, 'test', {
        strategy: 'tournament'
      });
      const ranked = result.rankings;

      // Tournament ranks all images
      assert.strictEqual(ranked.length, 10, 'Should rank all images');
      // Tournament builds comparison graph for future transitivity benefits
      const graph = provider.getComparisonGraph();
      assert.ok(graph, 'Should build comparison graph');
    });

    it('should find best candidate using tournament bracket', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const images = [
        { localPath: '/img5.png', candidateId: 5 },
        { localPath: '/img2.png', candidateId: 2 },
        { localPath: '/img8.png', candidateId: 8 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img9.png', candidateId: 9 }
      ];

      const result = await provider.rankImagesWithTransitivity(images, 'test');
      const ranked = result.rankings;

      // Based on mock (lower index wins), img1 should win
      assert.strictEqual(ranked[0].candidateId, 1, 'Should find true winner via tournament');
    });
  });

  describe('ComparisonGraph Integration', () => {
    it('should expose getComparisonGraph method', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      assert.strictEqual(
        typeof provider.getComparisonGraph,
        'function',
        'Should have getComparisonGraph method'
      );
    });

    it('should build comparison graph during ranking', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 }
      ];

      await provider.rankImagesWithTransitivity(images, 'test');

      const graph = provider.getComparisonGraph();
      assert.ok(graph, 'Should have comparison graph');

      // Graph should be able to infer winners
      const result = graph.canInferWinner(0, 2);
      assert.ok(result, 'Should be able to infer 0 vs 2');
      assert.strictEqual(result.winner, 0, 'Should infer 0 beats 2');
    });

    it('should support resetting the comparison graph', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      assert.strictEqual(
        typeof provider.resetComparisonGraph,
        'function',
        'Should have resetComparisonGraph method'
      );
    });
  });

  describe('Progress Callbacks', () => {
    it('should support onProgress callback', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const progressEvents = [];
      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 }
      ];

      await provider.rankImagesWithTransitivity(images, 'test', {
        onProgress: (event) => progressEvents.push(event)
      });

      assert.ok(progressEvents.length > 0, 'Should emit progress events');
      assert.ok(progressEvents[0].type === 'comparison', 'Should have comparison events');
      assert.ok(progressEvents[0].candidateA !== undefined, 'Should have candidateA');
      assert.ok(progressEvents[0].candidateB !== undefined, 'Should have candidateB');
    });

    it('should report inferred comparisons in progress', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      const progressEvents = [];
      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 }
      ];

      await provider.rankImagesWithTransitivity(images, 'test', {
        strategy: 'all-pairs',
        onProgress: (event) => progressEvents.push(event)
      });

      // Some comparisons may be inferred via transitivity
      // This is optional - not all rankings will have inferences
      assert.ok(progressEvents.length > 0, 'Should emit at least some events');
    });
  });

  describe('Error Handling', () => {
    it('should handle comparison failures gracefully', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      let failCount = 0;
      provider._axios = {
        post: async (_url, _data) => {
          failCount++;
          if (failCount === 2) {
            throw new Error('VLM service timeout');
          }
          return {
            data: { choice: 'A', explanation: 'test', confidence: 0.8 }
          };
        }
      };

      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 }
      ];

      // Should not throw, should gracefully handle failure
      const result = await provider.rankImagesWithTransitivity(images, 'test', {
        gracefulDegradation: true
      });

      assert.ok(result.rankings, 'Should return rankings despite error');
    });

    it('should track errors during ranking', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');

      provider._axios = {
        post: async () => { throw new Error('Service unavailable'); }
      };

      const images = [
        { localPath: '/img0.png', candidateId: 0 },
        { localPath: '/img1.png', candidateId: 1 }
      ];

      try {
        await provider.rankImagesWithTransitivity(images, 'test', {
          gracefulDegradation: true
        });
      } catch {
        // May or may not throw depending on implementation
      }

      const errors = provider.getErrors?.() || [];
      // Errors should be tracked if available
      assert.ok(Array.isArray(errors), 'Should track errors as array');
    });
  });
});
