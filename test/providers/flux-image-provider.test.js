/**
 * @file Flux Image Provider Tests (TDD RED)
 * Tests for local Flux/SDXL image generation provider
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');
const FluxImageProvider = require('../../src/providers/flux-image-provider.js');

describe('🔴 RED: FluxImageProvider', () => {
  const testApiUrl = 'http://localhost:8001';
  let provider;

  before(() => {
    provider = new FluxImageProvider({
      apiUrl: testApiUrl,
      model: 'auraRENDERXL_v30'
    });
  });

  after(() => {
    nock.cleanAll();
  });

  describe('Constructor', () => {
    it('should initialize with API URL and model configuration', () => {
      assert.ok(provider, 'Provider should be instantiated');
      assert.strictEqual(provider.apiUrl, testApiUrl);
      assert.strictEqual(provider.model, 'auraRENDERXL_v30');
    });

    it('should use default API URL if not provided', () => {
      const defaultProvider = new FluxImageProvider({});
      assert.strictEqual(defaultProvider.apiUrl, 'http://localhost:8001');
    });

    it('should use default model if not provided', () => {
      const defaultProvider = new FluxImageProvider({});
      assert.ok(defaultProvider.model);
    });
  });

  describe('generateImage', () => {
    it('should generate image and return local path', async () => {
      const mockResponse = {
        localPath: '/output/2026-01-08/ses-120000/image-cand-0.png',
        metadata: {
          model: 'auraRENDERXL_v30',
          prompt: 'a magical forest scene',
          seed: 42,
          steps: 30,
          guidance: 7.5
        }
      };

      nock(testApiUrl)
        .post('/generate', body => {
          return body.prompt === 'a magical forest scene';
        })
        .reply(200, mockResponse);

      const result = await provider.generateImage('a magical forest scene');

      assert.ok(result.localPath);
      assert.ok(result.localPath.endsWith('.png'));
      assert.ok(result.metadata);
      assert.strictEqual(result.url, undefined); // Local provider doesn't return URLs
    });

    it('should support custom generation parameters', async () => {
      const mockResponse = {
        localPath: '/output/test.png',
        metadata: {}
      };

      nock(testApiUrl)
        .post('/generate', body => {
          return body.height === 1024 &&
                 body.width === 768 &&
                 body.steps === 50 &&
                 body.guidance === 8.5 &&
                 body.seed === 12345;
        })
        .reply(200, mockResponse);

      const result = await provider.generateImage('test prompt', {
        height: 1024,
        width: 768,
        steps: 50,
        guidance: 8.5,
        seed: 12345
      });

      assert.ok(result.localPath);
    });

    it('should support negative prompts', async () => {
      const mockResponse = {
        localPath: '/output/test.png',
        metadata: {}
      };

      nock(testApiUrl)
        .post('/generate', body => {
          return body.negativePrompt === 'blurry, low quality, distorted';
        })
        .reply(200, mockResponse);

      const result = await provider.generateImage('fantasy scene', {
        negativePrompt: 'blurry, low quality, distorted'
      });

      assert.ok(result.localPath);
    });

    it('should support LoRA configuration', async () => {
      const mockResponse = {
        localPath: '/output/test.png',
        metadata: {}
      };

      const loraConfig = [
        {
          path: 'models/lora/fantasy-style.safetensors',
          trigger: 'fantasy style, magical',
          weight: 0.7
        }
      ];

      nock(testApiUrl)
        .post('/generate', body => {
          return body.loras &&
                 Array.isArray(body.loras) &&
                 body.loras[0].weight === 0.7;
        })
        .reply(200, mockResponse);

      const result = await provider.generateImage('test prompt', {
        loras: loraConfig
      });

      assert.ok(result.localPath);
    });

    it('should include revised prompt in metadata if model provides it', async () => {
      const mockResponse = {
        localPath: '/output/test.png',
        metadata: {
          revisedPrompt: 'enhanced version of the original prompt'
        }
      };

      nock(testApiUrl)
        .post('/generate')
        .reply(200, mockResponse);

      const result = await provider.generateImage('original prompt');

      assert.ok(result.localPath);
      assert.strictEqual(result.revisedPrompt, 'enhanced version of the original prompt');
    });

    it('should handle API errors gracefully', async () => {
      nock(testApiUrl)
        .post('/generate')
        .reply(500, { error: 'Generation failed' });

      await assert.rejects(
        async () => {
          await provider.generateImage('test prompt');
        },
        {
          message: /Failed to generate image/
        }
      );
    });

    it('should handle timeout errors', async () => {
      nock(testApiUrl)
        .post('/generate')
        .delayConnection(120000) // 2 minute delay
        .reply(200, { localPath: '/output/test.png' });

      await assert.rejects(
        async () => {
          await provider.generateImage('test prompt');
        },
        {
          message: /timeout/i
        }
      );
    });

    it('should validate that localPath is returned', async () => {
      const mockResponse = {
        // Missing localPath
        metadata: {}
      };

      nock(testApiUrl)
        .post('/generate')
        .reply(200, mockResponse);

      await assert.rejects(
        async () => {
          await provider.generateImage('test prompt');
        },
        {
          message: /localPath/
        }
      );
    });
  });

  describe('Health Check', () => {
    it('should provide a health check endpoint', async () => {
      nock(testApiUrl)
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'auraRENDERXL_v30',
          gpu: { available: true, memory: '12GB' }
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.status, 'healthy');
      assert.ok(health.model);
    });

    it('should handle service unavailable', async () => {
      nock(testApiUrl)
        .get('/health')
        .reply(503);

      await assert.rejects(
        async () => {
          await provider.healthCheck();
        },
        {
          message: /Service unavailable/
        }
      );
    });
  });
});
