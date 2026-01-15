/**
 * 🔴 RED: Local Provider Chaining Tests
 *
 * Tests that verify each local service works in isolation AND
 * that outputs from one service are compatible as inputs to the next.
 *
 * Chain: LLM (refine) → LLM (combine) → Image Gen → Vision Analysis
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('Local Provider Chaining', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Stage 1: LLM refinePrompt output format', () => {
    test('should return string that can be used as prompt input', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'A majestic mountain landscape with snow-capped peaks', finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 15 }
        });

      const llm = new LocalLLMProvider();
      const result = await llm.refinePrompt('mountain', { dimension: 'what' });

      // Verify output is an object with refinedPrompt string suitable for next stage
      assert.strictEqual(typeof result, 'object', 'refinePrompt should return object');
      assert.ok(result.refinedPrompt, 'refinePrompt should have refinedPrompt property');
      assert.strictEqual(typeof result.refinedPrompt, 'string', 'refinedPrompt should be a string');
      assert.ok(result.refinedPrompt.length > 0, 'refinedPrompt should not be empty');
      assert.ok(!result.refinedPrompt.includes('undefined'), 'refinedPrompt should not contain undefined');
      assert.ok(!result.refinedPrompt.includes('[object'), 'refinedPrompt should not contain object stringification');
      assert.ok(result.metadata, 'refinePrompt should have metadata');
    });

    test('should handle both WHAT and HOW dimensions with consistent output format', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');

      nock('http://localhost:8003')
        .post('/v1/completions')
        .times(2)
        .reply(200, function(uri, body) {
          const isWhat = body.prompt.includes('CONTENT');
          return {
            choices: [{
              text: isWhat
                ? 'Snow-capped mountains with a pristine lake in the foreground'
                : 'Golden hour lighting, cinematic composition, shallow depth of field',
              finish_reason: 'stop'
            }],
            usage: {}
          };
        });

      const llm = new LocalLLMProvider();

      const whatResult = await llm.refinePrompt('mountain', { dimension: 'what' });
      const howResult = await llm.refinePrompt('mountain', { dimension: 'how' });

      // Both should be objects with refinedPrompt strings suitable for combinePrompts
      assert.strictEqual(typeof whatResult.refinedPrompt, 'string');
      assert.strictEqual(typeof howResult.refinedPrompt, 'string');
      assert.ok(whatResult.refinedPrompt.length > 0);
      assert.ok(howResult.refinedPrompt.length > 0);
    });
  });

  describe('Stage 2: LLM combinePrompts - chaining from refinePrompt', () => {
    test('should accept refinePrompt outputs and return combined string', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');

      // Mock for refinePrompt calls
      nock('http://localhost:8003')
        .post('/v1/completions')
        .times(3)
        .reply(200, function(uri, body) {
          // Combine prompts call includes both WHAT and HOW
          if (body.prompt.includes('WHAT prompt') && body.prompt.includes('HOW prompt')) {
            return {
              choices: [{ text: 'Snow-capped mountains, golden hour lighting, cinematic composition', finish_reason: 'stop' }],
              usage: {}
            };
          }
          const isWhat = body.prompt.includes('CONTENT');
          return {
            choices: [{
              text: isWhat ? 'Snow-capped mountains' : 'Golden hour lighting',
              finish_reason: 'stop'
            }],
            usage: {}
          };
        });

      const llm = new LocalLLMProvider();

      // Stage 1: Refine prompts
      const whatResult = await llm.refinePrompt('mountain', { dimension: 'what' });
      const howResult = await llm.refinePrompt('mountain', { dimension: 'how' });

      // Stage 2: Combine (using refinedPrompt strings from stage 1)
      const combineResult = await llm.combinePrompts(whatResult.refinedPrompt, howResult.refinedPrompt);

      // Verify combined output is suitable for image generation
      assert.strictEqual(typeof combineResult.combinedPrompt, 'string', 'combinedPrompt should be string');
      assert.ok(combineResult.combinedPrompt.length > 0, 'combined prompt should not be empty');
      assert.ok(combineResult.combinedPrompt.length >= whatResult.refinedPrompt.length, 'combined should incorporate content');
      assert.ok(combineResult.metadata, 'combinePrompts should return metadata');
    });
  });

  describe('Stage 3: Image Gen - chaining from LLM combinePrompts', () => {
    test('should accept combined prompt string and return localPath', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const FluxImageProvider = require('../../src/providers/flux-image-provider');

      // Mock LLM
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'A beautiful mountain scene with dramatic lighting', finish_reason: 'stop' }],
          usage: {}
        });

      // Mock Flux
      nock('http://localhost:8001')
        .post('/generate')
        .reply(200, function(uri, body) {
          // Verify prompt was passed correctly
          assert.ok(body.prompt, 'Image gen should receive prompt');
          assert.strictEqual(typeof body.prompt, 'string', 'Prompt should be string');

          return {
            localPath: '/tmp/output/flux_12345.png',
            metadata: {
              model: 'flux-schnell',
              prompt: body.prompt,
              seed: 42
            }
          };
        });

      const llm = new LocalLLMProvider();
      const imageGen = new FluxImageProvider();

      // Get combined prompt from LLM
      const combineResult = await llm.combinePrompts('mountain scene', 'dramatic lighting');

      // Pass combinedPrompt string to image generation
      const imageResult = await imageGen.generateImage(combineResult.combinedPrompt, {});

      // Verify output format for vision stage
      assert.ok(imageResult.localPath, 'Image result should have localPath');
      assert.strictEqual(typeof imageResult.localPath, 'string', 'localPath should be string');
      assert.ok(imageResult.localPath.startsWith('/'), 'localPath should be absolute path');
      assert.ok(imageResult.localPath.endsWith('.png'), 'localPath should be PNG file');
    });

    test('should return undefined url (local providers use localPath)', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');

      nock('http://localhost:8001')
        .post('/generate')
        .reply(200, {
          localPath: '/tmp/output/flux_12345.png',
          metadata: { model: 'flux-schnell' }
        });

      const imageGen = new FluxImageProvider();
      const result = await imageGen.generateImage('test prompt', {});

      assert.strictEqual(result.url, undefined, 'Local provider should not set url');
      assert.ok(result.localPath, 'Local provider should set localPath');
    });
  });

  describe('Stage 4: Vision Analysis - chaining from Image Gen', () => {
    test('should accept localPath from image gen and return scores', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');

      // Mock Flux
      nock('http://localhost:8001')
        .post('/generate')
        .reply(200, {
          localPath: '/tmp/output/flux_12345.png',
          metadata: { model: 'flux-schnell' }
        });

      // Mock Vision
      nock('http://localhost:8002')
        .post('/analyze')
        .reply(200, function(uri, body) {
          // Verify the image path was passed correctly
          assert.ok(body.imagePath || body.imageUrl, 'Vision should receive image reference');

          return {
            alignmentScore: 85,
            aestheticScore: 7.5,
            analysis: 'Well-composed mountain scene',
            strengths: ['good composition', 'nice lighting'],
            weaknesses: ['could use more detail in foreground']
          };
        });

      const imageGen = new FluxImageProvider();
      const vision = new LocalVisionProvider();

      // Stage 3: Generate image
      const imageResult = await imageGen.generateImage('mountain scene', {});

      // Stage 4: Analyze using localPath
      const visionResult = await vision.analyzeImage(imageResult.localPath, 'mountain scene');

      // Verify vision output format
      assert.strictEqual(typeof visionResult.alignmentScore, 'number', 'alignmentScore should be number');
      assert.strictEqual(typeof visionResult.aestheticScore, 'number', 'aestheticScore should be number');
      assert.ok(visionResult.alignmentScore >= 0 && visionResult.alignmentScore <= 100, 'alignmentScore should be 0-100');
      assert.ok(visionResult.aestheticScore >= 0 && visionResult.aestheticScore <= 10, 'aestheticScore should be 0-10');
    });

    test('should handle both localPath and URL formats', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');

      // Test with localPath
      nock('http://localhost:8002')
        .post('/analyze')
        .reply(200, {
          alignmentScore: 80,
          aestheticScore: 7,
          analysis: 'Good image'
        });

      const vision = new LocalVisionProvider();

      // Local path (from Flux)
      const resultFromPath = await vision.analyzeImage('/tmp/image.png', 'test');
      assert.ok(resultFromPath.alignmentScore, 'Should work with local path');

      // URL (from OpenAI DALL-E)
      nock('http://localhost:8002')
        .post('/analyze')
        .reply(200, {
          alignmentScore: 82,
          aestheticScore: 7.2,
          analysis: 'Good image'
        });

      const resultFromUrl = await vision.analyzeImage('https://example.com/image.png', 'test');
      assert.ok(resultFromUrl.alignmentScore, 'Should work with URL');
    });
  });

  describe('Full Chain: LLM → Image → Vision', () => {
    test('should complete full local provider chain', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');

      // Mock LLM (refine what)
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Majestic snow-capped mountains with a pristine alpine lake', finish_reason: 'stop' }],
          usage: {}
        });

      // Mock LLM (refine how)
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Golden hour lighting, wide-angle composition, rich color palette', finish_reason: 'stop' }],
          usage: {}
        });

      // Mock LLM (combine)
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Majestic snow-capped mountains with alpine lake, golden hour lighting, wide-angle, rich colors', finish_reason: 'stop' }],
          usage: {}
        });

      // Mock Flux
      nock('http://localhost:8001')
        .post('/generate')
        .reply(200, {
          localPath: '/tmp/output/flux_full_chain.png',
          metadata: { model: 'flux-schnell', seed: 42 }
        });

      // Mock Vision
      nock('http://localhost:8002')
        .post('/analyze')
        .reply(200, {
          alignmentScore: 88,
          aestheticScore: 8.2,
          analysis: 'Excellent mountain landscape with good lighting',
          strengths: ['great composition', 'vivid colors', 'good depth'],
          weaknesses: ['minor artifacts in sky']
        });

      const llm = new LocalLLMProvider();
      const imageGen = new FluxImageProvider();
      const vision = new LocalVisionProvider();

      // Execute full chain - extract strings from result objects
      const whatResult = await llm.refinePrompt('mountain landscape', { dimension: 'what' });
      const howResult = await llm.refinePrompt('mountain landscape', { dimension: 'how' });
      const combineResult = await llm.combinePrompts(whatResult.refinedPrompt, howResult.refinedPrompt);
      const imageResult = await imageGen.generateImage(combineResult.combinedPrompt, {});
      const visionResult = await vision.analyzeImage(imageResult.localPath, combineResult.combinedPrompt);

      // Verify final output has all expected fields
      assert.ok(visionResult.alignmentScore >= 0, 'Should have valid alignmentScore');
      assert.ok(visionResult.aestheticScore >= 0, 'Should have valid aestheticScore');
      assert.ok(Array.isArray(visionResult.strengths), 'Should have strengths array');
      assert.ok(Array.isArray(visionResult.weaknesses), 'Should have weaknesses array');

      // Verify chain integrity - combined prompt should contain content from both dimensions
      assert.ok(combineResult.combinedPrompt.includes('mountain') || combineResult.combinedPrompt.includes('alpine'),
        'Combined prompt should contain content elements');
    });

    test('should handle errors at each stage gracefully', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');

      const llm = new LocalLLMProvider();
      const imageGen = new FluxImageProvider();
      const vision = new LocalVisionProvider();

      // Test LLM failure
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(500, { error: 'Model overloaded' });

      await assert.rejects(
        llm.refinePrompt('test', { dimension: 'what' }),
        /Failed to refine prompt/,
        'Should throw descriptive error on LLM failure'
      );

      // Test Image Gen failure
      nock('http://localhost:8001')
        .post('/generate')
        .reply(500, { error: 'GPU out of memory' });

      await assert.rejects(
        imageGen.generateImage('test prompt', {}),
        /Failed to generate image/,
        'Should throw descriptive error on image gen failure'
      );

      // Test Vision failure
      nock('http://localhost:8002')
        .post('/analyze')
        .reply(500, { error: 'Model not loaded' });

      await assert.rejects(
        vision.analyzeImage('/tmp/test.png', 'test'),
        /Failed to analyze image/,
        'Should throw descriptive error on vision failure'
      );
    });
  });

  describe('🔴 RED: Beam search orchestrator local provider compatibility', () => {
    test('beam-search should use localPath when url is undefined', async () => {
      // This test verifies the beam-search orchestrator correctly handles
      // local providers that return localPath instead of url

      const { processCandidateStream } = require('../../src/orchestrator/beam-search');

      // Mock LLM that returns combined prompt string
      const mockLLM = {
        combinePrompts: async (what, how) => ({
          combinedPrompt: `${what}, ${how}`,
          metadata: {}
        })
      };

      // Mock Image provider that returns localPath (like FluxImageProvider)
      const mockImageGen = {
        generateImage: async () => ({
          url: undefined, // Local providers don't set url
          localPath: '/tmp/flux_image.png',
          metadata: { model: 'flux-schnell' }
        })
      };

      let capturedImagePath;
      const mockVision = {
        analyzeImage: async (imagePath, prompt) => {
          capturedImagePath = imagePath;
          return {
            alignmentScore: 85,
            aestheticScore: 7.5,
            analysis: 'Good',
            strengths: [],
            weaknesses: [],
            metadata: {}
          };
        }
      };

      const options = {
        iteration: 0,
        candidateId: 0,
        dimension: 'what'
      };

      const result = await processCandidateStream(
        'what prompt',
        'how prompt',
        mockLLM,
        mockImageGen,
        mockVision,
        options
      );

      // The vision provider should receive localPath, not undefined
      assert.ok(capturedImagePath, 'Vision should receive image path (not undefined)');
      assert.strictEqual(capturedImagePath, '/tmp/flux_image.png',
        'Vision should receive localPath when url is undefined');
    });
  });

  describe('Output format validation for beam search compatibility', () => {
    test('LLM refinePrompt output should work with beam search processCandidateStream', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Refined prompt result', finish_reason: 'stop' }],
          usage: {}
        });

      const llm = new LocalLLMProvider();
      const result = await llm.refinePrompt('test', { dimension: 'what' });

      // Beam search expects object with refinedPrompt and metadata
      assert.strictEqual(typeof result, 'object');
      assert.strictEqual(typeof result.refinedPrompt, 'string');
      assert.ok(result.metadata, 'Should include metadata');
      // Should not have leading/trailing whitespace
      assert.strictEqual(result.refinedPrompt, result.refinedPrompt.trim());
    });

    test('LLM combinePrompts output should match beam search expected format', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Combined what and how prompt', finish_reason: 'stop' }],
          usage: {}
        });

      const llm = new LocalLLMProvider();
      const result = await llm.combinePrompts('what text', 'how text');

      // Beam search expects object with combinedPrompt and metadata
      assert.strictEqual(typeof result, 'object');
      assert.strictEqual(typeof result.combinedPrompt, 'string');
      assert.ok(result.metadata, 'Should include metadata');
    });

    test('Image provider output should have url OR localPath for vision', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');

      nock('http://localhost:8001')
        .post('/generate')
        .reply(200, {
          localPath: '/tmp/test.png',
          metadata: {}
        });

      const imageGen = new FluxImageProvider();
      const result = await imageGen.generateImage('test', {});

      // Beam search uses image.url || image.localPath
      const imageReference = result.url || result.localPath;
      assert.ok(imageReference, 'Should have either url or localPath');
      assert.strictEqual(typeof imageReference, 'string');
    });

    test('Vision provider output should have alignmentScore and aestheticScore', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');

      nock('http://localhost:8002')
        .post('/analyze')
        .reply(200, {
          alignmentScore: 85,
          aestheticScore: 7.5,
          analysis: 'Good',
          strengths: [],
          weaknesses: []
        });

      const vision = new LocalVisionProvider();
      const result = await vision.analyzeImage('/tmp/test.png', 'test');

      // Beam search calculateTotalScore expects these exact field names
      assert.ok('alignmentScore' in result, 'Must have alignmentScore field');
      assert.ok('aestheticScore' in result, 'Must have aestheticScore field');
      assert.strictEqual(typeof result.alignmentScore, 'number');
      assert.strictEqual(typeof result.aestheticScore, 'number');
    });
  });
});
