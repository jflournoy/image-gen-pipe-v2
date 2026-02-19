/**
 * 🔴 TDD RED Phase: Modal Batch Image Generation Tests
 *
 * Tests for the batch generation capability of ModalImageProvider.
 * Instead of N separate HTTP requests for N images, batch sends 1 request.
 *
 * These tests WILL FAIL until we implement:
 * - getBatchUrl() method
 * - generateImages() batch method
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

const ModalImageProvider = require('../../src/providers/modal-image-provider.js');

// Minimal valid 1x1 PNG as base64
const TEST_BASE64_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('ModalImageProvider - Batch Generation', () => {
  // Use a URL with the generate-HASH pattern like real Modal deployments
  const testApiUrl = 'https://user--image-gen-diffusion-generate-abc123.modal.run';
  const expectedBatchUrl = 'https://user--image-gen-diffusion-batch-generate.modal.run';
  const testTokenId = 'modal_test_token_id';
  const testTokenSecret = 'modal_test_token_secret';

  let provider;

  beforeEach(() => {
    nock.cleanAll();
    provider = new ModalImageProvider({
      apiUrl: testApiUrl,
      tokenId: testTokenId,
      tokenSecret: testTokenSecret,
      model: 'flux-dev'
    });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getBatchUrl()', () => {
    test('should derive batch URL by replacing generate-HASH with batch-generate', () => {
      const batchUrl = provider.getBatchUrl();
      assert.strictEqual(batchUrl, expectedBatchUrl);
    });

    test('should handle different hash patterns', () => {
      const provider2 = new ModalImageProvider({
        apiUrl: 'https://user--image-gen-diffusion-generate-deadbeef1234.modal.run',
        tokenId: testTokenId,
        tokenSecret: testTokenSecret
      });
      assert.strictEqual(
        provider2.getBatchUrl(),
        'https://user--image-gen-diffusion-batch-generate.modal.run'
      );
    });
  });

  describe('generateImages()', () => {
    test('should exist as a method on the provider', () => {
      assert.strictEqual(typeof provider.generateImages, 'function');
    });

    test('should accept an array of request objects and return array of results', async () => {
      const requests = [
        { prompt: 'a sunset over mountains', options: { iteration: 0, candidateId: 0 } },
        { prompt: 'a cat in a garden', options: { iteration: 0, candidateId: 1 } },
      ];

      nock(testApiUrl)
        .post('/', body => {
          // Verify batch request format
          assert.ok(Array.isArray(body.requests), 'Body should have requests array');
          assert.strictEqual(body.requests.length, 2);
          return true;
        })
        .reply(200, {
          results: [
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 111, inference_time: 5.0 } },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 222, inference_time: 5.5 } },
          ],
          metadata: { total_time: 10.5, count: 2 }
        });

      const results = await provider.generateImages(requests);

      assert.ok(Array.isArray(results), 'Should return an array');
      assert.strictEqual(results.length, 2, 'Should return one result per request');
    });

    test('should send correct payload format with prompts and generation params', async () => {
      let capturedBody = null;

      const requests = [
        { prompt: 'prompt one', options: { seed: 42, steps: 30 } },
        { prompt: 'prompt two', options: { seed: 99, guidance: 7.5 } },
      ];

      nock(testApiUrl)
        .post('/', body => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          results: [
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 42 } },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 99 } },
          ]
        });

      await provider.generateImages(requests);

      assert.ok(capturedBody, 'Should have captured request body');
      assert.ok(Array.isArray(capturedBody.requests), 'Body should have requests array');

      // First request
      assert.strictEqual(capturedBody.requests[0].prompt, 'prompt one');
      assert.strictEqual(capturedBody.requests[0].seed, 42);
      assert.strictEqual(capturedBody.requests[0].steps, 30);
      assert.strictEqual(capturedBody.requests[0].model, 'flux-dev'); // provider default

      // Second request
      assert.strictEqual(capturedBody.requests[1].prompt, 'prompt two');
      assert.strictEqual(capturedBody.requests[1].seed, 99);
      assert.strictEqual(capturedBody.requests[1].guidance, 7.5);
    });

    test('should send auth headers on batch request', async () => {
      let capturedHeaders = null;

      nock(testApiUrl)
        .post('/', () => true)
        .reply(function () {
          capturedHeaders = this.req.headers;
          return [200, {
            results: [
              { image: TEST_BASE64_PNG, format: 'base64', metadata: {} },
            ]
          }];
        });

      await provider.generateImages([
        { prompt: 'test', options: {} }
      ]);

      assert.ok(capturedHeaders, 'Headers should be captured');
      assert.strictEqual(capturedHeaders['modal-key'], testTokenId);
      assert.strictEqual(capturedHeaders['modal-secret'], testTokenSecret);
      assert.strictEqual(capturedHeaders['content-type'], 'application/json');
    });

    test('should return results with localPath and metadata matching input order', async () => {
      nock(testApiUrl)
        .post('/', () => true)
        .reply(200, {
          results: [
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 111, inference_time: 5.0 } },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 222, inference_time: 6.0 } },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 333, inference_time: 4.5 } },
          ]
        });

      const requests = [
        { prompt: 'first', options: { iteration: 0, candidateId: 0 } },
        { prompt: 'second', options: { iteration: 0, candidateId: 1 } },
        { prompt: 'third', options: { iteration: 0, candidateId: 2 } },
      ];

      const results = await provider.generateImages(requests);

      assert.strictEqual(results.length, 3);

      // Each result should have standard provider format
      for (const result of results) {
        assert.ok('metadata' in result, 'Each result should have metadata');
        assert.ok('localPath' in result || result.localPath === null, 'Each result should have localPath key');
      }

      // Verify order matches input (via seed in metadata)
      assert.strictEqual(results[0].metadata.seed, 111);
      assert.strictEqual(results[1].metadata.seed, 222);
      assert.strictEqual(results[2].metadata.seed, 333);
    });

    test('should save images to session directory with correct filenames', async () => {
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');

      // Use temp dir for output
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modal-batch-test-'));

      const sessionProvider = new ModalImageProvider({
        apiUrl: testApiUrl,
        tokenId: testTokenId,
        tokenSecret: testTokenSecret,
        sessionId: 'ses-test123',
        outputDir: tmpDir
      });

      nock(testApiUrl)
        .post('/', () => true)
        .reply(200, {
          results: [
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 1 } },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: { seed: 2 } },
          ]
        });

      const requests = [
        { prompt: 'image one', options: { iteration: 0, candidateId: 0, sessionId: 'ses-test123' } },
        { prompt: 'image two', options: { iteration: 0, candidateId: 1, sessionId: 'ses-test123' } },
      ];

      const results = await sessionProvider.generateImages(requests);

      // Verify images were saved with correct iter/cand naming
      assert.ok(results[0].localPath, 'First result should have localPath');
      assert.ok(results[1].localPath, 'Second result should have localPath');
      assert.ok(results[0].localPath.includes('iter0-cand0.png'), `Expected iter0-cand0.png in path, got: ${results[0].localPath}`);
      assert.ok(results[1].localPath.includes('iter0-cand1.png'), `Expected iter0-cand1.png in path, got: ${results[1].localPath}`);

      // Verify files exist on disk
      const stat0 = await fs.stat(results[0].localPath);
      assert.ok(stat0.size > 0, 'First image file should have content');
      const stat1 = await fs.stat(results[1].localPath);
      assert.ok(stat1.size > 0, 'Second image file should have content');

      // Cleanup
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    test('should include face fixing params in batch request when provided', async () => {
      let capturedBody = null;

      nock(testApiUrl)
        .post('/', body => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          results: [
            { image: TEST_BASE64_PNG, format: 'base64', metadata: {} },
          ]
        });

      await provider.generateImages([
        {
          prompt: 'a portrait',
          options: {
            fix_faces: true,
            restoration_strength: 0.8,
            face_upscale: 2
          }
        }
      ]);

      assert.strictEqual(capturedBody.requests[0].fix_faces, true);
      assert.strictEqual(capturedBody.requests[0].restoration_strength, 0.8);
      assert.strictEqual(capturedBody.requests[0].face_upscale, 2);
    });

    test('should include loras in batch request when provided', async () => {
      let capturedBody = null;

      nock(testApiUrl)
        .post('/', body => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          results: [
            { image: TEST_BASE64_PNG, format: 'base64', metadata: {} },
          ]
        });

      await provider.generateImages([
        {
          prompt: 'styled image',
          options: {
            loras: [{ path: 'style.safetensors', scale: 0.8 }]
          }
        }
      ]);

      assert.ok(capturedBody.requests[0].loras, 'Should include loras');
      assert.strictEqual(capturedBody.requests[0].loras[0].path, 'style.safetensors');
      assert.strictEqual(capturedBody.requests[0].loras[0].scale, 0.8);
    });

    test('should throw on empty requests array', async () => {
      await assert.rejects(
        () => provider.generateImages([]),
        /at least one request/i
      );
    });

    test('should throw on request with empty prompt', async () => {
      await assert.rejects(
        () => provider.generateImages([{ prompt: '', options: {} }]),
        /Prompt is required/i
      );
    });

    test('should handle batch endpoint network error with helpful message', async () => {
      nock(testApiUrl)
        .post('/')
        .replyWithError('connect ENOTFOUND generate.modal.run');

      await assert.rejects(
        () => provider.generateImages([
          { prompt: 'test', options: {} }
        ]),
        /Failed to batch generate/i
      );
    });

    test('should handle batch endpoint 401 auth error', async () => {
      nock(testApiUrl)
        .post('/')
        .reply(401, { error: 'Unauthorized' });

      await assert.rejects(
        () => provider.generateImages([
          { prompt: 'test', options: {} }
        ]),
        /authentication failed/i
      );
    });

    test('should use extended timeout for batch requests based on request count', async () => {
      // Batch of 4 should have longer timeout than single request
      // The timeout should scale with the number of requests
      nock(testApiUrl)
        .post('/', () => true)
        .reply(200, {
          results: [
            { image: TEST_BASE64_PNG, format: 'base64', metadata: {} },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: {} },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: {} },
            { image: TEST_BASE64_PNG, format: 'base64', metadata: {} },
          ]
        });

      const requests = Array(4).fill(null).map((_, i) => ({
        prompt: `test ${i}`,
        options: { iteration: 0, candidateId: i }
      }));

      // Should not throw (timeout should be extended)
      const results = await provider.generateImages(requests);
      assert.strictEqual(results.length, 4);
    });
  });
});
