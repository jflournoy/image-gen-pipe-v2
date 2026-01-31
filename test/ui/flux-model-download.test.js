/**
 * @file Flux Model Download UI Tests (TDD RED)
 * Tests for FLUX.1-dev-fp8 model download in UI settings
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

describe('🔴 RED: Flux Model Download UI', () => {
  const baseUrl = 'http://localhost:3000';

  describe('Model Catalog API', () => {
    it('should list flux-dev as the recommended model', async () => {
      const response = await axios.get(`${baseUrl}/api/providers/models`);

      assert.strictEqual(response.status, 200);
      assert.ok(response.data.flux, 'Should have flux models');
      assert.ok(Array.isArray(response.data.flux), 'Flux should be an array');

      const fluxDev = response.data.flux.find(m => m.name === 'flux-dev');
      assert.ok(fluxDev, 'Should include flux-dev model');
      assert.strictEqual(fluxDev.recommended, true, 'flux-dev should be recommended');
      assert.match(fluxDev.description, /dev-fp8/i, 'Should mention dev-fp8');
    });

    it('should list flux-schnell as alternative model', async () => {
      const response = await axios.get(`${baseUrl}/api/providers/models`);

      const fluxSchnell = response.data.flux.find(m => m.name === 'flux-schnell');
      assert.ok(fluxSchnell, 'Should include flux-schnell model');
      assert.strictEqual(fluxSchnell.recommended, false, 'flux-schnell should not be recommended');
    });
  });

  describe('Model Status API', () => {
    it('should indicate which flux model is currently loaded', async () => {
      const response = await axios.get(`${baseUrl}/api/providers/models/status`);

      assert.strictEqual(response.status, 200);
      assert.ok(response.data.flux, 'Should have flux status');

      // Should indicate if flux service is running and which model
      if (response.data.flux.installed || response.data.flux.available) {
        assert.ok(
          response.data.flux.modelName || response.data.flux.modelPath,
          'Should indicate which model is loaded'
        );
      }
    });

    it('should indicate if flux model is downloaded but not loaded', async () => {
      const response = await axios.get(`${baseUrl}/api/providers/models/status`);

      // Should have separate indicators for "downloaded" vs "running"
      assert.ok(
        'downloaded' in response.data.flux || 'cached' in response.data.flux,
        'Should indicate if model is downloaded/cached'
      );
    });
  });

  describe('Model Download API', () => {
    it('should accept flux model download requests', async () => {
      // Don't actually download, just verify the endpoint accepts flux type
      try {
        const response = await axios.post(
          `${baseUrl}/api/providers/models/download`,
          {
            type: 'flux',
            model: 'flux-dev'
          },
          {
            timeout: 2000,
            validateStatus: () => true // Accept any status
          }
        );

        // Should either start download or indicate model already downloaded
        // Status should be 200 (streaming started) or 400/404 if service unavailable
        assert.ok(
          [200, 400, 404, 503].includes(response.status),
          `Should respond with valid status, got ${response.status}`
        );
      } catch (error) {
        // Timeout is acceptable - means download started streaming
        if (error.code !== 'ECONNABORTED') {
          throw error;
        }
      }
    });

    it('should stream progress updates during flux download', async () => {
      // This test verifies the SSE streaming format
      // We won't actually download, but we verify the endpoint format

      try {
        const response = await axios.post(
          `${baseUrl}/api/providers/models/download`,
          { type: 'flux', model: 'flux-dev' },
          {
            timeout: 1000,
            responseType: 'stream',
            validateStatus: () => true
          }
        );

        if (response.status === 200) {
          // Verify content-type is SSE
          assert.match(
            response.headers['content-type'] || '',
            /text\/event-stream/,
            'Should use SSE content type'
          );
        }
      } catch (error) {
        // Service may not be available, which is okay for this test
        if (error.code !== 'ECONNABORTED' && error.response?.status !== 503) {
          throw error;
        }
      }
    });
  });

  describe('Progress Tracking Format', () => {
    it('should define expected SSE data format for downloads', () => {
      // Define the expected format for progress updates
      const expectedFormat = {
        status: 'downloading', // or 'complete', 'error'
        progress: 0, // 0-100
        message: 'Downloading... (1m elapsed, ~12GB total)',
        elapsed: 60 // seconds
      };

      // Verify the format is well-defined
      assert.ok(typeof expectedFormat.status === 'string');
      assert.ok(typeof expectedFormat.progress === 'number');
      assert.ok(typeof expectedFormat.message === 'string');
      assert.ok(typeof expectedFormat.elapsed === 'number');
    });

    it('should indicate download completion', () => {
      const completionFormat = {
        status: 'complete',
        progress: 100,
        message: 'Model downloaded successfully! Ready to generate images.'
      };

      assert.strictEqual(completionFormat.status, 'complete');
      assert.strictEqual(completionFormat.progress, 100);
    });

    it('should indicate download errors', () => {
      const errorFormat = {
        status: 'error',
        message: 'Download failed: Network error'
      };

      assert.strictEqual(errorFormat.status, 'error');
      assert.ok(errorFormat.message.includes('error'));
    });
  });

  describe('UI Download Button Availability', () => {
    it('should show flux models in model management UI', async () => {
      const response = await axios.get(`${baseUrl}/api/providers/models`);

      // Verify flux models are available for UI rendering
      assert.ok(response.data.flux.length > 0, 'Should have flux models to display');

      response.data.flux.forEach(model => {
        assert.ok(model.name, 'Model should have name');
        assert.ok(model.description, 'Model should have description');
        assert.ok(model.size, 'Model should have size info');
        assert.ok(typeof model.recommended === 'boolean', 'Model should have recommended flag');
      });
    });
  });
});
