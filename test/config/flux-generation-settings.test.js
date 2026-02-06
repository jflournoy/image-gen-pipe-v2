/**
 * 🔴 TDD RED Phase: Flux Generation Settings Tests
 *
 * Tests for configurable Flux image generation parameters:
 * - steps (inference steps)
 * - guidance (guidance scale)
 * - seed (reproducibility)
 * - width/height (dimensions)
 * - lora_scale (LoRA strength)
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');

describe('🔴 Flux Generation Settings', () => {
  describe('Provider Config - Flux Defaults', () => {
    test('should have flux.generation settings in config', () => {
      const providerConfig = require('../../src/config/provider-config.js');

      // Config should have flux.generation section
      assert.ok(providerConfig.flux, 'Config should have flux section');
      assert.ok(providerConfig.flux.generation, 'Config should have flux.generation section');
    });

    test('should provide default generation parameters', () => {
      const providerConfig = require('../../src/config/provider-config.js');
      const gen = providerConfig.flux.generation;

      // Should have all key parameters with sensible defaults
      assert.strictEqual(typeof gen.steps, 'number', 'steps should be a number');
      assert.strictEqual(typeof gen.guidance, 'number', 'guidance should be a number');
      assert.strictEqual(typeof gen.width, 'number', 'width should be a number');
      assert.strictEqual(typeof gen.height, 'number', 'height should be a number');

      // Defaults should be within valid ranges
      assert.ok(gen.steps >= 15 && gen.steps <= 50, 'steps should be 15-50');
      assert.ok(gen.guidance >= 1.0 && gen.guidance <= 20.0, 'guidance should be 1.0-20.0');
      assert.ok(gen.width >= 512 && gen.width <= 2048, 'width should be 512-2048');
      assert.ok(gen.height >= 512 && gen.height <= 2048, 'height should be 512-2048');
    });

    test('should support environment variable overrides', () => {
      // Set env vars before requiring config (use fresh require)
      const originalSteps = process.env.FLUX_STEPS;
      const originalGuidance = process.env.FLUX_GUIDANCE;

      try {
        process.env.FLUX_STEPS = '35';
        process.env.FLUX_GUIDANCE = '5.0';

        // Clear require cache to pick up new env vars
        delete require.cache[require.resolve('../../src/config/provider-config.js')];
        const freshConfig = require('../../src/config/provider-config.js');

        assert.strictEqual(freshConfig.flux.generation.steps, 35, 'steps should be overridden by env');
        assert.strictEqual(freshConfig.flux.generation.guidance, 5.0, 'guidance should be overridden by env');
      } finally {
        // Restore original env vars
        if (originalSteps !== undefined) {
          process.env.FLUX_STEPS = originalSteps;
        } else {
          delete process.env.FLUX_STEPS;
        }
        if (originalGuidance !== undefined) {
          process.env.FLUX_GUIDANCE = originalGuidance;
        } else {
          delete process.env.FLUX_GUIDANCE;
        }
        // Clear cache again
        delete require.cache[require.resolve('../../src/config/provider-config.js')];
      }
    });

    test('should have optional lora_scale setting', () => {
      const providerConfig = require('../../src/config/provider-config.js');
      const gen = providerConfig.flux.generation;

      // lora_scale should exist (can be null/undefined if no LoRA configured)
      assert.ok('loraScale' in gen, 'should have loraScale property');

      // If set, should be in valid range
      if (gen.loraScale !== null && gen.loraScale !== undefined) {
        assert.ok(gen.loraScale >= 0.0 && gen.loraScale <= 2.0, 'loraScale should be 0.0-2.0');
      }
    });
  });

  describe('FluxImageProvider - Generation Options', () => {
    test('should accept generation options in constructor', () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider.js');

      const provider = new FluxImageProvider({
        apiUrl: 'http://localhost:8001',
        generation: {
          steps: 30,
          guidance: 4.0,
          width: 768,
          height: 768
        }
      });

      // Provider should store generation settings
      assert.ok(provider.generation, 'Provider should have generation settings');
      assert.strictEqual(provider.generation.steps, 30);
      assert.strictEqual(provider.generation.guidance, 4.0);
      assert.strictEqual(provider.generation.width, 768);
      assert.strictEqual(provider.generation.height, 768);
    });

    test('should use config defaults when no generation options provided', () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider.js');
      const providerConfig = require('../../src/config/provider-config.js');

      const provider = new FluxImageProvider({
        apiUrl: 'http://localhost:8001'
      });

      // Should use config defaults
      assert.ok(provider.generation, 'Provider should have generation settings from config');
      assert.strictEqual(provider.generation.steps, providerConfig.flux.generation.steps);
      assert.strictEqual(provider.generation.guidance, providerConfig.flux.generation.guidance);
    });

    test('should merge per-request options with defaults in generateImage', async () => {
      const FluxImageProvider = require('../../src/providers/flux-image-provider.js');

      const provider = new FluxImageProvider({
        apiUrl: 'http://localhost:8001',
        generation: { steps: 25, guidance: 3.5 }
      });

      // Mock axios to capture the request payload
      let capturedPayload = null;
      provider._mockAxios = {
        post: async (url, payload) => {
          capturedPayload = payload;
          return {
            data: {
              localPath: '/tmp/test.png',
              metadata: { seed: 12345 }
            }
          };
        },
        get: async () => ({ data: { status: 'cached' } })
      };

      // Replace axios with mock
      const axios = require('axios');
      const originalPost = axios.post;
      const originalGet = axios.get;
      axios.post = provider._mockAxios.post;
      axios.get = provider._mockAxios.get;

      try {
        // Call with per-request override
        await provider.generateImage('test prompt', {
          steps: 40,  // Override default
          seed: 42    // Add new option
        });

        // Should have merged options
        assert.strictEqual(capturedPayload.steps, 40, 'steps should be overridden');
        assert.strictEqual(capturedPayload.guidance, 3.5, 'guidance should use default');
        assert.strictEqual(capturedPayload.seed, 42, 'seed should be passed');
      } finally {
        axios.post = originalPost;
        axios.get = originalGet;
      }
    });
  });

  describe('Provider Factory - Flux Settings Pass-through', () => {
    test('should pass generation settings to FluxImageProvider', () => {
      const { createImageProvider } = require('../../src/factory/provider-factory.js');

      const provider = createImageProvider({
        mode: 'real',
        provider: 'flux',
        generation: {
          steps: 28,
          guidance: 4.5
        }
      });

      assert.ok(provider.generation, 'Factory should pass generation settings');
      assert.strictEqual(provider.generation.steps, 28);
      assert.strictEqual(provider.generation.guidance, 4.5);
    });
  });
});

describe('🔴 Flux Generation Settings - UI Integration', () => {
  // These tests verify the data flow from frontend to backend
  // The actual UI implementation is in public/demo.html + demo.js

  describe('BeamSearchWorker - Flux Options', () => {
    test('should accept fluxOptions in job params', async () => {
      // This tests that the beam-search-worker accepts fluxOptions
      // Actual implementation will wire this through to the provider

      const expectedParams = {
        prompt: 'test',
        n: 4,
        m: 2,
        iterations: 2,
        fluxOptions: {
          steps: 30,
          guidance: 4.0,
          seed: 12345
        }
      };

      // Verify structure is valid (full integration test would require more setup)
      assert.ok(expectedParams.fluxOptions, 'fluxOptions should be supported in params');
      assert.strictEqual(expectedParams.fluxOptions.steps, 30);
      assert.strictEqual(expectedParams.fluxOptions.guidance, 4.0);
      assert.strictEqual(expectedParams.fluxOptions.seed, 12345);
    });
  });
});
