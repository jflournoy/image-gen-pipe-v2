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

  describe('processCandidateStream', () => {
    test('should combine, generate image, and score in sequence', async () => {
      const { processCandidateStream } = require('../../src/orchestrator/beam-search.js');

      // Mock providers
      const mockLLM = {
        combinePrompts: async (what, how) => `${what} with ${how}`
      };

      const mockImageGen = {
        generateImage: async (prompt, options) => ({
          url: 'https://example.com/image.png',
          localPath: '/tmp/image.png',
          revisedPrompt: prompt,
          metadata: { model: 'dall-e-3', size: options.size }
        })
      };

      const mockVision = {
        analyzeImage: async (imageUrl, prompt) => ({
          alignmentScore: 85,
          aestheticScore: 7.5,
          analysis: 'Good image',
          strengths: ['composition'],
          weaknesses: ['lighting'],
          metadata: { tokensUsed: 100 }
        })
      };

      const whatPrompt = 'a mountain landscape';
      const howPrompt = 'oil painting style';
      const options = {
        iteration: 0,
        candidateId: 0,
        dimension: 'what'
      };

      const result = await processCandidateStream(
        whatPrompt,
        howPrompt,
        mockLLM,
        mockImageGen,
        mockVision,
        options
      );

      // Verify result structure
      assert.strictEqual(result.whatPrompt, whatPrompt, 'Should preserve whatPrompt');
      assert.strictEqual(result.howPrompt, howPrompt, 'Should preserve howPrompt');
      assert.strictEqual(result.combined, 'a mountain landscape with oil painting style', 'Should combine prompts');
      assert.strictEqual(result.image.url, 'https://example.com/image.png', 'Should generate image');
      assert.strictEqual(result.evaluation.alignmentScore, 85, 'Should evaluate alignment');
      assert.strictEqual(result.evaluation.aestheticScore, 7.5, 'Should evaluate aesthetic');
      assert.ok(result.totalScore, 'Should calculate total score');

      // Verify totalScore calculation
      const expectedScore = 0.7 * 85 + 0.3 * (7.5 * 10); // 59.5 + 22.5 = 82
      assert.strictEqual(result.totalScore, expectedScore, 'Should calculate correct total score');
    });

    test('should use custom alpha for total score calculation', async () => {
      const { processCandidateStream } = require('../../src/orchestrator/beam-search.js');

      const mockLLM = { combinePrompts: async (w, h) => `${w} ${h}` };
      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };
      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80,
          aestheticScore: 8,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const result = await processCandidateStream(
        'what', 'how', mockLLM, mockImageGen, mockVision,
        { iteration: 0, candidateId: 0, alpha: 0.5 } // Custom alpha
      );

      // Expected: 0.5 * 80 + 0.5 * 80 = 80
      assert.strictEqual(result.totalScore, 80, 'Should use custom alpha');
    });

    test('should pass options to image generation', async () => {
      const { processCandidateStream } = require('../../src/orchestrator/beam-search.js');

      let capturedOptions;
      const mockLLM = { combinePrompts: async (w, h) => `${w} ${h}` };
      const mockImageGen = {
        generateImage: async (prompt, options) => {
          capturedOptions = options;
          return { url: 'test.png', metadata: {} };
        }
      };
      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 8,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const options = {
        iteration: 2,
        candidateId: 5,
        dimension: 'how',
        size: '1024x1024',
        quality: 'hd'
      };

      await processCandidateStream(
        'what', 'how', mockLLM, mockImageGen, mockVision, options
      );

      assert.strictEqual(capturedOptions.iteration, 2, 'Should pass iteration');
      assert.strictEqual(capturedOptions.candidateId, 5, 'Should pass candidateId');
      assert.strictEqual(capturedOptions.dimension, 'how', 'Should pass dimension');
      assert.strictEqual(capturedOptions.size, '1024x1024', 'Should pass size');
      assert.strictEqual(capturedOptions.quality, 'hd', 'Should pass quality');
    });

    test('should include metadata in result', async () => {
      const { processCandidateStream } = require('../../src/orchestrator/beam-search.js');

      const mockLLM = { combinePrompts: async (w, h) => `${w} ${h}` };
      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };
      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 8,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const options = {
        iteration: 1,
        candidateId: 3,
        dimension: 'what',
        parentId: 0
      };

      const result = await processCandidateStream(
        'what', 'how', mockLLM, mockImageGen, mockVision, options
      );

      assert.ok(result.metadata, 'Should have metadata');
      assert.strictEqual(result.metadata.iteration, 1, 'Should include iteration in metadata');
      assert.strictEqual(result.metadata.candidateId, 3, 'Should include candidateId in metadata');
      assert.strictEqual(result.metadata.dimension, 'what', 'Should include dimension in metadata');
      assert.strictEqual(result.metadata.parentId, 0, 'Should include parentId in metadata');
    });
  });
});
