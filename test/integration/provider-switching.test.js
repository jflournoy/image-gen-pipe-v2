/**
 * 🔴 RED: Provider Switching and Error Recovery Tests
 *
 * Tests for:
 * 1. Switching between OpenAI and local providers at runtime
 * 2. Error recovery when services fail
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('Provider Configuration Switching', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Switching LLM providers', () => {
    test('should switch from OpenAI to local-llm via factory', () => {
      // Skip if OPENAI_API_KEY not available
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available');
        return;
      }

      const { createLLMProvider } = require('../../src/factory/provider-factory');
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider');

      const openaiLLM = createLLMProvider({ mode: 'real', provider: 'openai' });
      assert(openaiLLM instanceof OpenAILLMProvider, 'Should create OpenAI provider');

      // Switch to local
      const localLLM = createLLMProvider({ mode: 'real', provider: 'local-llm' });
      assert(localLLM instanceof LocalLLMProvider, 'Should create local provider');

      // Verify different instances with different capabilities
      assert.notStrictEqual(openaiLLM.apiUrl, localLLM.apiUrl, 'Should have different API URLs');
    });

    test('should switch from local-llm to OpenAI via factory', () => {
      // Skip if OPENAI_API_KEY not available
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available');
        return;
      }

      const { createLLMProvider } = require('../../src/factory/provider-factory');
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider');

      // Start with local
      const localLLM = createLLMProvider({ mode: 'real', provider: 'local-llm' });
      assert(localLLM instanceof LocalLLMProvider);

      // Switch to OpenAI
      const openaiLLM = createLLMProvider({ mode: 'real', provider: 'openai' });
      assert(openaiLLM instanceof OpenAILLMProvider);
    });
  });

  describe('Switching Image providers', () => {
    test('should switch from DALL-E to Flux via factory', () => {
      // Skip if OPENAI_API_KEY not available
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available');
        return;
      }

      const { createImageProvider } = require('../../src/factory/provider-factory');
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider');

      // Start with DALL-E
      const dalleProvider = createImageProvider({ mode: 'real', provider: 'dalle' });
      assert(dalleProvider instanceof OpenAIImageProvider);

      // Switch to Flux
      const fluxProvider = createImageProvider({ mode: 'real', provider: 'flux' });
      assert(fluxProvider instanceof FluxImageProvider);
    });
  });

  describe('Switching Vision providers', () => {
    test('should switch from OpenAI Vision to local CLIP via factory', () => {
      // Skip if OPENAI_API_KEY not available
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available');
        return;
      }

      const { createVisionProvider } = require('../../src/factory/provider-factory');
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider');

      // Start with OpenAI Vision
      const openaiVision = createVisionProvider({ mode: 'real', provider: 'openai' });
      assert(openaiVision instanceof OpenAIVisionProvider);

      // Switch to local
      const localVision = createVisionProvider({ mode: 'real', provider: 'local' });
      assert(localVision instanceof LocalVisionProvider);
    });
  });

  describe('Rate limit adjustment on provider switch', () => {
    test('should adjust rate limits when switching to local providers', () => {
      const { RateLimiter } = require('../../src/utils/rate-limiter');
      const rateLimitConfig = require('../../src/config/rate-limits');

      const limiter = new RateLimiter(5); // Start with OpenAI limit

      // Simulate switching to local provider
      const localLimit = rateLimitConfig.getLimitForType('llm', true);
      limiter.setConcurrencyLimit(localLimit);

      assert.strictEqual(limiter.concurrencyLimit, 1, 'Should set serial limit for local');
    });

    test('should adjust rate limits when switching back to OpenAI', () => {
      const { RateLimiter } = require('../../src/utils/rate-limiter');
      const rateLimitConfig = require('../../src/config/rate-limits');

      const limiter = new RateLimiter(1); // Start with local limit

      // Simulate switching to OpenAI provider
      const openaiLimit = rateLimitConfig.getLimitForType('llm', false);
      limiter.setConcurrencyLimit(openaiLimit);

      assert.ok(limiter.concurrencyLimit > 1, 'Should set concurrent limit for OpenAI');
    });

    test('should handle mixed provider configurations', () => {
      const rateLimitConfig = require('../../src/config/rate-limits');

      // Scenario: Local LLM + OpenAI Image + Local Vision
      const llmLimit = rateLimitConfig.getLimitForType('llm', true);      // local
      const imageLimit = rateLimitConfig.getLimitForType('imageGen', false); // OpenAI
      const visionLimit = rateLimitConfig.getLimitForType('vision', true);   // local

      assert.strictEqual(llmLimit, 1, 'Local LLM should be serial');
      assert.ok(imageLimit > 1, 'OpenAI image should be concurrent');
      assert.strictEqual(visionLimit, 1, 'Local vision should be serial');
    });
  });

  describe('Provider interface compatibility', () => {
    test('both LLM providers should have same interface', async () => {
      // Skip if OPENAI_API_KEY not available
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available');
        return;
      }

      const { createLLMProvider } = require('../../src/factory/provider-factory');

      const openaiLLM = createLLMProvider({ mode: 'real', provider: 'openai' });
      const localLLM = createLLMProvider({ mode: 'real', provider: 'local-llm' });

      // Both should have refinePrompt
      assert.strictEqual(typeof openaiLLM.refinePrompt, 'function');
      assert.strictEqual(typeof localLLM.refinePrompt, 'function');

      // Both should have combinePrompts
      assert.strictEqual(typeof openaiLLM.combinePrompts, 'function');
      assert.strictEqual(typeof localLLM.combinePrompts, 'function');
    });

    test('both Image providers should have same interface', () => {
      // Skip if OPENAI_API_KEY not available
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available');
        return;
      }

      const { createImageProvider } = require('../../src/factory/provider-factory');

      const dalleProvider = createImageProvider({ mode: 'real', provider: 'dalle' });
      const fluxProvider = createImageProvider({ mode: 'real', provider: 'flux' });

      // Both should have generateImage
      assert.strictEqual(typeof dalleProvider.generateImage, 'function');
      assert.strictEqual(typeof fluxProvider.generateImage, 'function');
    });

    test('both Vision providers should have same interface', () => {
      // Skip if OPENAI_API_KEY not available
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping - OPENAI_API_KEY not available');
        return;
      }

      const { createVisionProvider } = require('../../src/factory/provider-factory');

      const openaiVision = createVisionProvider({ mode: 'real', provider: 'openai' });
      const localVision = createVisionProvider({ mode: 'real', provider: 'local' });

      // Both should have analyzeImage
      assert.strictEqual(typeof openaiVision.analyzeImage, 'function');
      assert.strictEqual(typeof localVision.analyzeImage, 'function');
    });
  });
});

describe('Error Recovery', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Local LLM service recovery', () => {
    test('should recover after transient service failure', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const provider = new LocalLLMProvider();

      // First call fails
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(503, { error: 'Service temporarily unavailable' });

      // Second call succeeds
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Recovered response', finish_reason: 'stop' }],
          usage: {}
        });

      // First attempt should fail
      await assert.rejects(
        provider.refinePrompt('test', { dimension: 'what' }),
        /Failed to refine prompt/
      );

      // Second attempt should succeed (service recovered)
      const result = await provider.refinePrompt('test', { dimension: 'what' });
      assert.ok(result.refinedPrompt.includes('Recovered'), 'Should succeed after recovery');
    });

    test('should provide clear error message on connection refused', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const provider = new LocalLLMProvider({ apiUrl: 'http://localhost:9999' });

      // Don't mock - let it fail to connect
      nock.enableNetConnect('localhost:9999');

      await assert.rejects(
        provider.refinePrompt('test', { dimension: 'what' }),
        /Cannot reach local LLM service/,
        'Should indicate service is unreachable'
      );
    });

    test('should provide clear error message on server error', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const provider = new LocalLLMProvider();

      // Mock a server error response
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(504, { error: 'Gateway timeout' });

      await assert.rejects(
        provider.refinePrompt('test', { dimension: 'what' }),
        /Failed to refine prompt.*504/,
        'Should include status code in error message'
      );
    });
  });

  describe('Flux service recovery', () => {
    test('should recover after GPU memory error', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const provider = new FluxImageProvider();

      // First call fails with GPU OOM
      nock('http://localhost:8001')
        .post('/generate')
        .reply(500, { error: 'CUDA out of memory' });

      // Second call succeeds (after memory freed)
      nock('http://localhost:8001')
        .post('/generate')
        .reply(200, {
          localPath: '/tmp/recovered_image.png',
          metadata: { model: 'flux-schnell' }
        });

      // First attempt should fail
      await assert.rejects(
        provider.generateImage('test prompt', {}),
        /Failed to generate image.*CUDA out of memory/
      );

      // Second attempt should succeed
      const result = await provider.generateImage('test prompt', {});
      assert.strictEqual(result.localPath, '/tmp/recovered_image.png');
    });

    test('should provide clear error for model not loaded', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const provider = new FluxImageProvider();

      nock('http://localhost:8001')
        .post('/generate')
        .reply(503, { error: 'Model not loaded. Call /load first.' });

      await assert.rejects(
        provider.generateImage('test prompt', {}),
        /Failed to generate image.*Model not loaded/
      );
    });
  });

  describe('Vision service recovery', () => {
    test('should recover after model reload', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');
      const provider = new LocalVisionProvider();

      // First call fails
      nock('http://localhost:8002')
        .post('/analyze')
        .reply(500, { error: 'Model unloaded' });

      // Second call succeeds
      nock('http://localhost:8002')
        .post('/analyze')
        .reply(200, {
          alignmentScore: 85,
          aestheticScore: 7.5,
          analysis: 'Good image'
        });

      // First attempt should fail
      await assert.rejects(
        provider.analyzeImage('/tmp/test.png', 'test'),
        /Failed to analyze image/
      );

      // Second attempt should succeed
      const result = await provider.analyzeImage('/tmp/test.png', 'test');
      assert.strictEqual(result.alignmentScore, 85);
    });

    test('should handle invalid image path gracefully', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');
      const provider = new LocalVisionProvider();

      nock('http://localhost:8002')
        .post('/analyze')
        .reply(400, { error: 'File not found: /nonexistent/image.png' });

      await assert.rejects(
        provider.analyzeImage('/nonexistent/image.png', 'test'),
        /Failed to analyze image.*400/
      );
    });
  });

  describe('Health check based recovery', () => {
    test('should detect unhealthy LLM service', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .get('/health')
        .reply(503, { status: 'unhealthy', error: 'Model loading failed' });

      await assert.rejects(
        provider.healthCheck(),
        /Service unavailable/
      );
    });

    test('should detect healthy service after recovery', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const provider = new LocalLLMProvider();

      // First health check fails
      nock('http://localhost:8003')
        .get('/health')
        .reply(503, { status: 'unhealthy' });

      // Second health check succeeds
      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_loaded: true,
          device: 'cuda'
        });

      // First check fails
      await assert.rejects(provider.healthCheck(), /Service unavailable/);

      // Second check succeeds
      const health = await provider.healthCheck();
      assert.strictEqual(health.status, 'healthy');
    });

    test('should report model_loaded status for informed retry', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const provider = new FluxImageProvider();

      nock('http://localhost:8001')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'flux-schnell',
          model_loaded: false,
          device: 'cuda'
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.status, 'healthy');
      assert.strictEqual(health.model_loaded, false, 'Should indicate model not loaded');
    });
  });

  describe('Graceful degradation', () => {
    test('should fallback to mock provider when local service unavailable', () => {
      const { createLLMProvider } = require('../../src/factory/provider-factory');

      // When local service is unavailable, user can switch to mock for testing
      const mockLLM = createLLMProvider({ mode: 'mock' });

      assert.strictEqual(typeof mockLLM.refinePrompt, 'function');
      assert.strictEqual(typeof mockLLM.combinePrompts, 'function');
    });

    test('should allow creating provider without immediate connection check', () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');

      // Provider creation should succeed even if service is down
      // (connection only happens on first request)
      const provider = new LocalLLMProvider({ apiUrl: 'http://localhost:9999' });

      assert.ok(provider, 'Should create provider instance');
      assert.strictEqual(provider.apiUrl, 'http://localhost:9999');
    });
  });

  describe('Error message clarity', () => {
    test('LLM errors should include service URL', async () => {
      const LocalLLMProvider = require('../../src/providers/local-llm-provider');
      const provider = new LocalLLMProvider({ apiUrl: 'http://localhost:9999' });

      nock.enableNetConnect('localhost:9999');

      try {
        await provider.refinePrompt('test', { dimension: 'what' });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(
          error.message.includes('localhost:9999') || error.message.includes('local LLM service'),
          'Error should reference service location'
        );
      }
    });

    test('Flux errors should include HTTP status', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider');
      const provider = new FluxImageProvider();

      nock('http://localhost:8001')
        .post('/generate')
        .reply(500, { error: 'Internal server error', details: 'GPU crash' });

      try {
        await provider.generateImage('test', {});
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.message.includes('500'), 'Error should include HTTP status');
      }
    });

    test('Vision errors should include analysis context', async () => {
      const LocalVisionProvider = require('../../src/providers/local-vision-provider');
      const provider = new LocalVisionProvider();

      nock('http://localhost:8002')
        .post('/analyze')
        .reply(400, { error: 'Invalid image format' });

      try {
        await provider.analyzeImage('/tmp/bad.gif', 'test prompt');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.message.includes('Failed to analyze'), 'Error should indicate analysis failure');
      }
    });
  });
});
