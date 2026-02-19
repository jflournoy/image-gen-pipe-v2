/**
 * 🔴 TDD RED Phase: Beam Search Batch Image Generation Tests
 *
 * Tests that the beam search orchestrator uses batch image generation
 * when the provider supports generateImages(), and falls back to
 * individual calls when it doesn't.
 *
 * These tests WILL FAIL until we restructure initialExpansion and
 * refinementIteration to support batch image generation.
 */

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  initialExpansion,
  refinementIteration,
  configureRateLimitsForProviders
} = require('../../src/orchestrator/beam-search.js');

// Minimal valid 1x1 PNG as base64
const TEST_BASE64_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Create a mock LLM provider that returns predictable prompts
 */
function createMockLLM() {
  let callCount = 0;
  return {
    refinePrompt: async (prompt, options) => {
      callCount++;
      return {
        refinedPrompt: `${options.dimension}-refined-${callCount}: ${prompt.substring(0, 20)}`,
        metadata: { tokensUsed: 50, model: 'mock-llm' }
      };
    },
    combinePrompts: async (what, how) => {
      return {
        combinedPrompt: `combined: ${what} | ${how}`,
        metadata: { tokensUsed: 30, model: 'mock-llm' }
      };
    },
    generateText: async () => 'rephrased prompt',
    generateNegativePrompt: async () => ({
      negativePrompt: 'blurry, ugly',
      metadata: { tokensUsed: 20 }
    })
  };
}

/**
 * Create a mock image provider WITHOUT batch support (individual calls only)
 */
function createMockImageProvider() {
  const calls = [];
  return {
    calls,
    generateImage: async (prompt, options) => {
      calls.push({ prompt, options });
      return {
        url: `https://example.com/image-${options.candidateId}.png`,
        localPath: `/tmp/test/iter${options.iteration}-cand${options.candidateId}.png`,
        metadata: {
          model: 'mock-model',
          seed: 1000 + options.candidateId,
          prompt
        }
      };
    }
  };
}

/**
 * Create a mock image provider WITH batch support (generateImages method)
 */
function createMockBatchImageProvider() {
  const individualCalls = [];
  const batchCalls = [];
  return {
    individualCalls,
    batchCalls,
    generateImage: async (prompt, options) => {
      individualCalls.push({ prompt, options });
      return {
        url: `https://example.com/image-${options.candidateId}.png`,
        localPath: `/tmp/test/iter${options.iteration}-cand${options.candidateId}.png`,
        metadata: { model: 'mock-model', seed: 1000 + options.candidateId, prompt }
      };
    },
    generateImages: async (requests) => {
      batchCalls.push(requests);
      return requests.map((req, i) => ({
        url: `https://example.com/batch-image-${i}.png`,
        localPath: `/tmp/test/iter${req.options.iteration}-cand${req.options.candidateId}.png`,
        metadata: {
          model: 'mock-model',
          seed: 2000 + i,
          prompt: req.prompt
        }
      }));
    }
  };
}

/**
 * Create a mock vision provider
 */
function createMockVision() {
  return {
    analyzeImage: async () => ({
      alignmentScore: 80,
      aestheticScore: 7.5,
      metadata: { tokensUsed: 100, model: 'mock-vision' }
    })
  };
}

