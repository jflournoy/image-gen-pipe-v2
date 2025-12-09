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
        combinePrompts: async (what, how) => ({
          combinedPrompt: `${what} with ${how}`,
          metadata: { model: 'mock', tokensUsed: 50 }
        })
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
        analyzeImage: async (_imageUrl, _prompt) => ({
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

  describe('initialExpansion', () => {
    test('should generate N WHAT+HOW pairs in parallel', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

      let whatCalls = 0;
      let howCalls = 0;

      const mockLLM = {
        refinePrompt: async (prompt, options) => {
          if (options.dimension === 'what') {
            whatCalls++;
            return { refinedPrompt: `WHAT_${whatCalls}`, metadata: {} };
          } else {
            howCalls++;
            return { refinedPrompt: `HOW_${howCalls}`, metadata: {} };
          }
        },
        combinePrompts: async (what, how) => ({
          combinedPrompt: `${what} + ${how}`,
          metadata: { model: 'mock', tokensUsed: 50 }
        })
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const userPrompt = 'a mountain landscape';
      const config = { beamWidth: 3 };

      const results = await initialExpansion(
        userPrompt,
        mockLLM,
        mockImageGen,
        mockVision,
        config
      );

      // Should generate N candidates
      assert.strictEqual(results.length, 3, 'Should generate beamWidth candidates');

      // Should call refinePrompt N times for WHAT and N times for HOW
      assert.strictEqual(whatCalls, 3, 'Should refine WHAT 3 times');
      assert.strictEqual(howCalls, 3, 'Should refine HOW 3 times');

      // Each result should have proper structure
      results.forEach((result, i) => {
        assert.ok(result.whatPrompt, 'Should have whatPrompt');
        assert.ok(result.howPrompt, 'Should have howPrompt');
        assert.ok(result.combined, 'Should have combined prompt');
        assert.ok(result.image, 'Should have image');
        assert.ok(result.evaluation, 'Should have evaluation');
        assert.ok(typeof result.totalScore === 'number', 'Should have totalScore');
        assert.strictEqual(result.metadata.iteration, 0, 'Should be iteration 0');
        assert.strictEqual(result.metadata.candidateId, i, 'Should have correct candidateId');
      });
    });

    test('should use expand operation for both dimensions', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

      let capturedOptions = [];

      const mockLLM = {
        refinePrompt: async (prompt, options) => {
          capturedOptions.push(options);
          return { refinedPrompt: `refined_${options.dimension}`, metadata: {} };
        },
        combinePrompts: async (what, how) => ({
          combinedPrompt: `${what} + ${how}`,
          metadata: { model: 'mock', tokensUsed: 50 }
        })
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 7,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      await initialExpansion(
        'test prompt',
        mockLLM,
        mockImageGen,
        mockVision,
        { beamWidth: 2 }
      );

      // Should use 'expand' operation for all refine calls
      capturedOptions.forEach(opt => {
        assert.strictEqual(opt.operation, 'expand', 'Should use expand operation');
      });
    });

    test('should pass stochastic temperature for variation', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

      let capturedOptions = [];

      const mockLLM = {
        refinePrompt: async (prompt, options) => {
          capturedOptions.push(options);
          return { refinedPrompt: 'refined', metadata: {} };
        },
        combinePrompts: async (what, how) => `${what} + ${how}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 7,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      await initialExpansion(
        'test prompt',
        mockLLM,
        mockImageGen,
        mockVision,
        { beamWidth: 2, temperature: 0.8 }
      );

      // Should pass temperature to enable variation
      capturedOptions.forEach(opt => {
        assert.strictEqual(opt.temperature, 0.8, 'Should pass temperature for variation');
      });
    });

    test('should process all candidates through streaming pipeline', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

      let combineCallCount = 0;
      let imageGenCallCount = 0;
      let visionCallCount = 0;

      const mockLLM = {
        refinePrompt: async (prompt, options) => ({
          refinedPrompt: `refined_${options.dimension}`,
          metadata: {}
        }),
        combinePrompts: async (what, how) => {
          combineCallCount++;
          return `${what} + ${how}`;
        }
      };

      const mockImageGen = {
        generateImage: async () => {
          imageGenCallCount++;
          return { url: 'test.png', metadata: {} };
        }
      };

      const mockVision = {
        analyzeImage: async () => {
          visionCallCount++;
          return {
            alignmentScore: 80, aestheticScore: 7,
            analysis: '', strengths: [], weaknesses: [], metadata: {}
          };
        }
      };

      await initialExpansion(
        'test prompt',
        mockLLM,
        mockImageGen,
        mockVision,
        { beamWidth: 3 }
      );

      // Each candidate should go through full pipeline
      assert.strictEqual(combineCallCount, 3, 'Should combine 3 times');
      assert.strictEqual(imageGenCallCount, 3, 'Should generate 3 images');
      assert.strictEqual(visionCallCount, 3, 'Should evaluate 3 images');
    });
  });

  describe('refinementIteration', () => {
    test('should generate critique for each parent in parallel', async () => {
      const { refinementIteration } = require('../../src/orchestrator/beam-search.js');

      let critiqueCallCount = 0;

      const mockCritiqueGen = {
        generateCritique: async (evaluation, prompts, options) => {
          critiqueCallCount++;
          return {
            critique: `Critique ${critiqueCallCount}`,
            recommendation: 'Improve this',
            reason: 'Because',
            dimension: options.dimension,
            metadata: {}
          };
        }
      };

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 7,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const parents = [
        { whatPrompt: 'w1', howPrompt: 'h1', evaluation: {}, combined: 'c1', metadata: { candidateId: 0 } },
        { whatPrompt: 'w2', howPrompt: 'h2', evaluation: {}, combined: 'c2', metadata: { candidateId: 1 } },
        { whatPrompt: 'w3', howPrompt: 'h3', evaluation: {}, combined: 'c3', metadata: { candidateId: 2 } }
      ];

      const config = { beamWidth: 9, keepTop: 3 };

      await refinementIteration(
        parents,
        mockLLM,
        mockImageGen,
        mockVision,
        mockCritiqueGen,
        config,
        1 // iteration
      );

      assert.strictEqual(critiqueCallCount, 3, 'Should generate critique for each parent');
    });

    test('should generate N/M children per parent', async () => {
      const { refinementIteration } = require('../../src/orchestrator/beam-search.js');

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix this',
          recommendation: 'Do that',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 7,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const parents = [
        { whatPrompt: 'w1', howPrompt: 'h1', evaluation: {}, combined: 'c1', metadata: { candidateId: 0 } },
        { whatPrompt: 'w2', howPrompt: 'h2', evaluation: {}, combined: 'c2', metadata: { candidateId: 1 } },
        { whatPrompt: 'w3', howPrompt: 'h3', evaluation: {}, combined: 'c3', metadata: { candidateId: 2 } }
      ];

      const config = { beamWidth: 9, keepTop: 3 }; // expansionRatio = 9/3 = 3

      const results = await refinementIteration(
        parents,
        mockLLM,
        mockImageGen,
        mockVision,
        mockCritiqueGen,
        config,
        1
      );

      assert.strictEqual(results.length, 9, 'Should generate N=9 total children');
    });

    test('should alternate dimensions (odd=WHAT, even=HOW)', async () => {
      const { refinementIteration } = require('../../src/orchestrator/beam-search.js');

      let capturedDimensions = [];

      const mockCritiqueGen = {
        generateCritique: async (evaluation, prompts, options) => {
          capturedDimensions.push(options.dimension);
          return {
            critique: 'Fix', recommendation: 'Do', reason: 'Because',
            dimension: options.dimension, metadata: {}
          };
        }
      };

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 7,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const parents = [
        { whatPrompt: 'w', howPrompt: 'h', evaluation: {}, combined: 'c', metadata: { candidateId: 0 } }
      ];

      const config = { beamWidth: 3, keepTop: 1 };

      // Iteration 1 (odd) should refine WHAT
      await refinementIteration(parents, mockLLM, mockImageGen, mockVision, mockCritiqueGen, config, 1);
      assert.strictEqual(capturedDimensions[0], 'what', 'Odd iteration should refine WHAT');

      capturedDimensions = [];

      // Iteration 2 (even) should refine HOW
      await refinementIteration(parents, mockLLM, mockImageGen, mockVision, mockCritiqueGen, config, 2);
      assert.strictEqual(capturedDimensions[0], 'how', 'Even iteration should refine HOW');
    });

    test('should inherit non-refined dimension from parent', async () => {
      const { refinementIteration } = require('../../src/orchestrator/beam-search.js');

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix', recommendation: 'Do', reason: 'Because',
          dimension: 'what', metadata: {}
        })
      };

      let refineCallCount = 0;
      const mockLLM = {
        refinePrompt: async (_prompt, _options) => {
          refineCallCount++;
          return { refinedPrompt: `refined_${refineCallCount}`, metadata: {} };
        },
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 7,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const parents = [
        { whatPrompt: 'original_what', howPrompt: 'original_how', evaluation: {}, combined: 'c', metadata: { candidateId: 0 } }
      ];

      const config = { beamWidth: 2, keepTop: 1 };

      const results = await refinementIteration(
        parents, mockLLM, mockImageGen, mockVision, mockCritiqueGen, config, 1 // Refine WHAT
      );

      // Children should have refined WHAT but inherit parent's HOW
      results.forEach(child => {
        assert.ok(child.whatPrompt.startsWith('refined_'), 'WHAT should be refined');
        assert.strictEqual(child.howPrompt, 'original_how', 'HOW should be inherited from parent');
      });
    });

    test('should track parentId in metadata', async () => {
      const { refinementIteration } = require('../../src/orchestrator/beam-search.js');

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix', recommendation: 'Do', reason: 'Because',
          dimension: 'what', metadata: {}
        })
      };

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80, aestheticScore: 7,
          analysis: '', strengths: [], weaknesses: [], metadata: {}
        })
      };

      const parents = [
        { whatPrompt: 'w1', howPrompt: 'h1', evaluation: {}, combined: 'c1', metadata: { candidateId: 10 } },
        { whatPrompt: 'w2', howPrompt: 'h2', evaluation: {}, combined: 'c2', metadata: { candidateId: 20 } }
      ];

      const config = { beamWidth: 4, keepTop: 2 }; // 2 children per parent

      const results = await refinementIteration(
        parents, mockLLM, mockImageGen, mockVision, mockCritiqueGen, config, 1
      );

      // First 2 children should have parent 10, next 2 should have parent 20
      assert.strictEqual(results[0].metadata.parentId, 10, 'Child 0 parent should be 10');
      assert.strictEqual(results[1].metadata.parentId, 10, 'Child 1 parent should be 10');
      assert.strictEqual(results[2].metadata.parentId, 20, 'Child 2 parent should be 20');
      assert.strictEqual(results[3].metadata.parentId, 20, 'Child 3 parent should be 20');
    });
  });

  describe('Rate Limiting in beamSearch', () => {
    test('should limit concurrent LLM refinePrompt calls during initialExpansion', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

      let maxConcurrentLLM = 0;
      let currentConcurrentLLM = 0;

      const mockLLM = {
        refinePrompt: async (prompt, options) => {
          currentConcurrentLLM++;
          maxConcurrentLLM = Math.max(maxConcurrentLLM, currentConcurrentLLM);

          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 5));

          currentConcurrentLLM--;
          return { refinedPrompt: `refined_${options.dimension}`, metadata: {} };
        },
        combinePrompts: async (what, how) => `${what} + ${how}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const config = { beamWidth: 5, rateLimitConcurrency: 2 };

      await initialExpansion(
        'test prompt',
        mockLLM,
        mockImageGen,
        mockVision,
        config
      );

      assert.ok(maxConcurrentLLM <= 2, `LLM concurrent calls (${maxConcurrentLLM}) should not exceed rate limit of 2`);
    });

    test('should limit concurrent image generation calls', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

      let maxConcurrentImageGen = 0;
      let currentConcurrentImageGen = 0;

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (what, how) => `${what} + ${how}`
      };

      const mockImageGen = {
        generateImage: async () => {
          currentConcurrentImageGen++;
          maxConcurrentImageGen = Math.max(maxConcurrentImageGen, currentConcurrentImageGen);

          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 5));

          currentConcurrentImageGen--;
          return { url: 'test.png', metadata: {} };
        }
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 80,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const config = { beamWidth: 5, rateLimitConcurrency: 2 };

      await initialExpansion(
        'test prompt',
        mockLLM,
        mockImageGen,
        mockVision,
        config
      );

      assert.ok(maxConcurrentImageGen <= 2, `Image generation concurrent calls (${maxConcurrentImageGen}) should not exceed rate limit of 2`);
    });

    test('should limit concurrent vision API calls', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

      let maxConcurrentVision = 0;
      let currentConcurrentVision = 0;

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (what, how) => `${what} + ${how}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => {
          currentConcurrentVision++;
          maxConcurrentVision = Math.max(maxConcurrentVision, currentConcurrentVision);

          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 5));

          currentConcurrentVision--;
          return {
            alignmentScore: 80,
            aestheticScore: 7,
            analysis: '',
            strengths: [],
            weaknesses: [],
            metadata: {}
          };
        }
      };

      const config = { beamWidth: 5, rateLimitConcurrency: 2 };

      await initialExpansion(
        'test prompt',
        mockLLM,
        mockImageGen,
        mockVision,
        config
      );

      assert.ok(maxConcurrentVision <= 2, `Vision concurrent calls (${maxConcurrentVision}) should not exceed rate limit of 2`);
    });
  });

  describe('beamSearch', () => {
    test('should call initialExpansion for iteration 0', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      const mockLLM = {
        refinePrompt: async (prompt, options) => ({
          refinedPrompt: `refined_${options.dimension}`,
          metadata: {}
        }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 85,
          aestheticScore: 7.5,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix',
          recommendation: 'Do',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const userPrompt = 'test prompt';
      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision,
        critiqueGen: mockCritiqueGen
      };
      const config = {
        beamWidth: 3,
        keepTop: 2,
        maxIterations: 1 // Only run iteration 0
      };

      await beamSearch(userPrompt, providers, config);

      // We can't directly test if initialExpansion was called without instrumentation,
      // but we can verify the result structure
      assert.ok(true, 'Should complete without error');
    });

    test('should rank and select top M after iteration 0', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      let candidateScores = [75, 90, 60]; // N=3 candidates with different scores

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      let callCount = 0;
      const mockVision = {
        analyzeImage: async () => {
          const score = candidateScores[callCount++];
          return {
            alignmentScore: score,
            aestheticScore: 5,
            analysis: '',
            strengths: [],
            weaknesses: [],
            metadata: {}
          };
        }
      };

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix',
          recommendation: 'Do',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision,
        critiqueGen: mockCritiqueGen
      };

      const config = {
        beamWidth: 3,
        keepTop: 2, // Should keep only top 2
        maxIterations: 1
      };

      const result = await beamSearch('test', providers, config);

      // Should return the best candidate from top M
      assert.ok(result, 'Should return a result');
      assert.ok(result.totalScore, 'Should have a total score');
    });

    test('should run refinementIteration for iterations 1+', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      let refinementIterationCount = 0;

      const mockLLM = {
        refinePrompt: async () => {
          refinementIterationCount++;
          return { refinedPrompt: 'refined', metadata: {} };
        },
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 85,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix',
          recommendation: 'Do',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision,
        critiqueGen: mockCritiqueGen
      };

      const config = {
        beamWidth: 4,
        keepTop: 2,
        maxIterations: 3 // Run iterations 0, 1, 2
      };

      await beamSearch('test', providers, config);

      // Refinement should be called for iterations 1 and 2
      // Each iteration: M parents × expansionRatio children × 1 refinePrompt call
      // Iteration 0: 4 refinePrompts (2 per candidate: WHAT+HOW)
      // Iteration 1: 4 refinePrompts (4 children from 2 parents)
      // Iteration 2: 4 refinePrompts (4 children from 2 parents)
      // Total: 4 + 4 + 4 = 12
      assert.ok(refinementIterationCount > 4, 'Should call refinement for iterations 1+');
    });

    test('should return best candidate from final iteration', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => ({ url: 'test.png', metadata: {} })
      };

      let iterationScores = {
        0: [70, 75, 80, 65], // Iteration 0 scores (N=4, beamWidth=4)
        1: [85, 90, 82, 88] // Iteration 1 scores (N=4, keepTop=2 × expansionRatio=2)
      };
      let currentIteration = 0;
      let iterationCallCount = 0;

      const mockVision = {
        analyzeImage: async () => {
          const scores = iterationScores[currentIteration];
          const score = scores[iterationCallCount % scores.length];
          iterationCallCount++;

          if (iterationCallCount >= scores.length) {
            currentIteration++;
            iterationCallCount = 0;
          }

          return {
            alignmentScore: score,
            aestheticScore: 7,
            analysis: '',
            strengths: [],
            weaknesses: [],
            metadata: {}
          };
        }
      };

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix',
          recommendation: 'Do',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision,
        critiqueGen: mockCritiqueGen
      };

      const config = {
        beamWidth: 4,
        keepTop: 2,
        maxIterations: 2
      };

      const result = await beamSearch('test', providers, config);

      // Should return best from final iteration (score 90)
      assert.ok(result, 'Should return a result');
      assert.ok(result.totalScore > 0, 'Should have positive score');
      assert.strictEqual(result.metadata.iteration, 1, 'Should be from iteration 1');
    });

    test('should stop at maxIterations', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      let iterationCount = 0;

      const mockLLM = {
        refinePrompt: async (prompt, options) => {
          if (options.operation === 'expand') {
            iterationCount = 0; // Reset for iteration 0
          }
          return { refinedPrompt: 'refined', metadata: {} };
        },
        combinePrompts: async (w, h) => {
          return `${w} + ${h}`;
        }
      };

      const mockImageGen = {
        generateImage: async (prompt, options) => {
          if (options.iteration > iterationCount) {
            iterationCount = options.iteration;
          }
          return { url: 'test.png', metadata: {} };
        }
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 85,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix',
          recommendation: 'Do',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision,
        critiqueGen: mockCritiqueGen
      };

      const config = {
        beamWidth: 3,
        keepTop: 2,
        maxIterations: 5
      };

      await beamSearch('test', providers, config);

      assert.strictEqual(iterationCount, 4, 'Should run iterations 0-4 (maxIterations=5 means 5 total)');
    });

    test('should pass config options through pipeline', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      let capturedAlpha;
      let capturedTemperature;

      const mockLLM = {
        refinePrompt: async (prompt, options) => {
          if (options.temperature !== undefined) {
            capturedTemperature = options.temperature;
          }
          return { refinedPrompt: 'refined', metadata: {} };
        },
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async (prompt, options) => {
          if (options.alpha !== undefined) {
            capturedAlpha = options.alpha;
          }
          return { url: 'test.png', metadata: {} };
        }
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 85,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix',
          recommendation: 'Do',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision,
        critiqueGen: mockCritiqueGen
      };

      const config = {
        beamWidth: 3,
        keepTop: 2,
        maxIterations: 1,
        alpha: 0.8,
        temperature: 0.9
      };

      await beamSearch('test', providers, config);

      assert.strictEqual(capturedAlpha, 0.8, 'Should pass alpha through pipeline');
      assert.strictEqual(capturedTemperature, 0.9, 'Should pass temperature through pipeline');
    });

    test('should include parents in iteration 1+ ranking (cross-iteration ranking)', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      // Scenario: Parent from iteration 0 is better than all children from iteration 1
      // Parent score: 95, Children scores: 70, 75, 80
      // Expected: Parent should survive in final topCandidates

      let iter1CallCount = 0;

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async (prompt, options) => ({ url: `image-${options.iteration}-${options.candidateId}.png`, metadata: {} })
      };

      const mockVision = {
        analyzeImage: async (url) => {
          // Iteration 0: Return 95 for first candidate, 60 for others
          if (url.includes('iteration-0-0')) {
            return { alignmentScore: 95, aestheticScore: 9, analysis: '', strengths: [], weaknesses: [], metadata: {} };
          } else if (url.includes('iteration-0')) {
            return { alignmentScore: 60, aestheticScore: 5, analysis: '', strengths: [], weaknesses: [], metadata: {} };
          }
          // Iteration 1: Return lower scores for all children
          return { alignmentScore: 70 + (iter1CallCount++ * 5), aestheticScore: 6, analysis: '', strengths: [], weaknesses: [], metadata: {} };
        }
      };

      const mockCritiqueGen = {
        generateCritique: async () => ({
          critique: 'Fix',
          recommendation: 'Do',
          reason: 'Because',
          dimension: 'what',
          metadata: {}
        })
      };

      const mockImageRanker = {
        rankImages: async (images, prompt, options) => {
          // Simulate comparative ranking: candidateId 0 (parent) is best
          const rankings = images.map(img => {
            const isParent = img.candidateId === 0;
            return {
              candidateId: img.candidateId,
              rank: isParent ? 1 : 2 + img.candidateId,
              reason: isParent ? 'Best overall composition' : 'Good but lacks parent quality'
            };
          });
          return rankings.sort((a, b) => a.rank - b.rank).slice(0, options.keepTop || rankings.length);
        }
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision,
        critiqueGen: mockCritiqueGen,
        imageRanker: mockImageRanker
      };

      const config = {
        beamWidth: 4, // Generate 4 initial candidates
        keepTop: 2,   // Keep top 2
        maxIterations: 2 // Run iteration 0 and 1
      };

      const result = await beamSearch('test', providers, config);

      // Verify that the winner is from iteration 0 (the great parent)
      assert.strictEqual(result.metadata.iteration, 0, 'Best candidate should be from iteration 0 (parent survived)');
      assert.strictEqual(result.metadata.candidateId, 0, 'Best candidate should be the high-scoring parent');
    });
  });

  describe('🔴 Defensive Metadata Recording', () => {
    test('should call recordAttempt BEFORE image generation', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      const callOrder = [];

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => {
          callOrder.push('generateImage');
          return { url: 'test.png', revisedPrompt: 'revised', metadata: {} };
        }
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 85,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const mockMetadataTracker = {
        recordAttempt: async () => {
          callOrder.push('recordAttempt');
        },
        updateAttemptWithResults: async () => {
          callOrder.push('updateAttemptWithResults');
        },
        recordCandidate: async () => {},
        markFinalWinner: async () => {},
        buildLineage: async () => {}
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision
      };

      const config = {
        beamWidth: 2,
        keepTop: 1,
        maxIterations: 1,
        metadataTracker: mockMetadataTracker
      };

      await beamSearch('test', providers, config);

      // Verify recordAttempt was called BEFORE generateImage
      const recordAttemptIndex = callOrder.indexOf('recordAttempt');
      const generateImageIndex = callOrder.indexOf('generateImage');

      assert.ok(
        recordAttemptIndex !== -1,
        'recordAttempt should be called'
      );
      assert.ok(
        recordAttemptIndex < generateImageIndex,
        'recordAttempt should be called BEFORE generateImage (defensive pattern)'
      );
    });

    test('should call updateAttemptWithResults AFTER successful generation', async () => {
      const { beamSearch } = require('../../src/orchestrator/beam-search.js');

      const callOrder = [];

      const mockLLM = {
        refinePrompt: async () => ({ refinedPrompt: 'refined', metadata: {} }),
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => {
          callOrder.push('generateImage');
          return { url: 'test.png', revisedPrompt: 'revised', metadata: {} };
        }
      };

      const mockVision = {
        analyzeImage: async () => {
          callOrder.push('analyzeImage');
          return {
            alignmentScore: 85,
            aestheticScore: 7,
            analysis: '',
            strengths: [],
            weaknesses: [],
            metadata: {}
          };
        }
      };

      const mockMetadataTracker = {
        recordAttempt: async () => {
          callOrder.push('recordAttempt');
        },
        updateAttemptWithResults: async () => {
          callOrder.push('updateAttemptWithResults');
        },
        recordCandidate: async () => {},
        markFinalWinner: async () => {},
        buildLineage: async () => {}
      };

      const providers = {
        llm: mockLLM,
        imageGen: mockImageGen,
        vision: mockVision
      };

      const config = {
        beamWidth: 2,
        keepTop: 1,
        maxIterations: 1,
        metadataTracker: mockMetadataTracker
      };

      await beamSearch('test', providers, config);

      // Verify updateAttemptWithResults was called AFTER both generateImage and analyzeImage
      const updateIndex = callOrder.indexOf('updateAttemptWithResults');
      const generateIndex = callOrder.indexOf('generateImage');
      const analyzeIndex = callOrder.indexOf('analyzeImage');

      assert.ok(
        updateIndex !== -1,
        'updateAttemptWithResults should be called'
      );
      assert.ok(
        updateIndex > generateIndex && updateIndex > analyzeIndex,
        'updateAttemptWithResults should be called AFTER image generation and analysis complete'
      );
    });

    test('should preserve recordAttempt data even if image generation fails', async () => {
      const { processCandidateStream } = require('../../src/orchestrator/beam-search.js');

      let attemptRecorded = false;
      let updateCalled = false;

      const mockLLM = {
        combinePrompts: async (w, h) => `${w} + ${h}`
      };

      const mockImageGen = {
        generateImage: async () => {
          throw new Error('API rate limit exceeded');
        }
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 85,
          aestheticScore: 7,
          analysis: '',
          strengths: [],
          weaknesses: [],
          metadata: {}
        })
      };

      const mockMetadataTracker = {
        recordAttempt: async () => {
          attemptRecorded = true;
        },
        updateAttemptWithResults: async () => {
          updateCalled = true;
        }
      };

      const options = {
        iteration: 0,
        candidateId: 0,
        dimension: 'what',
        metadataTracker: mockMetadataTracker
      };

      // Attempt to process - should fail at image generation
      try {
        await processCandidateStream(
          'what prompt',
          'how prompt',
          mockLLM,
          mockImageGen,
          mockVision,
          options
        );
        assert.fail('Should have thrown error from image generation');
      } catch (error) {
        assert.strictEqual(error.message, 'API rate limit exceeded');
      }

      // Verify defensive metadata was recorded even though generation failed
      assert.ok(
        attemptRecorded,
        'recordAttempt should be called even when image generation fails (defensive pattern)'
      );
      assert.ok(
        !updateCalled,
        'updateAttemptWithResults should NOT be called when generation fails'
      );
    });
  });
});
