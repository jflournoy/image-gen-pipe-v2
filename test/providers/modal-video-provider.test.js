/**
 * Tests for Modal Video Provider (WAN I2V)
 * Tests image-to-video generation functionality
 */

const test = require('node:test');
const assert = require('node:assert');
const ModalVideoProvider = require('../../src/providers/modal-video-provider');

test('Modal Video Provider', async (t) => {
  await t.test('constructor validates required configuration', () => {
    const savedUrl = process.env.MODAL_VIDEO_ENDPOINT_URL;
    const savedEndpoint = process.env.MODAL_ENDPOINT_URL;
    const savedTokenId = process.env.MODAL_TOKEN_ID;
    const savedTokenSecret = process.env.MODAL_TOKEN_SECRET;
    delete process.env.MODAL_VIDEO_ENDPOINT_URL;
    delete process.env.MODAL_ENDPOINT_URL;
    delete process.env.MODAL_TOKEN_ID;
    delete process.env.MODAL_TOKEN_SECRET;

    try {
      assert.throws(
        () => new ModalVideoProvider({ apiUrl: null }),
        /Modal endpoint URL is required/
      );

      assert.throws(
        () => new ModalVideoProvider({
          apiUrl: 'https://test.modal.run',
          tokenId: null,
          tokenSecret: 'secret'
        }),
        /Modal authentication required/
      );
    } finally {
      if (savedUrl !== undefined) process.env.MODAL_VIDEO_ENDPOINT_URL = savedUrl;
      if (savedEndpoint !== undefined) process.env.MODAL_ENDPOINT_URL = savedEndpoint;
      if (savedTokenId !== undefined) process.env.MODAL_TOKEN_ID = savedTokenId;
      if (savedTokenSecret !== undefined) process.env.MODAL_TOKEN_SECRET = savedTokenSecret;
    }
  });

  await t.test('constructor accepts valid configuration', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test--generate-video.modal.run',
      tokenId: 'test-id',
      tokenSecret: 'test-secret',
      model: 'wan2.2-i2v-high',
      sessionId: 'test-session',
      outputDir: 'output/test'
    });

    assert.strictEqual(provider.model, 'wan2.2-i2v-high');
    assert.strictEqual(provider.modelType, 'video');
    assert.strictEqual(provider.generation.fps, 24);
    assert.strictEqual(provider.generation.num_frames, 97);
  });

  await t.test('constructor uses environment variables as fallback', () => {
    const savedVideoUrl = process.env.MODAL_VIDEO_ENDPOINT_URL;
    const savedEndpoint = process.env.MODAL_ENDPOINT_URL;
    const savedTokenId = process.env.MODAL_TOKEN_ID;
    const savedTokenSecret = process.env.MODAL_TOKEN_SECRET;

    delete process.env.MODAL_VIDEO_ENDPOINT_URL;
    process.env.MODAL_ENDPOINT_URL = 'https://env-test.modal.run';
    process.env.MODAL_TOKEN_ID = 'env-id';
    process.env.MODAL_TOKEN_SECRET = 'env-secret';

    try {
      const provider = new ModalVideoProvider({});
      assert.strictEqual(provider.apiUrl, 'https://env-test.modal.run');
      assert.strictEqual(provider.tokenId, 'env-id');
      assert.strictEqual(provider.tokenSecret, 'env-secret');
    } finally {
      if (savedVideoUrl !== undefined) process.env.MODAL_VIDEO_ENDPOINT_URL = savedVideoUrl;
      else delete process.env.MODAL_VIDEO_ENDPOINT_URL;
      if (savedEndpoint !== undefined) process.env.MODAL_ENDPOINT_URL = savedEndpoint;
      else delete process.env.MODAL_ENDPOINT_URL;
      if (savedTokenId !== undefined) process.env.MODAL_TOKEN_ID = savedTokenId;
      if (savedTokenSecret !== undefined) process.env.MODAL_TOKEN_SECRET = savedTokenSecret;
    }
  });

  await t.test('generation settings can be customized', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret',
      generation: {
        steps: 40,
        guidance: 5.0,
        fps: 30,
        num_frames: 120
      }
    });

    assert.strictEqual(provider.generation.steps, 40);
    assert.strictEqual(provider.generation.guidance, 5.0);
    assert.strictEqual(provider.generation.fps, 30);
    assert.strictEqual(provider.generation.num_frames, 120);
  });

  await t.test('_getImageTag builds correct format', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    assert.strictEqual(provider._getImageTag({}), null);
    assert.strictEqual(provider._getImageTag({ iteration: 1 }), null);
    assert.strictEqual(provider._getImageTag({ iteration: 1, candidateId: 0 }), 'i1c0');
    assert.strictEqual(provider._getImageTag({ iteration: 5, candidateId: 3 }), 'i5c3');
  });

  await t.test('_buildRequestPayload converts image to base64', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret',
      model: 'wan2.2-i2v-high'
    });

    const imageBuffer = Buffer.from('test image data');
    const payload = provider._buildRequestPayload(imageBuffer, 'a beautiful landscape pan', {
      steps: 35,
      seed: 42
    });

    assert.strictEqual(payload.prompt, 'a beautiful landscape pan');
    assert.strictEqual(payload.model, 'wan2.2-i2v-high');
    assert.strictEqual(payload.steps, 35);
    assert.strictEqual(payload.seed, 42);
    assert.strictEqual(payload.guidance, 4.0);  // Default
    assert.strictEqual(payload.fps, 24);  // Default
    assert.ok(payload.image); // Should be base64 encoded
  });

  await t.test('healthCheck formats error response correctly', async () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://nonexistent.test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    const health = await provider.healthCheck();

    assert.strictEqual(health.available, false);
    assert.strictEqual(health.status, 'error');
    assert.ok(health.error);  // Should have error message
  });

  await t.test('_formatError handles timeout errors', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    const timeoutError = new Error('ETIMEDOUT');
    timeoutError.code = 'ETIMEDOUT';

    const formatted = provider._formatError(timeoutError, 'generate video', 'http://test.com');

    assert.ok(formatted.message.includes('timed out'));
    assert.ok(formatted.message.includes('60-120 seconds'));
  });

  await t.test('_formatError handles authentication errors', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    const authError = new Error('401 Unauthorized');
    authError.response = { status: 401 };

    const formatted = provider._formatError(authError, 'generate video', 'http://test.com');

    assert.ok(formatted.message.includes('authentication failed'));
  });

  await t.test('_formatError handles not found errors', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    const notFoundError = new Error('404 Not Found');
    notFoundError.response = { status: 404 };

    const formatted = provider._formatError(notFoundError, 'generate video', 'http://test.com');

    assert.ok(formatted.message.includes('endpoint not found'));
  });

  await t.test('_formatError handles server errors', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    const serverError = new Error('500 Server Error');
    serverError.response = { status: 500 };

    const formatted = provider._formatError(serverError, 'generate video', 'http://test.com');

    assert.ok(formatted.message.includes('server error'));
  });

  // === Phase 1: guidance_2 (low-noise expert guidance) ===

  await t.test('_buildRequestPayload includes guidance_2 when provided', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret',
      model: 'wan2.2-i2v-high'
    });

    const imageBuffer = Buffer.from('test image data');
    const payload = provider._buildRequestPayload(imageBuffer, 'camera pan', {
      guidance: 5.6,
      guidance_2: 2.0,
    });

    assert.strictEqual(payload.guidance, 5.6);
    assert.strictEqual(payload.guidance_2, 2.0);
  });

  await t.test('_buildRequestPayload omits guidance_2 when not set', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    const imageBuffer = Buffer.from('test image data');
    const payload = provider._buildRequestPayload(imageBuffer, 'camera pan', {});

    assert.strictEqual(payload.guidance, 4.0);
    assert.strictEqual(payload.guidance_2, undefined);
  });

  await t.test('generation settings can include guidance_2', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret',
      generation: {
        steps: 30,
        guidance: 5.6,
        guidance_2: 2.0,
        fps: 24,
        num_frames: 97
      }
    });

    assert.strictEqual(provider.generation.guidance_2, 2.0);

    // Default payload should use generation guidance_2
    const imageBuffer = Buffer.from('test image');
    const payload = provider._buildRequestPayload(imageBuffer, 'test', {});
    assert.strictEqual(payload.guidance_2, 2.0);
  });

  // === Phase 2: Multi-model support (TI2V-5B) ===

  await t.test('_buildRequestPayload uses specified model', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret',
      model: 'wan2.2-i2v-high'
    });

    const imageBuffer = Buffer.from('test image data');
    const payload = provider._buildRequestPayload(imageBuffer, 'test prompt', {
      model: 'wan2.2-ti2v-5b',
      steps: 50,
      guidance: 5.0,
    });

    assert.strictEqual(payload.model, 'wan2.2-ti2v-5b');
    assert.strictEqual(payload.steps, 50);
    assert.strictEqual(payload.guidance, 5.0);
  });

  // === Phase 3: T2V mode (text-to-video, no image) ===

  await t.test('_buildRequestPayload supports T2V mode without image', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret',
      model: 'wan2.2-t2v-14b'
    });

    const payload = provider._buildRequestPayload(null, 'a cat walking', {
      mode: 't2v',
      model: 'wan2.2-t2v-14b',
      height: 480,
      width: 832,
    });

    assert.strictEqual(payload.mode, 't2v');
    assert.strictEqual(payload.image, undefined);
    assert.strictEqual(payload.prompt, 'a cat walking');
    assert.strictEqual(payload.height, 480);
    assert.strictEqual(payload.width, 832);
  });

  await t.test('_buildRequestPayload defaults mode to i2v', () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret'
    });

    const imageBuffer = Buffer.from('test image');
    const payload = provider._buildRequestPayload(imageBuffer, 'test', {});

    // When image is provided and no explicit mode, should default to i2v
    assert.strictEqual(payload.mode, 'i2v');
    assert.ok(payload.image);
  });

  await t.test('generateVideo allows null imageBuffer for T2V mode', async () => {
    const provider = new ModalVideoProvider({
      apiUrl: 'https://nonexistent-test.modal.run',
      tokenId: 'id',
      tokenSecret: 'secret',
      model: 'wan2.2-t2v-14b'
    });

    // Should NOT throw "Image buffer is required" when mode is t2v
    // (will throw network error instead, which is expected)
    try {
      await provider.generateVideo(null, 'a cat walking on a beach', { mode: 't2v' });
    } catch (error) {
      // Should be a network error, NOT an image validation error
      assert.ok(!error.message.includes('Image buffer is required'),
        'T2V mode should not require image buffer');
    }
  });
});
