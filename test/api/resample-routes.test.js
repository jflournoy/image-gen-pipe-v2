/**
 * Tests for Resample Routes
 * POST /api/resample  - img2img resample (cartoon→photoreal two-stage refinement)
 * GET  /api/resample/health - Modal service health check
 *
 * TDD RED phase: tests written before implementation.
 * These tests will FAIL until src/api/resample-routes.js is created.
 */

// Set Modal env vars BEFORE any requires.
// provider-config.js reads process.env at module load time, so these must come first.
const TEST_MODAL_URL = 'https://test-app--resample-abc123.modal.run';
process.env.MODAL_ENDPOINT_URL = TEST_MODAL_URL;
process.env.MODAL_TOKEN_ID = 'test-token-id';
process.env.MODAL_TOKEN_SECRET = 'test-token-secret';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const nock = require('nock');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ---- HTTP helpers ----

function postJSON(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 15000
    }, (res) => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(data);
    req.end();
  });
}

function getJSON(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: urlPath,
      method: 'GET',
      timeout: 15000
    }, (res) => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

// ---- Test Suite ----

test('Resample Routes', async (t) => {
  let server;
  let port;
  let testOutputDir;

  t.before(async () => {
    // Create temp output directory for test-generated images
    testOutputDir = path.join(os.tmpdir(), `resample-test-${Date.now()}`);
    fs.mkdirSync(testOutputDir, { recursive: true });

    // Create a minimal Express app with only the resample router.
    // Dynamic import is required because resample-routes.js is an ES module.
    // In RED phase this import will FAIL (module not found), causing t.before to reject
    // and all tests in this suite to fail — that is the expected RED behavior.
    const app = express();
    app.use(express.json({ limit: '50mb' }));

    const { default: resampleRouter } = await import('../../src/api/resample-routes.js');
    app.use('/api/resample', resampleRouter);

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    port = server.address().port;

    // Block real network traffic; allow only localhost
    nock.disableNetConnect();
    nock.enableNetConnect('localhost');
  });

  t.after(() => {
    if (server) server.close();
    nock.cleanAll();
    nock.enableNetConnect();
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  });

  // ---- Validation tests (400) ----

  await t.test('returns 400 when neither imageBase64 nor imagePath is provided', async () => {
    const res = await postJSON(port, '/api/resample', {
      model: 'sdxl-base',
      prompt: 'photorealistic portrait, bokeh'
    });

    assert.strictEqual(res.status, 400, `Expected 400 but got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error, 'Response should include error message');
    assert.match(res.body.error, /image/i, 'Error should mention missing image source');
  });

  await t.test('returns 400 when model is missing', async () => {
    const res = await postJSON(port, '/api/resample', {
      imageBase64: Buffer.from('fake png data').toString('base64'),
      prompt: 'photorealistic portrait, bokeh'
      // model intentionally omitted
    });

    assert.strictEqual(res.status, 400, `Expected 400 but got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error, 'Response should include error message');
    assert.match(res.body.error, /model/i, 'Error should mention missing model');
  });

  await t.test('returns 400 when prompt is missing', async () => {
    const res = await postJSON(port, '/api/resample', {
      imageBase64: Buffer.from('fake png data').toString('base64'),
      model: 'sdxl-base'
      // prompt intentionally omitted
    });

    assert.strictEqual(res.status, 400, `Expected 400 but got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error, 'Response should include error message');
    assert.match(res.body.error, /prompt/i, 'Error should mention missing prompt');
  });

  // ---- Success path ----

  await t.test('POST /api/resample calls generateImage with inputImage and denoiseStrength', async () => {
    const inputBase64 = Buffer.from('fake PNG input image data').toString('base64');
    const outputBase64 = Buffer.from('fake PNG resampled output').toString('base64');

    let capturedBody = null;

    // Intercept the Modal image generation API call
    nock(TEST_MODAL_URL)
      .post('/')
      .reply(function (_uri, requestBody) {
        capturedBody = requestBody;
        return [200, { image: outputBase64, seed: 99, generation_time: 4.1 }];
      });

    const res = await postJSON(port, '/api/resample', {
      imageBase64: inputBase64,
      model: 'sdxl-base',
      prompt: 'photorealistic portrait, studio lighting',
      denoiseStrength: 0.6,
      steps: 20,
      guidance: 7.5,
      sessionId: 'test-session-resample',
      outputDir: testOutputDir
    });

    assert.strictEqual(
      res.status, 200,
      `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`
    );
    assert.strictEqual(res.body.success, true, 'Response should have success: true');

    // Verify the Modal API was called with the correct img2img fields
    assert.ok(capturedBody, 'Should have made a Modal API call');
    assert.ok(capturedBody.input_image, 'Should have sent input_image to Modal');
    assert.strictEqual(
      capturedBody.denoise_strength, 0.6,
      'Should have sent denoise_strength: 0.6 to Modal'
    );
    assert.strictEqual(
      capturedBody.prompt,
      'photorealistic portrait, studio lighting',
      'Should have forwarded the prompt'
    );
  });

  await t.test('POST /api/resample accepts imagePath as alternative to imageBase64', async () => {
    // Write a temp image file the route can read
    const tmpImagePath = path.join(testOutputDir, 'test-input.png');
    fs.writeFileSync(tmpImagePath, Buffer.from('fake PNG input from path'));

    const outputBase64 = Buffer.from('fake resampled from path').toString('base64');

    nock(TEST_MODAL_URL)
      .post('/')
      .reply(200, { image: outputBase64, seed: 77, generation_time: 3.2 });

    const res = await postJSON(port, '/api/resample', {
      imagePath: tmpImagePath,
      model: 'sdxl-base',
      prompt: 'photorealistic scene',
      denoiseStrength: 0.5,
      outputDir: testOutputDir
    });

    assert.strictEqual(
      res.status, 200,
      `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`
    );
    assert.strictEqual(res.body.success, true);
  });

  // ---- Health endpoint ----

  await t.test('GET /api/resample/health endpoint exists and returns JSON', async () => {
    // With nock blocking external traffic, the health check to Modal will fail.
    // The route should handle this gracefully and return 503 (not 404).
    // A 404 would mean the route does not exist.
    const res = await getJSON(port, '/api/resample/health');

    assert.ok(
      res.status !== 404,
      'Route should exist (got 404 — route is not registered)'
    );
    assert.ok(
      res.status === 200 || res.status === 503 || res.status === 500,
      `Expected 200, 503, or 500 but got ${res.status}`
    );
    assert.ok(
      typeof res.body === 'object',
      'Health endpoint should return a JSON object'
    );
  });
});