describe('Beam Search - Batch Image Generation', () => {
  beforeEach(() => {
    // Configure rate limits for cloud providers (higher concurrency)
    configureRateLimitsForProviders({
      llmIsLocal: false,
      imageIsLocal: false,
      visionIsLocal: false
    });
  });

  describe('initialExpansion with batch-capable provider', () => {
    test('should call generateImages() instead of individual generateImage() calls', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();

      const config = {
        beamWidth: 4,
        temperature: 0.7,
        alpha: 0.7,
        descriptiveness: 2
      };

      await initialExpansion('a beautiful sunset', llm, imageGen, vision, config);

      // Should have used batch, NOT individual calls
      assert.strictEqual(imageGen.batchCalls.length, 1, 'Should have made exactly 1 batch call');
      assert.strictEqual(imageGen.batchCalls[0].length, 4, 'Batch should contain 4 requests');
      assert.strictEqual(imageGen.individualCalls.length, 0, 'Should NOT have made any individual calls');
    });

    test('should pass correct prompts and metadata in batch request', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();

      const config = {
        beamWidth: 2,
        temperature: 0.7,
        alpha: 0.7,
        descriptiveness: 2
      };

      await initialExpansion('test prompt', llm, imageGen, vision, config);

      const batchRequest = imageGen.batchCalls[0];
      assert.strictEqual(batchRequest.length, 2);

      // Each request should have a prompt and options with iteration/candidateId
      for (let i = 0; i < batchRequest.length; i++) {
        assert.ok(batchRequest[i].prompt, `Request ${i} should have a prompt`);
        assert.strictEqual(batchRequest[i].options.iteration, 0, `Request ${i} should have iteration 0`);
        assert.strictEqual(batchRequest[i].options.candidateId, i, `Request ${i} should have candidateId ${i}`);
      }
    });

    test('should return valid candidates from batch results', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();

      const config = {
        beamWidth: 3,
        temperature: 0.7,
        alpha: 0.7,
        descriptiveness: 2
      };

      const candidates = await initialExpansion('test prompt', llm, imageGen, vision, config);

      assert.strictEqual(candidates.length, 3, 'Should return 3 candidates');

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        assert.ok(c.whatPrompt, `Candidate ${i} should have whatPrompt`);
        assert.ok(c.howPrompt, `Candidate ${i} should have howPrompt`);
        assert.ok(c.combined, `Candidate ${i} should have combined prompt`);
        assert.ok(c.image, `Candidate ${i} should have image`);
        assert.ok(c.evaluation, `Candidate ${i} should have evaluation`);
        assert.ok(typeof c.totalScore === 'number', `Candidate ${i} should have numeric totalScore`);
        assert.strictEqual(c.metadata.iteration, 0);
        assert.strictEqual(c.metadata.candidateId, i);
      }
    });

    test('should pass modalOptions through to batch requests', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();

      const config = {
        beamWidth: 2,
        temperature: 0.7,
        alpha: 0.7,
        descriptiveness: 2,
        modalOptions: {
          model: 'sdxl-turbo',
          steps: 4,
          guidance: 0.0,
          width: 512,
          height: 512
        }
      };

      await initialExpansion('test', llm, imageGen, vision, config);

      const batchRequest = imageGen.batchCalls[0];
      for (const req of batchRequest) {
        assert.strictEqual(req.options.model, 'sdxl-turbo');
        assert.strictEqual(req.options.steps, 4);
        assert.strictEqual(req.options.guidance, 0.0);
      }
    });

    test('should pass face fixing options through to batch requests', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();

      const config = {
        beamWidth: 2,
        temperature: 0.7,
        alpha: 0.7,
        descriptiveness: 2,
        fixFaces: true,
        restorationStrength: 0.8,
        faceUpscale: 2
      };

      await initialExpansion('a portrait', llm, imageGen, vision, config);

      const batchRequest = imageGen.batchCalls[0];
      for (const req of batchRequest) {
        assert.strictEqual(req.options.fix_faces, true);
        assert.strictEqual(req.options.restoration_strength, 0.8);
        assert.strictEqual(req.options.face_upscale, 2);
      }
    });
  });

  describe('initialExpansion fallback (non-batch provider)', () => {
    test('should use individual generateImage() calls when provider lacks generateImages()', async () => {
      const llm = createMockLLM();
      const imageGen = createMockImageProvider(); // No generateImages method
      const vision = createMockVision();

      const config = {
        beamWidth: 3,
        temperature: 0.7,
        alpha: 0.7,
        descriptiveness: 2
      };

      const candidates = await initialExpansion('sunset', llm, imageGen, vision, config);

      // Should have used individual calls
      assert.strictEqual(imageGen.calls.length, 3, 'Should have made 3 individual calls');
      assert.strictEqual(candidates.length, 3, 'Should return 3 candidates');
    });
  });

  describe('progress callbacks with batch generation', () => {
    test('should emit progress events for each image in the batch', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();

      const progressEvents = [];
      const config = {
        beamWidth: 2,
        temperature: 0.7,
        alpha: 0.7,
        descriptiveness: 2,
        onStepProgress: (event) => progressEvents.push(event)
      };

      await initialExpansion('test', llm, imageGen, vision, config);

      // Should have imageGen progress events for each candidate
      const imageGenEvents = progressEvents.filter(e => e.stage === 'imageGen');
      assert.ok(imageGenEvents.length >= 2, `Should have at least 2 imageGen events, got ${imageGenEvents.length}`);

      // Should have both starting and complete events
      const startingEvents = imageGenEvents.filter(e => e.status === 'starting');
      const completeEvents = imageGenEvents.filter(e => e.status === 'complete');
      assert.ok(startingEvents.length >= 1, 'Should have imageGen starting events');
      assert.ok(completeEvents.length >= 2, 'Should have imageGen complete events for each candidate');
    });
  });

  describe('refinementIteration with batch-capable provider', () => {
    /**
     * Create mock parent candidates (as returned by initialExpansion)
     */
    function createMockParents(count) {
      return Array(count).fill(null).map((_, i) => ({
        whatPrompt: `what-prompt-${i}`,
        howPrompt: `how-prompt-${i}`,
        combined: `combined-prompt-${i}`,
        image: {
          url: `https://example.com/image-${i}.png`,
          localPath: `/tmp/test/iter0-cand${i}.png`
        },
        evaluation: { alignmentScore: 80, aestheticScore: 7.5 },
        totalScore: 78.5,
        metadata: { iteration: 0, candidateId: i, dimension: 'what' }
      }));
    }

    /**
     * Create a mock critique provider
     */
    function createMockCritiqueProvider() {
      return {
        generateCritique: async () => ({
          critique: 'improve the lighting and composition',
          metadata: { tokensUsed: 40, model: 'mock-critique' }
        })
      };
    }

    test('should call generateImages() instead of individual generateImage() calls', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();
      const critique = createMockCritiqueProvider();
      const parents = createMockParents(2);

      const config = {
        beamWidth: 4,
        keepTop: 2,
        alpha: 0.7,
        descriptiveness: 2
      };

      await refinementIteration(parents, llm, imageGen, vision, critique, config, 1, 'test prompt');

      assert.strictEqual(imageGen.batchCalls.length, 1, 'Should have made exactly 1 batch call');
      assert.strictEqual(imageGen.batchCalls[0].length, 4, 'Batch should contain 4 requests (2 parents x 2 expansion)');
      assert.strictEqual(imageGen.individualCalls.length, 0, 'Should NOT have made any individual calls');
    });

    test('should return valid candidates with correct iteration metadata', async () => {
      const llm = createMockLLM();
      const imageGen = createMockBatchImageProvider();
      const vision = createMockVision();
      const critique = createMockCritiqueProvider();
      const parents = createMockParents(2);

      const config = {
        beamWidth: 4,
        keepTop: 2,
        alpha: 0.7,
        descriptiveness: 2
      };

      const candidates = await refinementIteration(parents, llm, imageGen, vision, critique, config, 1, 'test prompt');

      assert.strictEqual(candidates.length, 4, 'Should return 4 candidates');

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        assert.ok(c.whatPrompt, `Candidate ${i} should have whatPrompt`);
        assert.ok(c.howPrompt, `Candidate ${i} should have howPrompt`);
        assert.ok(c.combined, `Candidate ${i} should have combined prompt`);
        assert.ok(c.image, `Candidate ${i} should have image`);
        assert.strictEqual(c.metadata.iteration, 1, `Candidate ${i} should have iteration 1`);
      }
    });

    test('should fall back to individual calls when provider lacks generateImages()', async () => {
      const llm = createMockLLM();
      const imageGen = createMockImageProvider();
      const vision = createMockVision();
      const critique = createMockCritiqueProvider();
      const parents = createMockParents(2);

      const config = {
        beamWidth: 4,
        keepTop: 2,
        alpha: 0.7,
        descriptiveness: 2
      };

      const candidates = await refinementIteration(parents, llm, imageGen, vision, critique, config, 1, 'test prompt');

      assert.strictEqual(imageGen.calls.length, 4, 'Should have made 4 individual calls');
      assert.strictEqual(candidates.length, 4, 'Should return 4 candidates');
    });
  });
});
