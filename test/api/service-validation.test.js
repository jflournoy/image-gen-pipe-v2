/**
 * Test: API Service Validation - Encoder Paths
 *
 * Validates that:
 * 1. API endpoint rejects flux start with local model but missing encoders
 * 2. API endpoint accepts flux start with local model + all encoder paths
 * 3. API endpoint accepts flux start with no model path (HuggingFace)
 * 4. Validation returns 400 Bad Request with clear error message
 *
 * NOTE: These tests require the API server to be running on port 3000
 */

const test = require('node:test');
const assert = require('assert');
const http = require('http');

const API_BASE = 'http://localhost:3000';

/**
 * Helper: Send HTTP POST request
 */
async function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('Server not running on port 3000'));
      } else {
        reject(err);
      }
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Helper: Check if server is running
 */
async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${API_BASE}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

test('🔴 RED: Service API Encoder Path Validation', async (t) => {
  // Check if server is running before running tests
  const serverRunning = await isServerRunning();

  if (!serverRunning) {
    console.log('\n⚠️  API server not running on port 3000');
    console.log('Start server with: npm start');
    console.log('Skipping API validation tests...\n');
    t.skip('API server not running');
    return;
  }

  await t.test('Reject invalid configurations', async (t) => {
    await t.test('should reject flux start with local model but missing encoders', async () => {
      const response = await postJSON('/api/services/flux/start', {
        modelPath: 'services/checkpoints/model.safetensors'
        // Missing encoder paths
      });

      assert.strictEqual(
        response.status,
        400,
        'Should return 400 Bad Request when encoder paths missing'
      );

      assert.ok(response.data.error || response.data.message, 'Should return error message');
      const errorText = (response.data.error || response.data.message || '').toLowerCase();
      assert.match(errorText, /encoder/i, 'Error should mention encoder');
    });

    await t.test('should reject when only CLIP encoder missing', async () => {
      const response = await postJSON('/api/services/flux/start', {
        modelPath: 'services/checkpoints/model.safetensors',
        // Missing textEncoderPath
        textEncoder2Path: 'services/encoders/model.safetensors',
        vaePath: 'services/encoders/ae.safetensors'
      });

      assert.strictEqual(response.status, 400);
      const errorText = (response.data.error || response.data.message || '').toLowerCase();
      assert.match(errorText, /clip/i, 'Error should mention CLIP encoder');
    });

    await t.test('should reject when only T5 encoder missing', async () => {
      const response = await postJSON('/api/services/flux/start', {
        modelPath: 'services/checkpoints/model.safetensors',
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        // Missing textEncoder2Path
        vaePath: 'services/encoders/ae.safetensors'
      });

      assert.strictEqual(response.status, 400);
      const errorText = (response.data.error || response.data.message || '').toLowerCase();
      assert.match(errorText, /t5/i, 'Error should mention T5 encoder');
    });

    await t.test('should reject when only VAE missing', async () => {
      const response = await postJSON('/api/services/flux/start', {
        modelPath: 'services/checkpoints/model.safetensors',
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        textEncoder2Path: 'services/encoders/model.safetensors'
        // Missing vaePath
      });

      assert.strictEqual(response.status, 400);
      const errorText = (response.data.error || response.data.message || '').toLowerCase();
      assert.match(errorText, /vae/i, 'Error should mention VAE encoder');
    });
  });

  await t.test('Accept valid configurations', async (t) => {
    await t.test('should accept flux start with local model + all encoder paths', async () => {
      const response = await postJSON('/api/services/flux/start', {
        modelPath: 'services/checkpoints/flux-dev-fp8.safetensors',
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        textEncoder2Path: 'services/encoders/model.safetensors',
        vaePath: 'services/encoders/ae.safetensors'
      });

      // Should NOT reject validation (may fail for other reasons like port in use)
      assert.notStrictEqual(
        response.status,
        400,
        'Should not return 400 when all encoder paths provided'
      );

      // If there's an error, it should NOT be about missing encoders
      if (response.data.error || response.data.message) {
        const errorText = (response.data.error || response.data.message || '').toLowerCase();
        assert.doesNotMatch(
          errorText,
          /encoder.*missing/i,
          'Error should not be about missing encoders'
        );
      }
    });

    await t.test('should accept flux start with no model path (HuggingFace)', async () => {
      const response = await postJSON('/api/services/flux/start', {
        // No modelPath - using HuggingFace
      });

      // Should skip encoder validation (may fail for other reasons)
      assert.notStrictEqual(
        response.status,
        400,
        'Should not return 400 for HuggingFace model (no validation needed)'
      );
    });
  });
});
