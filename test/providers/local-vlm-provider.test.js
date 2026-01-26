/**
 * 🔴 TDD RED - Local VLM Provider Tests
 * Tests for pairwise image comparison using local Vision-Language Model
 * Uses llama-cpp-python with multimodal GGUF models (LLaVA, etc.)
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock axios for HTTP tests
const mockAxios = {
  responses: [],
  post: async (url, data, config) => {
    const response = mockAxios.responses.shift();
    if (response?.error) throw response.error;
    return { data: response || {} };
  },
  get: async (url, config) => {
    const response = mockAxios.responses.shift();
    if (response?.error) throw response.error;
    return { data: response || {} };
  },
  setResponse: (response) => mockAxios.responses.push(response),
  reset: () => { mockAxios.responses = []; }
};

// Will be implemented in src/providers/local-vlm-provider.js
let LocalVLMProvider;
try {
  LocalVLMProvider = require('../../src/providers/local-vlm-provider');
} catch (e) {
  // Expected to fail initially - TDD RED phase
  LocalVLMProvider = null;
}

describe('LocalVLMProvider', () => {
  beforeEach(() => {
    mockAxios.reset();
  });

  describe('Module Loading', () => {
    it('should export LocalVLMProvider class', () => {
      assert.ok(LocalVLMProvider, 'LocalVLMProvider should be exported');
      assert.strictEqual(typeof LocalVLMProvider, 'function', 'Should be a class/function');
    });
  });

  describe('Constructor', () => {
    it('should accept apiUrl configuration', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({
        apiUrl: 'http://localhost:8004'
      });
      assert.ok(provider.apiUrl, 'Should store apiUrl');
      assert.strictEqual(provider.apiUrl, 'http://localhost:8004');
    });

    it('should have default apiUrl', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider();
      assert.ok(provider.apiUrl, 'Should have default apiUrl');
    });

    it('should accept model configuration', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({
        model: 'llava-v1.6-mistral-7b.Q4_K_M.gguf'
      });
      assert.ok(provider.model, 'Should store model name');
    });

    it('should have 180s default timeout for VLM inference (12GB GPU ~150s/comparison)', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      // Clear env var to test default
      const originalTimeout = process.env.VLM_TIMEOUT_MS;
      delete process.env.VLM_TIMEOUT_MS;

      // Re-import to get fresh default
      delete require.cache[require.resolve('../../src/providers/local-vlm-provider')];
      const Provider = require('../../src/providers/local-vlm-provider');
      const provider = new Provider();

      assert.strictEqual(provider.timeout, 180000, 'Default timeout should be 180s (3 min)');

      // Restore env var
      if (originalTimeout !== undefined) {
        process.env.VLM_TIMEOUT_MS = originalTimeout;
      }
    });

    it('should allow timeout override via VLM_TIMEOUT_MS env var', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const originalTimeout = process.env.VLM_TIMEOUT_MS;
      process.env.VLM_TIMEOUT_MS = '300000'; // 5 minutes

      // Re-import to get env-configured value
      delete require.cache[require.resolve('../../src/providers/local-vlm-provider')];
      const Provider = require('../../src/providers/local-vlm-provider');
      const provider = new Provider();

      assert.strictEqual(provider.timeout, 300000, 'Should use VLM_TIMEOUT_MS env var');

      // Restore
      if (originalTimeout !== undefined) {
        process.env.VLM_TIMEOUT_MS = originalTimeout;
      } else {
        delete process.env.VLM_TIMEOUT_MS;
      }
    });

    it('should allow timeout override via constructor options', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({
        timeout: 240000 // 4 minutes
      });

      assert.strictEqual(provider.timeout, 240000, 'Should use constructor timeout option');
    });
  });

  describe('compareImages', () => {
    it('should accept two image paths and a prompt', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      // Mock successful comparison
      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Image A better captures the sunset colors',
        confidence: 0.85
      });

      const result = await provider.compareImages(
        '/path/to/imageA.png',
        '/path/to/imageB.png',
        'a beautiful sunset over the ocean'
      );

      assert.ok(result, 'Should return a result');
      assert.ok(['A', 'B'].includes(result.choice), 'Should return A or B');
    });

    it('should return winner, explanation, and confidence', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Image A has better composition and lighting',
        confidence: 0.92
      });

      const result = await provider.compareImages(
        '/path/to/imageA.png',
        '/path/to/imageB.png',
        'a serene mountain landscape'
      );

      assert.strictEqual(result.choice, 'A', 'Should indicate winner');
      assert.ok(result.explanation, 'Should provide explanation');
      assert.ok(typeof result.confidence === 'number', 'Should have numeric confidence');
      assert.ok(result.confidence >= 0 && result.confidence <= 1, 'Confidence should be 0-1');
    });

    it('should handle ties/uncertain comparisons', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'TIE',
        explanation: 'Both images equally capture the prompt',
        confidence: 0.45  // Low confidence indicates tie
      });

      const result = await provider.compareImages(
        '/path/to/imageA.png',
        '/path/to/imageB.png',
        'abstract art'
      );

      assert.ok(['A', 'B', 'TIE'].includes(result.choice), 'Should handle ties');
    });

    it('should call VLM service /compare endpoint', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      let calledUrl = null;
      let calledData = null;

      provider._axios = {
        post: async (url, data) => {
          calledUrl = url;
          calledData = data;
          return { data: { choice: 'A', explanation: 'Test', confidence: 0.8 } };
        }
      };

      await provider.compareImages('/a.png', '/b.png', 'test prompt');

      assert.ok(calledUrl.includes('/compare'), 'Should call /compare endpoint');
      assert.ok(calledData.imageA || calledData.image_a, 'Should send imageA');
      assert.ok(calledData.imageB || calledData.image_b, 'Should send imageB');
      assert.ok(calledData.prompt, 'Should send prompt');
    });
  });

  describe('rankImages (batch comparison)', () => {
    it('should implement ImageRanker interface', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      assert.strictEqual(typeof provider.rankImages, 'function', 'Should have rankImages method');
    });

    it('should rank multiple images using pairwise comparisons', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Mock multiple comparisons
      let comparisonCount = 0;
      provider._axios = {
        post: async () => {
          comparisonCount++;
          // Alternate winners to test sorting
          return { data: { choice: comparisonCount % 2 === 0 ? 'A' : 'B', confidence: 0.8 } };
        }
      };

      const images = [
        { localPath: '/img1.png', metadata: { id: 1 } },
        { localPath: '/img2.png', metadata: { id: 2 } },
        { localPath: '/img3.png', metadata: { id: 3 } }
      ];

      const result = await provider.rankImages(images, 'test prompt');

      // Should return object with rankings array and metadata
      assert.ok(result.rankings, 'Should return rankings');
      assert.ok(Array.isArray(result.rankings), 'rankings should be array');
      assert.strictEqual(result.rankings.length, images.length, 'Should return all images');
      assert.ok(result.rankings[0].rank !== undefined, 'Should have rank property');
      assert.ok(result.metadata, 'Should have metadata');
      assert.ok(Array.isArray(result.metadata.errors), 'Should have errors array in metadata');
    });

    it('should perform O(n log n) comparisons using sorting', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      let comparisonCount = 0;
      provider._axios = {
        post: async () => {
          comparisonCount++;
          return { data: { choice: 'A', confidence: 0.8 } };
        }
      };

      const images = Array(8).fill(null).map((_, i) => ({
        localPath: `/img${i}.png`,
        metadata: { id: i }
      }));

      await provider.rankImages(images, 'test');

      // n log n comparisons for 8 items: ~24 comparisons max
      // Should be less than n^2/2 = 28 for naive approach
      assert.ok(comparisonCount <= 30, `Should use efficient sorting (got ${comparisonCount} comparisons)`);
    });
  });

  describe('Health Check', () => {
    it('should have healthCheck method', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      assert.strictEqual(typeof provider.healthCheck, 'function', 'Should have healthCheck method');
    });

    it('should return service health status', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        status: 'healthy',
        model_loaded: true,
        model: 'llava-v1.6-mistral-7b.Q4_K_M.gguf'
      });

      const health = await provider.healthCheck();

      assert.ok(health, 'Should return health object');
      assert.strictEqual(health.status, 'healthy');
    });

    it('should return gpu_layers in health check for GPU usage verification', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        status: 'healthy',
        model_repo: 'jartine/llava-v1.6-mistral-7b-gguf',
        model_file: '*Q4_K_M.gguf',
        gpu_layers: -1,
        model_loaded: true
      });

      const health = await provider.healthCheck();

      assert.ok(health.gpu_layers !== undefined, 'Should include gpu_layers');
      assert.strictEqual(health.gpu_layers, -1, 'Should indicate all layers on GPU');
      assert.strictEqual(health.model_loaded, true, 'Model should be loaded');
    });
  });

  describe('🔴 Multi-Factor Comparison Interface (OpenAI Drop-In Replacement)', () => {
    // These tests ensure VLM returns the same structured feedback as OpenAI ImageRanker
    // Required for CritiqueGenerator to produce meaningful refinement guidance

    it('should return alignment and aesthetics ranks in compareImages', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      // Mock response with multi-factor evaluation
      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Image A better matches the prompt',
        confidence: 0.85,
        ranks: {
          A: { alignment: 1, aesthetics: 2 },
          B: { alignment: 2, aesthetics: 1 }
        },
        winner_strengths: ['Good prompt adherence', 'Clear subject'],
        loser_weaknesses: ['Poor lighting', 'Blurry details'],
        improvement_suggestion: 'Add better lighting details to the prompt'
      });

      const result = await provider.compareImages('/a.png', '/b.png', 'test prompt');

      // Should have multi-factor ranks
      assert.ok(result.ranks, 'Should return ranks object');
      assert.ok(result.ranks.A, 'Should have ranks for image A');
      assert.ok(result.ranks.B, 'Should have ranks for image B');
      assert.strictEqual(result.ranks.A.alignment, 1, 'Image A should rank 1 in alignment');
      assert.strictEqual(result.ranks.A.aesthetics, 2, 'Image A should rank 2 in aesthetics');
    });

    it('should return winner strengths and loser weaknesses', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'B',
        explanation: 'Image B has better composition',
        confidence: 0.9,
        ranks: {
          A: { alignment: 2, aesthetics: 2 },
          B: { alignment: 1, aesthetics: 1 }
        },
        winner_strengths: ['Excellent composition', 'Vibrant colors'],
        loser_weaknesses: ['Misses key prompt elements', 'Dull colors'],
        improvement_suggestion: 'Include more vivid color descriptions'
      });

      const result = await provider.compareImages('/a.png', '/b.png', 'vibrant landscape');

      assert.ok(Array.isArray(result.winnerStrengths), 'Should have winnerStrengths array');
      assert.ok(result.winnerStrengths.length > 0, 'Should have at least one strength');
      assert.ok(Array.isArray(result.loserWeaknesses), 'Should have loserWeaknesses array');
      assert.ok(result.loserWeaknesses.length > 0, 'Should have at least one weakness');
    });

    it('should return improvement suggestion for CritiqueGenerator', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Image A captures the mood better',
        confidence: 0.75,
        ranks: {
          A: { alignment: 1, aesthetics: 1 },
          B: { alignment: 2, aesthetics: 2 }
        },
        winner_strengths: ['Captures mood well'],
        loser_weaknesses: ['Lacks atmosphere'],
        improvement_suggestion: 'Add atmospheric lighting terms like "golden hour" or "soft diffused light"'
      });

      const result = await provider.compareImages('/a.png', '/b.png', 'moody portrait');

      assert.ok(result.improvementSuggestion, 'Should return improvement suggestion');
      assert.strictEqual(typeof result.improvementSuggestion, 'string', 'Should be a string');
      assert.ok(result.improvementSuggestion.length > 10, 'Should be a meaningful suggestion');
    });

    it('should calculate combined rank score (70% alignment, 30% aesthetics)', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Image A wins on alignment despite lower aesthetics',
        confidence: 0.8,
        ranks: {
          A: { alignment: 1, aesthetics: 2 },  // Combined: 0.7*1 + 0.3*2 = 1.3
          B: { alignment: 2, aesthetics: 1 }   // Combined: 0.7*2 + 0.3*1 = 1.7
        },
        winner_strengths: ['Strong prompt match'],
        loser_weaknesses: ['Weak prompt adherence'],
        improvement_suggestion: 'Improve prompt clarity'
      });

      const result = await provider.compareImages('/a.png', '/b.png', 'test prompt');

      // Should have combined scores calculated
      assert.ok(result.ranks.A.combined !== undefined, 'Should have combined score for A');
      assert.ok(result.ranks.B.combined !== undefined, 'Should have combined score for B');
      // A should win (lower combined is better): 1.3 < 1.7
      assert.ok(result.ranks.A.combined < result.ranks.B.combined, 'A should have lower (better) combined score');
    });

    it('should include structured feedback in rankImages results for CritiqueGenerator', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Track all responses
      let callCount = 0;
      provider._axios = {
        post: async () => {
          callCount++;
          return {
            data: {
              choice: callCount % 2 === 0 ? 'A' : 'B',
              explanation: `Comparison ${callCount}`,
              confidence: 0.8,
              ranks: {
                A: { alignment: callCount % 2 === 0 ? 1 : 2, aesthetics: 1 },
                B: { alignment: callCount % 2 === 0 ? 2 : 1, aesthetics: 2 }
              },
              winner_strengths: ['Good quality'],
              loser_weaknesses: ['Could improve'],
              improvement_suggestion: 'Add more detail'
            }
          };
        }
      };

      const images = [
        { localPath: '/img1.png', candidateId: 1 },
        { localPath: '/img2.png', candidateId: 2 },
        { localPath: '/img3.png', candidateId: 3 }
      ];

      const result = await provider.rankImages(images, 'test prompt');
      const ranked = result.rankings;

      // Top-ranked image should have feedback for CritiqueGenerator
      const winner = ranked.find(r => r.rank === 1);
      assert.ok(winner, 'Should have a rank 1 winner');
      assert.ok(winner.strengths || winner.reason, 'Winner should have strengths or reason');
    });

    it('should match ImageRanker.compareTwo() return structure', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Full structured response',
        confidence: 0.85,
        ranks: {
          A: { alignment: 1, aesthetics: 1 },
          B: { alignment: 2, aesthetics: 2 }
        },
        winner_strengths: ['Strength 1', 'Strength 2'],
        loser_weaknesses: ['Weakness 1'],
        improvement_suggestion: 'Actionable improvement'
      });

      const result = await provider.compareImages('/a.png', '/b.png', 'prompt');

      // Verify complete structure matches ImageRanker.compareTwo()
      const expectedKeys = ['choice', 'explanation', 'confidence', 'ranks', 'winnerStrengths', 'loserWeaknesses', 'improvementSuggestion'];
      for (const key of expectedKeys) {
        assert.ok(result[key] !== undefined, `Should have ${key} property`);
      }
    });
  });

  describe('Position Bias Mitigation', () => {
    it('should have _mapResultBack method for swapping results', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      assert.strictEqual(typeof provider._mapResultBack, 'function', 'Should have _mapResultBack method');
    });

    it('should map result back correctly when swapped (A becomes B)', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      const originalResult = {
        choice: 'A',
        explanation: 'First image won',
        confidence: 0.8,
        ranks: {
          A: { alignment: 1, aesthetics: 1 },
          B: { alignment: 2, aesthetics: 2 }
        }
      };

      // When swapped, VLM's "A" was actually our "B"
      const mapped = provider._mapResultBack(originalResult, true);

      assert.strictEqual(mapped.choice, 'B', 'A should become B when swapped');
      assert.strictEqual(mapped.ranks.A.alignment, 2, 'Original A should get B ranks');
      assert.strictEqual(mapped.ranks.B.alignment, 1, 'Original B should get A ranks');
    });

    it('should map result back correctly when swapped (B becomes A)', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      const originalResult = {
        choice: 'B',
        explanation: 'Second image won',
        confidence: 0.7,
        ranks: {
          A: { alignment: 2, aesthetics: 2 },
          B: { alignment: 1, aesthetics: 1 }
        }
      };

      // When swapped, VLM's "B" was actually our "A"
      const mapped = provider._mapResultBack(originalResult, true);

      assert.strictEqual(mapped.choice, 'A', 'B should become A when swapped');
    });

    it('should preserve TIE choice when mapping back', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      const tieResult = {
        choice: 'TIE',
        explanation: 'Equal quality',
        confidence: 0.5,
        ranks: {
          A: { alignment: 1, aesthetics: 2 },
          B: { alignment: 2, aesthetics: 1 }
        }
      };

      const mapped = provider._mapResultBack(tieResult, true);

      assert.strictEqual(mapped.choice, 'TIE', 'TIE should stay TIE');
    });

    it('should not alter result when not swapped', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      const originalResult = {
        choice: 'A',
        explanation: 'First image won',
        confidence: 0.8,
        ranks: {
          A: { alignment: 1, aesthetics: 1 },
          B: { alignment: 2, aesthetics: 2 }
        }
      };

      const mapped = provider._mapResultBack(originalResult, false);

      assert.strictEqual(mapped.choice, 'A', 'A should stay A when not swapped');
      assert.strictEqual(mapped.ranks.A.alignment, 1, 'Ranks should be unchanged');
    });

    it('should have compareWithDebiasing method', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      assert.strictEqual(typeof provider.compareWithDebiasing, 'function', 'Should have compareWithDebiasing method');
    });

    it('should swap image order approximately 50% of the time', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Track which order images are sent
      let firstImagePaths = [];
      provider._axios = {
        post: async (url, data) => {
          firstImagePaths.push(data.image_a);
          return {
            data: {
              choice: 'A',
              explanation: 'test',
              confidence: 0.8,
              ranks: { A: { alignment: 1 }, B: { alignment: 2 } }
            }
          };
        }
      };

      // Run many comparisons
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        await provider.compareWithDebiasing('/imgA.png', '/imgB.png', 'test');
      }

      // Count how many times A was first
      const aFirstCount = firstImagePaths.filter(p => p === '/imgA.png').length;
      const bFirstCount = firstImagePaths.filter(p => p === '/imgB.png').length;

      // Should be roughly 50/50 (allowing for randomness variance)
      // With 100 iterations, expect between 30-70 for each
      assert.ok(aFirstCount >= 30 && aFirstCount <= 70,
        `A should be first ~50% of time (got ${aFirstCount}%)`);
      assert.ok(bFirstCount >= 30 && bFirstCount <= 70,
        `B should be first ~50% of time (got ${bFirstCount}%)`);
    });

    it('should correctly map result back after random swap', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Always return 'A' as winner (simulating position bias)
      let callOrder = [];
      provider._axios = {
        post: async (url, data) => {
          callOrder.push({ first: data.image_a, second: data.image_b });
          return {
            data: {
              choice: 'A', // Always first image wins (position bias)
              explanation: 'First is best',
              confidence: 0.9,
              ranks: {
                A: { alignment: 1, aesthetics: 1 },
                B: { alignment: 2, aesthetics: 2 }
              }
            }
          };
        }
      };

      // Run many comparisons - if debiasing works, winners should be balanced
      const iterations = 100;
      let aWins = 0, bWins = 0;

      for (let i = 0; i < iterations; i++) {
        const result = await provider.compareWithDebiasing('/imgA.png', '/imgB.png', 'test');
        if (result.choice === 'A') aWins++;
        else if (result.choice === 'B') bWins++;
      }

      // With position bias and 50% swapping, A and B should win roughly equally
      assert.ok(aWins >= 30 && aWins <= 70,
        `A wins should be ~50% (got ${aWins}%)`);
      assert.ok(bWins >= 30 && bWins <= 70,
        `B wins should be ~50% (got ${bWins}%)`);
    });
  });

  describe('Ensemble Voting', () => {
    it('should have compareWithEnsemble method', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      assert.strictEqual(typeof provider.compareWithEnsemble, 'function', 'Should have compareWithEnsemble method');
    });

    it('should return single comparison result when ensembleSize=1', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Mock single comparison
      provider._axios = {
        post: async () => ({
          data: {
            choice: 'A',
            reasoning: 'Image A is better',
            ranks: { A: { alignment: 1 }, B: { alignment: 2 } }
          }
        })
      };

      const result = await provider.compareWithEnsemble('/imgA.png', '/imgB.png', 'test', { ensembleSize: 1 });
      assert.strictEqual(result.choice, 'A');
      assert.ok(result.explanation || result.choice, 'Should have explanation or choice');
    });

    it('should use majority voting with ensembleSize=3', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Mock Math.random to disable swapping (always return >= 0.5)
      const originalRandom = Math.random;
      Math.random = () => 0.7;

      let callCount = 0;
      // Mock: A wins twice, B wins once -> A should win
      provider._axios = {
        post: async () => {
          callCount++;
          const choice = callCount === 2 ? 'B' : 'A';
          return {
            data: {
              choice,
              reasoning: `Image ${choice} is better`,
              ranks: choice === 'A'
                ? { A: { alignment: 1 }, B: { alignment: 2 } }
                : { A: { alignment: 2 }, B: { alignment: 1 } }
            }
          };
        }
      };

      try {
        const result = await provider.compareWithEnsemble('/imgA.png', '/imgB.png', 'test', { ensembleSize: 3 });

        assert.strictEqual(callCount, 3, 'Should make 3 comparisons');
        assert.strictEqual(result.choice, 'A', 'A should win with 2/3 votes');
        assert.ok(result.votes, 'Should include vote counts');
        assert.strictEqual(result.votes.A, 2);
        assert.strictEqual(result.votes.B, 1);
      } finally {
        Math.random = originalRandom;
      }
    });

    it('should handle TIE when votes are split evenly', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      let callCount = 0;
      // Mock: A wins once, B wins once, TIE once -> should be TIE
      provider._axios = {
        post: async () => {
          callCount++;
          const choices = ['A', 'B', 'TIE'];
          const choice = choices[callCount - 1];
          return {
            data: {
              choice,
              reasoning: `Result ${choice}`,
              ranks: { A: { alignment: 1 }, B: { alignment: 2 } }
            }
          };
        }
      };

      const result = await provider.compareWithEnsemble('/imgA.png', '/imgB.png', 'test', { ensembleSize: 3 });

      assert.strictEqual(callCount, 3, 'Should make 3 comparisons');
      assert.strictEqual(result.choice, 'TIE', 'Should be TIE when no majority');
    });

    it('should apply position debiasing in each ensemble vote', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      const imageOrders = [];
      provider._axios = {
        post: async (url, data) => {
          // Track which image was sent first (image_a is the first image)
          imageOrders.push(data.image_a);
          return {
            data: {
              choice: 'A',
              reasoning: 'First image wins',
              ranks: { A: { alignment: 1 }, B: { alignment: 2 } }
            }
          };
        }
      };

      // Run 20 comparisons to statistically verify random swapping
      for (let i = 0; i < 20; i++) {
        await provider.compareWithEnsemble('/imgA.png', '/imgB.png', 'test', { ensembleSize: 1 });
      }

      // With 50% swap rate, we should see both orderings
      const imgAFirst = imageOrders.filter(img => img === '/imgA.png').length;
      const imgBFirst = imageOrders.filter(img => img === '/imgB.png').length;

      // Allow wide margin for randomness (expect 5-15 of each in 20 trials)
      assert.ok(imgAFirst >= 3 && imgAFirst <= 17,
        `Random swapping should produce mixed orders (A first: ${imgAFirst}/20)`);
      assert.ok(imgBFirst >= 3 && imgBFirst <= 17,
        `Random swapping should produce mixed orders (B first: ${imgBFirst}/20)`);
    });

    it('should use defaultEnsembleSize from constructor', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({
        apiUrl: 'http://localhost:8004',
        defaultEnsembleSize: 5
      });
      assert.strictEqual(provider.defaultEnsembleSize, 5, 'Should store defaultEnsembleSize');
    });

    it('should default to ensembleSize=3', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      // Clear env var
      const original = process.env.VLM_ENSEMBLE_SIZE;
      delete process.env.VLM_ENSEMBLE_SIZE;

      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      assert.strictEqual(provider.defaultEnsembleSize, 3, 'Default ensembleSize should be 3');

      if (original) process.env.VLM_ENSEMBLE_SIZE = original;
    });

    it('should aggregate ranks from ensemble votes', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      let callCount = 0;
      // Mock varied rank scores
      provider._axios = {
        post: async () => {
          callCount++;
          return {
            data: {
              choice: 'A',
              reasoning: 'A is better',
              ranks: {
                A: { alignment: callCount, aesthetics: callCount * 2 },
                B: { alignment: callCount + 1, aesthetics: callCount * 2 + 1 }
              }
            }
          };
        }
      };

      const result = await provider.compareWithEnsemble('/imgA.png', '/imgB.png', 'test', 3);

      // Should have aggregated ranks (averaged or from winning votes)
      assert.ok(result.ranks, 'Should have aggregated ranks');
      assert.ok(result.ranks.A, 'Should have ranks for A');
      assert.ok(result.ranks.B, 'Should have ranks for B');
    });
  });

  describe('Error Handling', () => {
    it('should handle service unavailable', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = {
        post: async () => { throw new Error('ECONNREFUSED'); }
      };

      await assert.rejects(
        () => provider.compareImages('/a.png', '/b.png', 'test'),
        /unavailable|ECONNREFUSED|connection/i,
        'Should indicate service unavailable'
      );
    });

    it('should handle invalid image paths', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = {
        post: async () => { throw new Error('File not found'); }
      };

      await assert.rejects(
        () => provider.compareImages('/nonexistent.png', '/also-missing.png', 'test'),
        /not found|invalid/i,
        'Should handle missing files'
      );
    });

    it('should handle model not loaded', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = {
        post: async () => {
          const err = new Error('Model not loaded');
          err.response = { status: 503, data: { detail: 'Model not loaded' } };
          throw err;
        }
      };

      await assert.rejects(
        () => provider.compareImages('/a.png', '/b.png', 'test'),
        /not loaded|503/i,
        'Should indicate model not loaded'
      );
    });
  });
});

describe('VLM Service Python Tests (Integration)', () => {
  // These tests check that the Python service file exists and has correct structure

  it('should have vlm_service.py in services directory', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    assert.ok(fs.existsSync(servicePath), 'vlm_service.py should exist');
  });

  it('should have /compare endpoint in vlm_service.py', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    assert.ok(content.includes('/compare'), 'Should have /compare endpoint');
    assert.ok(content.includes('llama_cpp') || content.includes('Llama'),
      'Should use llama-cpp-python');
  });

  it('should support multimodal models in vlm_service.py', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    // Check for image handling or multimodal support
    assert.ok(
      content.includes('image') ||
      content.includes('vision') ||
      content.includes('chat_handler'),
      'Should handle images/vision'
    );
  });

  it('should have /load and /unload endpoints for GPU coordination', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    assert.ok(content.includes('/load'), 'Should have /load endpoint');
    assert.ok(content.includes('/unload'), 'Should have /unload endpoint');
  });

  it('🔴 should request multi-factor evaluation in comparison prompt', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    // Should ask for alignment and aesthetics separately
    assert.ok(
      content.includes('alignment') || content.includes('prompt_match') || content.includes('prompt adherence'),
      'Should evaluate alignment/prompt adherence'
    );
    assert.ok(
      content.includes('aesthetics') || content.includes('aesthetic') || content.includes('visual quality'),
      'Should evaluate aesthetics/visual quality'
    );
  });

  it('🔴 should return structured response with ranks, strengths, weaknesses', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    // CompareResponse model should include these fields
    assert.ok(
      content.includes('ranks') || content.includes('alignment_rank'),
      'Response should include ranks'
    );
    assert.ok(
      content.includes('winner_strengths') || content.includes('strengths'),
      'Response should include strengths'
    );
    assert.ok(
      content.includes('loser_weaknesses') || content.includes('weaknesses'),
      'Response should include weaknesses'
    );
    assert.ok(
      content.includes('improvement_suggestion') || content.includes('improvement'),
      'Response should include improvement suggestion'
    );
  });
});
