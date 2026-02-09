/**
 * Modal Image Provider Unit Tests
 * Tests for Modal cloud GPU diffusion service integration
 *
 * TDD RED PHASE: These tests define the contract for ModalImageProvider
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

// This import will fail until we implement the provider
const ModalImageProvider = require('../../src/providers/modal-image-provider.js');

describe('ModalImageProvider', () => {
  const testTokenId = 'modal_test_token_id';
  const testTokenSecret = 'modal_test_token_secret';
  const testApiUrl = 'https://your-app--generate.modal.run';
  const testModel = 'flux-dev';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      assert.strictEqual(provider.apiUrl, testApiUrl);
      assert.strictEqual(provider.tokenId, testTokenId);
      assert.strictEqual(provider.tokenSecret, testTokenSecret);
      assert.strictEqual(provider.model, 'flux-dev');
      assert.strictEqual(provider.generation.width, 1024);
      assert.strictEqual(provider.generation.height, 1024);
    });

    test('should accept custom model configuration', () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        model: 'sdxl-turbo',
        generation: {
          width: 512,
          height: 768,
          steps: 4,
          guidance: 0.0
        }
      });

      assert.strictEqual(provider.model, 'sdxl-turbo');
      assert.strictEqual(provider.generation.width, 512);
      assert.strictEqual(provider.generation.height, 768);
      assert.strictEqual(provider.generation.steps, 4);
      assert.strictEqual(provider.generation.guidance, 0.0);
    });

    test('should require apiUrl', () => {
      // Temporarily clear env var
      const originalUrl = process.env.MODAL_ENDPOINT_URL;
      try {
        delete process.env.MODAL_ENDPOINT_URL;
        assert.throws(
          () => new ModalImageProvider({
            tokenId: testTokenId,
            tokenSecret: testTokenSecret
          }),
          /Modal endpoint URL is required/
        );
      } finally {
        if (originalUrl) {
          process.env.MODAL_ENDPOINT_URL = originalUrl;
        }
      }
    });

    test('should require Modal authentication credentials', () => {
      // Temporarily clear env vars
      const originalTokenId = process.env.MODAL_TOKEN_ID;
      const originalTokenSecret = process.env.MODAL_TOKEN_SECRET;
      try {
        delete process.env.MODAL_TOKEN_ID;
        delete process.env.MODAL_TOKEN_SECRET;
        assert.throws(
          () => new ModalImageProvider({
            apiUrl: testApiUrl
          }),
          /Modal authentication required/
        );
      } finally {
        if (originalTokenId) process.env.MODAL_TOKEN_ID = originalTokenId;
        if (originalTokenSecret) process.env.MODAL_TOKEN_SECRET = originalTokenSecret;
      }
    });

    test('should use default timeout of 300s for GPU cold starts', () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      assert.strictEqual(provider.timeout, 300000); // 5 minutes
    });

    test('should accept custom timeout', () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        timeout: 600000 // 10 minutes
      });

      assert.strictEqual(provider.timeout, 600000);
    });

    test('should accept sessionId and outputDir for image saving', () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        sessionId: 'ses-123456',
        outputDir: '/tmp/output'
      });

      assert.strictEqual(provider.sessionId, 'ses-123456');
      assert.strictEqual(provider.outputDir, '/tmp/output');
    });

    test('should read credentials from environment variables', () => {
      const originalTokenId = process.env.MODAL_TOKEN_ID;
      const originalTokenSecret = process.env.MODAL_TOKEN_SECRET;
      const originalUrl = process.env.MODAL_ENDPOINT_URL;

      try {
        process.env.MODAL_TOKEN_ID = 'env_token_id';
        process.env.MODAL_TOKEN_SECRET = 'env_token_secret';
        process.env.MODAL_ENDPOINT_URL = 'https://env-endpoint.modal.run';

        // Clear require cache to pick up new env vars
        delete require.cache[require.resolve('../../src/providers/modal-image-provider.js')];
        const Provider = require('../../src/providers/modal-image-provider.js');

        const provider = new Provider({});

        assert.strictEqual(provider.tokenId, 'env_token_id');
        assert.strictEqual(provider.tokenSecret, 'env_token_secret');
        assert.strictEqual(provider.apiUrl, 'https://env-endpoint.modal.run');
      } finally {
        if (originalTokenId) process.env.MODAL_TOKEN_ID = originalTokenId;
        else delete process.env.MODAL_TOKEN_ID;
        if (originalTokenSecret) process.env.MODAL_TOKEN_SECRET = originalTokenSecret;
        else delete process.env.MODAL_TOKEN_SECRET;
        if (originalUrl) process.env.MODAL_ENDPOINT_URL = originalUrl;
        else delete process.env.MODAL_ENDPOINT_URL;
      }
    });
  });

  describe('Image Generation', () => {
    test('should send correct headers (Modal-Key, Modal-Secret)', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      let capturedHeaders = null;

      nock(testApiUrl)
        .post('/generate', () => true)
        .reply(function(_uri, _body) {
          capturedHeaders = this.req.headers;
          return [200, {
            image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            format: 'base64'
          }];
        });

      await provider.generateImage('test prompt', {});

      assert.ok(capturedHeaders, 'Headers should be captured');
      assert.strictEqual(capturedHeaders['modal-key'], testTokenId);
      assert.strictEqual(capturedHeaders['modal-secret'], testTokenSecret);
      assert.strictEqual(capturedHeaders['content-type'], 'application/json');
    });

    test('should call /generate endpoint with prompt and model', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        model: 'flux-dev'
      });

      let capturedBody = null;

      nock(testApiUrl)
        .post('/generate', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          format: 'base64'
        });

      await provider.generateImage('a beautiful sunset', {
        width: 1024,
        height: 1024,
        steps: 25
      });

      assert.ok(capturedBody, 'Body should be captured');
      assert.strictEqual(capturedBody.prompt, 'a beautiful sunset');
      assert.strictEqual(capturedBody.model, 'flux-dev');
      assert.strictEqual(capturedBody.width, 1024);
      assert.strictEqual(capturedBody.height, 1024);
      assert.strictEqual(capturedBody.steps, 25);
    });

    test('should handle base64 image response', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      // PNG header as base64
      const testBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      nock(testApiUrl)
        .post('/generate')
        .reply(200, {
          image: testBase64,
          format: 'base64',
          metadata: {
            seed: 12345,
            inference_time: 3.5
          }
        });

      const result = await provider.generateImage('test', {});

      assert.ok(result, 'Should return a result');
      assert.ok(result.metadata, 'Should include metadata');
      assert.strictEqual(result.metadata.seed, 12345);
    });

    test('should handle URL image response with download', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      // Modal returns a URL instead of base64
      nock(testApiUrl)
        .post('/generate')
        .reply(200, {
          image_url: 'https://modal-storage.example.com/image.png',
          format: 'url'
        });

      // Mock image download
      nock('https://modal-storage.example.com')
        .get('/image.png')
        .reply(200, Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG header

      const result = await provider.generateImage('test url response', {});

      assert.ok(result, 'Should return a result');
    });

    test('should return standard provider interface format', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        model: 'flux-dev'
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(200, {
          image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          format: 'base64',
          metadata: {
            seed: 42,
            inference_time: 2.5
          }
        });

      const result = await provider.generateImage('a mountain landscape', {
        width: 1024,
        height: 1024
      });

      // Standard provider interface
      assert.ok('url' in result || 'localPath' in result, 'Should have url or localPath');
      assert.ok(result.metadata, 'Should have metadata');
      assert.strictEqual(result.metadata.model, 'flux-dev');
      assert.strictEqual(result.metadata.prompt, 'a mountain landscape');
      assert.strictEqual(result.metadata.width, 1024);
      assert.strictEqual(result.metadata.height, 1024);
    });

    test('should validate prompt is not empty', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      await assert.rejects(
        () => provider.generateImage('', {}),
        /Prompt is required/
      );

      await assert.rejects(
        () => provider.generateImage('   ', {}),
        /Prompt is required/
      );
    });

    test('should use default generation settings', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        generation: {
          width: 512,
          height: 768,
          steps: 20,
          guidance: 7.5
        }
      });

      let capturedBody = null;

      nock(testApiUrl)
        .post('/generate', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          image: 'iVBORw0KGgo=',
          format: 'base64'
        });

      await provider.generateImage('test defaults', {});

      assert.strictEqual(capturedBody.width, 512);
      assert.strictEqual(capturedBody.height, 768);
      assert.strictEqual(capturedBody.steps, 20);
      assert.strictEqual(capturedBody.guidance, 7.5);
    });

    test('should override defaults with per-request options', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        generation: {
          width: 512,
          height: 768
        }
      });

      let capturedBody = null;

      nock(testApiUrl)
        .post('/generate', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          image: 'iVBORw0KGgo=',
          format: 'base64'
        });

      await provider.generateImage('test override', {
        width: 1024,
        height: 1024
      });

      assert.strictEqual(capturedBody.width, 1024);
      assert.strictEqual(capturedBody.height, 1024);
    });
  });

  describe('Error Handling', () => {
    test('should handle Modal cold start timeouts gracefully', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        timeout: 100 // Very short timeout for testing
      });

      nock(testApiUrl)
        .post('/generate')
        .delay(200) // Delay longer than timeout
        .reply(200, { image: 'data' });

      await assert.rejects(
        () => provider.generateImage('test timeout', {}),
        /timeout|cold start/i
      );
    });

    test('should handle authentication errors (401)', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: 'invalid_token',
        tokenSecret: 'invalid_secret'
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(401, { error: 'Unauthorized' });

      await assert.rejects(
        () => provider.generateImage('test', {}),
        /authentication|unauthorized/i
      );
    });

    test('should handle rate limiting (429)', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(429, { error: 'Too Many Requests' });

      await assert.rejects(
        () => provider.generateImage('test', {}),
        /rate limit/i
      );
    });

    test('should handle model not found errors', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        model: 'nonexistent-model'
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(404, { error: 'Model not found: nonexistent-model' });

      await assert.rejects(
        () => provider.generateImage('test', {}),
        /model.*not found|404/i
      );
    });

    test('should handle server errors (500)', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(500, { error: 'Internal Server Error' });

      await assert.rejects(
        () => provider.generateImage('test', {}),
        /Failed to generate image/
      );
    });

    test('should handle network errors gracefully', async () => {
      const provider = new ModalImageProvider({
        apiUrl: 'https://unreachable.modal.example.com',
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      // Don't mock - let it fail
      await assert.rejects(
        () => provider.generateImage('test', {}),
        /Failed to generate image/
      );
    });

    test('should provide helpful error messages for common failures', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(503, { error: 'Service Unavailable' });

      try {
        await provider.generateImage('test', {});
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.message.includes('Modal'), 'Error should mention Modal');
      }
    });
  });

  describe('Health Check', () => {
    test('should call /health endpoint', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      let healthCalled = false;

      nock(testApiUrl)
        .get('/health')
        .reply(function() {
          healthCalled = true;
          return [200, {
            status: 'healthy',
            model: 'flux-dev',
            gpu: 'A10G'
          }];
        });

      await provider.healthCheck();

      assert.strictEqual(healthCalled, true, 'Health endpoint should be called');
    });

    test('should return available=true when Modal service is up', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      nock(testApiUrl)
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'flux-dev',
          gpu: 'A10G'
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.available, true);
      assert.strictEqual(health.status, 'healthy');
    });

    test('should return available=false when Modal service is down', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      nock(testApiUrl)
        .get('/health')
        .reply(503, { error: 'Service Unavailable' });

      const health = await provider.healthCheck();

      assert.strictEqual(health.available, false);
    });

    test('should include model information in health response', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        model: 'sdxl-turbo'
      });

      nock(testApiUrl)
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'sdxl-turbo',
          gpu: 'A10G',
          container_ready: true
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.model, 'sdxl-turbo');
    });

    test('should handle network errors in health check', async () => {
      const provider = new ModalImageProvider({
        apiUrl: 'https://unreachable.modal.example.com',
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });

      const health = await provider.healthCheck();

      assert.strictEqual(health.available, false);
      assert.ok(health.error, 'Should include error information');
    });
  });

  describe('Session Management', () => {
    test('should save image to session directory when session info provided', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        sessionId: 'ses-test-123',
        outputDir: '/tmp/test-output'
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(200, {
          image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          format: 'base64'
        });

      const result = await provider.generateImage('test session', {
        iteration: 1,
        candidateId: 0
      });

      // Should have a local path when session info is provided
      assert.ok(result.localPath, 'Should have localPath');
      assert.ok(result.localPath.includes('ses-test-123'), 'Path should include sessionId');
      assert.ok(result.localPath.includes('iter1-cand0'), 'Path should include iteration and candidate');
    });

    test('should accept sessionId from options override', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        outputDir: '/tmp/test-output'
      });

      nock(testApiUrl)
        .post('/generate')
        .reply(200, {
          image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          format: 'base64'
        });

      const result = await provider.generateImage('test session override', {
        sessionId: 'ses-override-456',
        iteration: 2,
        candidateId: 1
      });

      assert.ok(result.localPath, 'Should have localPath');
      assert.ok(result.localPath.includes('ses-override-456'), 'Path should include override sessionId');
    });
  });

  describe('Model Configuration', () => {
    test('should support different model types', async () => {
      const models = ['flux-dev', 'flux-schnell', 'sdxl-turbo', 'sd3-medium'];

      for (const model of models) {
        const provider = new ModalImageProvider({
          apiUrl: testApiUrl,
          tokenId: testTokenId,
          tokenSecret: testTokenSecret,
          model: model
        });

        assert.strictEqual(provider.model, model);
      }
    });

    test('should include model in generation request', async () => {
      const provider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        model: 'sdxl-turbo'
      });

      let capturedBody = null;

      nock(testApiUrl)
        .post('/generate', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          image: 'iVBORw0KGgo=',
          format: 'base64'
        });

      await provider.generateImage('test model', {});

      assert.strictEqual(capturedBody.model, 'sdxl-turbo');
    });
  });
});
