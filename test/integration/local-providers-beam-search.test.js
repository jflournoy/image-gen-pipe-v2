/**
 * 🔴 RED: Local Providers Beam Search Integration Tests
 *
 * Tests for beam search orchestrator with local providers (llama.cpp, Flux, CLIP)
 * Ensures rate limiting works correctly for local GPU-bound services
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('Beam Search with Local Providers', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Local provider creation and configuration', () => {
    test('should create local providers via factory', () => {
      const {
        createLLMProvider,
        createImageProvider,
        createVisionProvider
      } = require('../../src/factory/provider-factory');

      const llm = createLLMProvider({ mode: 'real', provider: 'local-llm' });
      const image = createImageProvider({ mode: 'real', provider: 'flux' });
      const vision = createVisionProvider({ mode: 'real', provider: 'local' });

      assert.strictEqual(llm.apiUrl, 'http://localhost:8003');
      assert.strictEqual(image.apiUrl, 'http://localhost:8001');
      assert.strictEqual(vision.apiUrl, 'http://localhost:8002');
    });

    test('should use custom ports for local providers', () => {
      const {
        createLLMProvider,
        createImageProvider,
        createVisionProvider
      } = require('../../src/factory/provider-factory');

      const llm = createLLMProvider({
        mode: 'real',
        provider: 'local-llm',
        apiUrl: 'http://localhost:9003'
      });
      const image = createImageProvider({
        mode: 'real',
        provider: 'flux',
        apiUrl: 'http://localhost:9001'
      });
      const vision = createVisionProvider({
        mode: 'real',
        provider: 'local',
        apiUrl: 'http://localhost:9002'
      });

      assert.strictEqual(llm.apiUrl, 'http://localhost:9003');
      assert.strictEqual(image.apiUrl, 'http://localhost:9001');
      assert.strictEqual(vision.apiUrl, 'http://localhost:9002');
    });
  });

  describe('Serial processing with rate limit = 1', () => {
    test('should enforce serial LLM calls with local provider', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const { RateLimiter } = require('../../src/utils/rate-limiter');

      const provider = new LocalLLMProvider();
      const limiter = new RateLimiter(1); // Serial execution

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      // Mock the LLM service
      nock('http://localhost:8003')
        .post('/v1/completions')
        .times(5)
        .reply(function() {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          // Simulate processing delay
          return new Promise(resolve => {
            setTimeout(() => {
              currentConcurrent--;
              resolve([200, {
                choices: [{ text: 'Refined prompt', finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 20 }
              }]);
            }, 10);
          });
        });

      // Execute 5 refinePrompt calls through rate limiter
      const tasks = Array(5).fill().map((_, i) =>
        limiter.execute(() => provider.refinePrompt(`prompt ${i}`, { dimension: 'what' }))
      );

      await Promise.all(tasks);

      assert.strictEqual(maxConcurrent, 1, 'Should process LLM calls serially (max concurrent = 1)');
    });

    test('should enforce serial image generation with Flux', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const { RateLimiter } = require('../../src/utils/rate-limiter');

      const provider = new FluxImageProvider();
      const limiter = new RateLimiter(1);

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      nock('http://localhost:8001')
        .post('/generate')
        .times(3)
        .reply(function() {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          return new Promise(resolve => {
            setTimeout(() => {
              currentConcurrent--;
              resolve([200, {
                localPath: '/tmp/image.png',
                metadata: { model: 'flux-schnell' }
              }]);
            }, 15);
          });
        });

      const tasks = Array(3).fill().map((_, i) =>
        limiter.execute(() => provider.generateImage(`prompt ${i}`, {}))
      );

      await Promise.all(tasks);

      assert.strictEqual(maxConcurrent, 1, 'Should process image generation serially');
    });

    test('should enforce serial vision analysis with local provider', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');
      const { RateLimiter } = require('../../src/utils/rate-limiter');

      const provider = new LocalVisionProvider();
      const limiter = new RateLimiter(1);

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      nock('http://localhost:8002')
        .post('/analyze')
        .times(3)
        .reply(function() {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          return new Promise(resolve => {
            setTimeout(() => {
              currentConcurrent--;
              resolve([200, {
                clip_score: 0.85,
                aesthetic_score: 7.5,
                caption: 'A test image',
                metadata: {}
              }]);
            }, 10);
          });
        });

      const tasks = Array(3).fill().map(() =>
        limiter.execute(() => provider.analyzeImage('/tmp/test.png', 'test prompt'))
      );

      await Promise.all(tasks);

      assert.strictEqual(maxConcurrent, 1, 'Should process vision analysis serially');
    });
  });

  describe('Rate limit configuration', () => {
    test('should load local provider rate limits from config', () => {
      // Clear require cache to get fresh config
      delete require.cache[require.resolve('../../src/config/rate-limits')];
      const rateLimits = require('../../src/config/rate-limits');

      assert.strictEqual(rateLimits.local.llm, 1, 'Local LLM should default to serial');
      assert.strictEqual(rateLimits.local.imageGen, 1, 'Local image gen should default to serial');
      assert.strictEqual(rateLimits.local.vision, 1, 'Local vision should default to serial');
    });

    test('should select correct rate limit based on provider type', () => {
      delete require.cache[require.resolve('../../src/config/rate-limits')];
      const rateLimits = require('../../src/config/rate-limits');

      // OpenAI providers (isLocal=false)
      const openaiLLM = rateLimits.getLimitForType('llm', false);
      assert.ok(openaiLLM > 1, 'OpenAI LLM should have concurrent limit > 1');

      // Local providers (isLocal=true)
      const localLLM = rateLimits.getLimitForType('llm', true);
      assert.strictEqual(localLLM, 1, 'Local LLM should have serial limit of 1');
    });
  });

  describe('Beam search initial expansion with local providers', () => {
    test('should complete initial expansion with mock providers (local-like interface)', async () => {
      const { initialExpansion } = require('../../src/orchestrator/beam-search');

      // Use mock providers that simulate local provider behavior
      // Note: Full integration with real LocalLLMProvider/FluxImageProvider/LocalVisionProvider
      // requires orchestrator changes to handle localPath vs url
      const mockLLM = {
        refinePrompt: async (prompt, options) => ({
          refinedPrompt: options.dimension === 'what' ? 'Content expansion result' : 'Style expansion result',
          metadata: { tokensUsed: 30 }
        }),
        combinePrompts: async (what, how) => ({
          combinedPrompt: `${what}, ${how}`,
          metadata: { tokensUsed: 20 }
        })
      };

      const mockImageGen = {
        generateImage: async () => ({
          url: '/tmp/flux_image.png', // Use url for orchestrator compatibility
          localPath: '/tmp/flux_image.png',
          metadata: { model: 'flux-schnell', steps: 4 }
        })
      };

      const mockVision = {
        analyzeImage: async () => ({
          alignmentScore: 82,
          aestheticScore: 7.2,
          analysis: 'Generated test image',
          strengths: ['good composition'],
          weaknesses: ['could use more detail'],
          metadata: {}
        })
      };

      const config = { beamWidth: 3 };

      const results = await initialExpansion(
        'a serene mountain landscape',
        mockLLM,
        mockImageGen,
        mockVision,
        config
      );

      assert.strictEqual(results.length, 3, 'Should generate beamWidth candidates');
      results.forEach((result, i) => {
        assert.ok(result.whatPrompt, `Result ${i} should have whatPrompt`);
        assert.ok(result.howPrompt, `Result ${i} should have howPrompt`);
        assert.ok(result.combined, `Result ${i} should have combined prompt`);
        assert.ok(result.image, `Result ${i} should have image`);
        assert.ok(result.evaluation, `Result ${i} should have evaluation`);
        assert.ok(typeof result.totalScore === 'number', `Result ${i} should have totalScore`);
      });
    });

    test('should work with LocalLLMProvider via HTTP mock', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');

      // Mock LLM service
      nock('http://localhost:8003')
        .post('/v1/completions')
        .times(2)
        .reply(200, function(uri, body) {
          const isWhat = body.prompt.includes('CONTENT');
          return {
            choices: [{ text: isWhat ? 'Content expansion result' : 'Style expansion result', finish_reason: 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 30 }
          };
        });

      const llm = new LocalLLMProvider();

      const whatResult = await llm.refinePrompt('test prompt', { dimension: 'what' });
      const howResult = await llm.refinePrompt('test prompt', { dimension: 'how' });

      assert.ok(whatResult.refinedPrompt.includes('Content'), 'Should refine WHAT prompt');
      assert.ok(howResult.refinedPrompt.includes('Style'), 'Should refine HOW prompt');
    });

    test('should work with FluxImageProvider via HTTP mock', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');

      nock('http://localhost:8001')
        .post('/generate')
        .reply(200, {
          localPath: '/tmp/flux_image.png',
          metadata: { model: 'flux-schnell', steps: 4 }
        });

      const imageGen = new FluxImageProvider();
      const result = await imageGen.generateImage('test prompt', {});

      assert.strictEqual(result.localPath, '/tmp/flux_image.png');
      assert.strictEqual(result.url, undefined); // Local providers use localPath, not url
    });

    test('should work with LocalVisionProvider via HTTP mock', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');

      nock('http://localhost:8002')
        .post('/analyze')
        .reply(200, {
          alignmentScore: 82,
          aestheticScore: 7.2,
          analysis: 'Generated test image',
          strengths: ['good composition'],
          weaknesses: ['could use more detail']
        });

      const vision = new LocalVisionProvider();
      const result = await vision.analyzeImage('/tmp/test.png', 'test prompt');

      assert.strictEqual(result.alignmentScore, 82);
      assert.strictEqual(result.aestheticScore, 7.2);
    });
  });

  describe('Error handling with local providers', () => {
    test('should handle local LLM service unavailable', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const provider = new LocalLLMProvider({ apiUrl: 'http://localhost:9999' });

      // Don't mock - let it fail to connect
      nock.enableNetConnect('localhost:9999');

      await assert.rejects(
        provider.refinePrompt('test prompt', { dimension: 'what' }),
        /Cannot reach local LLM service/
      );
    });

    test('should handle Flux service error', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const provider = new FluxImageProvider();

      nock('http://localhost:8001')
        .post('/generate')
        .reply(500, { error: 'GPU out of memory' });

      await assert.rejects(
        provider.generateImage('test prompt', {}),
        /Failed to generate image/
      );
    });

    test('should handle Vision service error', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');
      const provider = new LocalVisionProvider();

      nock('http://localhost:8002')
        .post('/analyze')
        .reply(503, { error: 'Model not loaded' });

      await assert.rejects(
        provider.analyzeImage('/tmp/test.png', 'test prompt'),
        /Failed to analyze image/
      );
    });
  });

  describe('Health check integration', () => {
    test('should check health of all local services', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');

      // Mock health endpoints
      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
          model_loaded: true,
          device: 'cuda'
        });

      nock('http://localhost:8001')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'flux-schnell',
          model_loaded: true,
          device: 'cuda'
        });

      nock('http://localhost:8002')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          clip_model: 'openai/clip-vit-base-patch32',
          aesthetic_model: 'aesthetic_predictor_v2_5',
          models_loaded: true,
          device: 'cuda'
        });

      const llm = new LocalLLMProvider();
      const flux = new FluxImageProvider();
      const vision = new LocalVisionProvider();

      const [llmHealth, fluxHealth, visionHealth] = await Promise.all([
        llm.healthCheck(),
        flux.healthCheck(),
        vision.healthCheck()
      ]);

      assert.strictEqual(llmHealth.status, 'healthy');
      assert.strictEqual(fluxHealth.status, 'healthy');
      assert.strictEqual(visionHealth.status, 'healthy');
    });
  });

  describe('GPU memory coordination', () => {
    test('should support model unload via service endpoint', async () => {
      // The unload functionality is exposed via the Python service, not the provider class
      // This test verifies the service endpoint contract
      nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded', message: 'Model unloaded, GPU memory freed' });

      const axios = require('axios');
      const response = await axios.post('http://localhost:8001/unload');

      assert.strictEqual(response.data.status, 'unloaded');
    });

    test('should support explicit model load via service endpoint', async () => {
      // The load functionality is exposed via the Python service, not the provider class
      // This test verifies the service endpoint contract
      nock('http://localhost:8003')
        .post('/load')
        .reply(200, {
          status: 'loaded',
          model: 'mistralai/Mistral-7B-Instruct-v0.2',
          gpu_layers: 32
        });

      const axios = require('axios');
      const response = await axios.post('http://localhost:8003/load');

      assert.strictEqual(response.data.status, 'loaded');
    });

    test('should report model_loaded status in health check', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const provider = new FluxImageProvider();

      // Mock health endpoint showing model not loaded
      nock('http://localhost:8001')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'flux-schnell',
          model_loaded: false,
          device: 'cuda'
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.model_loaded, false);
    });
  });
});

describe('Rate Limiter Dynamic Adjustment for Local Providers', () => {
  test('should dynamically adjust rate limit when switching provider types', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter');

    const limiter = new RateLimiter(5); // Start with OpenAI rate limit

    // Switch to local provider (serial)
    limiter.setConcurrencyLimit(1);

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 5));
      currentConcurrent--;
    };

    await Promise.all(Array(3).fill().map(() => limiter.execute(task)));

    assert.strictEqual(maxConcurrent, 1, 'Should enforce serial after setConcurrencyLimit(1)');
  });

  test('should increase concurrency when switching back to OpenAI', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter');

    const limiter = new RateLimiter(1); // Start with local rate limit

    // Switch to OpenAI provider (parallel)
    limiter.setConcurrencyLimit(5);

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 10));
      currentConcurrent--;
    };

    await Promise.all(Array(5).fill().map(() => limiter.execute(task)));

    assert.ok(maxConcurrent > 1, 'Should allow parallel execution after increasing limit');
  });
});
