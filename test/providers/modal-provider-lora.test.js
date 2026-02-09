/**
 * 🔴 TDD RED: Modal Image Provider LoRA Support Tests
 *
 * Tests for passing multiple LoRA configs from JS provider to Modal service.
 * These tests define the expected behavior before implementation.
 */

import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Read the provider file for structural validation
const PROVIDER_PATH = path.join(process.cwd(), 'src/providers/modal-image-provider.js');

describe('Modal Image Provider LoRA Support - Structural Tests', () => {
  let providerContent;

  before(() => {
    providerContent = fs.readFileSync(PROVIDER_PATH, 'utf-8');
  });

  describe('Constructor Options', () => {
    it('should accept loras option in constructor', () => {
      // Expected: constructor handles options.loras or options.generation.loras
      const hasLorasOption =
        providerContent.includes('options.loras') ||
        providerContent.includes('options.generation.loras') ||
        providerContent.includes('configDefaults.loras');
      assert.ok(hasLorasOption, 'Constructor should accept loras option');
    });

    it('should store default loras in generation settings', () => {
      // Expected: this.generation.loras or this.loras
      const storesLoras =
        providerContent.includes('this.generation.loras') ||
        providerContent.includes('this.loras');
      assert.ok(storesLoras, 'Should store default loras in instance');
    });
  });

  describe('generateImage Method', () => {
    it('should accept loras option in generateImage options', () => {
      // Expected: options.loras referenced somewhere in the file (used in generateImage)
      const hasLorasInOptions = providerContent.includes('options.loras');
      assert.ok(hasLorasInOptions, 'generateImage should accept options.loras');
    });

    it('should include loras in request payload', () => {
      // Expected: payload.loras = ... or loras: options.loras
      const hasLorasInPayload =
        providerContent.includes('payload.loras') ||
        providerContent.match(/loras:\s*options\.loras/);
      assert.ok(hasLorasInPayload, 'Should include loras in request payload');
    });

    it('should merge per-request loras with default loras', () => {
      // Expected: options.loras ?? this.generation.loras or similar
      const mergesLoras =
        providerContent.includes('options.loras ?? this.generation.loras') ||
        providerContent.includes('options.loras || this.generation.loras') ||
        providerContent.includes('options.loras ?? this.loras');
      assert.ok(mergesLoras, 'Should merge per-request loras with defaults');
    });

    it('should only include loras in payload when defined', () => {
      // Expected: conditional inclusion like if (loras && Array.isArray(loras))
      const conditionallyIncludesLoras =
        providerContent.includes('if (loras') ||
        providerContent.match(/if\s*\(\s*loras\s*&&/);
      assert.ok(conditionallyIncludesLoras, 'Should only include loras when defined');
    });
  });

  describe('LoRA Format Validation', () => {
    it('should support array of LoRA configs with path and scale', () => {
      // Expected: Documentation or code handling loras as array of {path, scale}
      const hasLoraFormatHandling =
        providerContent.includes('path') &&
        providerContent.includes('scale') &&
        providerContent.includes('loras');
      assert.ok(hasLoraFormatHandling, 'Should handle LoRA array format with path and scale');
    });
  });

  describe('Response Metadata', () => {
    it('should include loras in response metadata', () => {
      // Expected: metadata.loras or result.metadata?.loras
      const hasLoraMetadata =
        providerContent.includes('metadata.loras') ||
        providerContent.includes('loras: result.metadata?.loras') ||
        providerContent.match(/loras:\s*.*metadata.*loras/);
      assert.ok(hasLoraMetadata, 'Should include loras in response metadata');
    });
  });
});

describe('Modal Image Provider LoRA Runtime Tests', () => {
  /**
   * These tests validate runtime behavior with the provider instance.
   * Note: We can't easily mock axios in ESM, so we test what we can without network calls.
   */

  let ModalImageProvider;
  let originalEnv;

  before(async () => {
    // Save original env
    originalEnv = { ...process.env };

    // Set required env vars
    process.env.MODAL_ENDPOINT_URL = 'https://test-modal.run/generate';
    process.env.MODAL_TOKEN_ID = 'test-token-id';
    process.env.MODAL_TOKEN_SECRET = 'test-token-secret';

    // Import provider using dynamic import for CommonJS in ESM context
    const module = await import('../../src/providers/modal-image-provider.js');
    ModalImageProvider = module.default || module;
  });

  after(() => {
    // Restore env
    process.env = originalEnv;
  });

  describe('Constructor with LoRAs', () => {
    it('should accept loras in constructor options', () => {
      const loras = [
        { path: 'style.safetensors', scale: 0.8 },
        { path: 'character.safetensors', scale: 0.6 },
      ];

      const provider = new ModalImageProvider({
        apiUrl: 'https://test.modal.run/generate',
        tokenId: 'test-id',
        tokenSecret: 'test-secret',
        generation: { loras },
      });

      // Check if loras are stored
      assert.ok(provider.generation?.loras, 'Provider should store loras in generation');
      assert.deepStrictEqual(provider.generation.loras, loras, 'Stored loras should match input');
    });

    it('should default loras to undefined when not provided', () => {
      const provider = new ModalImageProvider({
        apiUrl: 'https://test.modal.run/generate',
        tokenId: 'test-id',
        tokenSecret: 'test-secret',
      });

      // Check that loras are undefined, not an empty array
      assert.strictEqual(provider.generation?.loras, undefined, 'Default loras should be undefined');
    });

    it('should accept loras directly in options (not in generation)', () => {
      const loras = [{ path: 'direct.safetensors', scale: 0.9 }];

      const provider = new ModalImageProvider({
        apiUrl: 'https://test.modal.run/generate',
        tokenId: 'test-id',
        tokenSecret: 'test-secret',
        loras, // Direct option, not nested in generation
      });

      // Should still be available in generation
      assert.deepStrictEqual(provider.generation?.loras, loras, 'Direct loras should be stored');
    });
  });

  describe('LoRA Configuration Validation', () => {
    it('should store multiple LoRAs with different scales', () => {
      const loras = [
        { path: 'style-anime.safetensors', scale: 0.8 },
        { path: 'character.safetensors', scale: 0.6 },
        { path: 'lighting.safetensors', scale: 0.4 },
        { path: 'details.safetensors', scale: 0.2 },
      ];

      const provider = new ModalImageProvider({
        apiUrl: 'https://test.modal.run/generate',
        tokenId: 'test-id',
        tokenSecret: 'test-secret',
        generation: { loras },
      });

      assert.strictEqual(provider.generation.loras.length, 4, 'Should store all 4 LoRAs');
      assert.strictEqual(provider.generation.loras[0].scale, 0.8, 'First LoRA scale should be 0.8');
      assert.strictEqual(provider.generation.loras[3].scale, 0.2, 'Fourth LoRA scale should be 0.2');
    });

    it('should preserve LoRA paths exactly as provided', () => {
      const loras = [
        { path: 'models/loras/custom-style.safetensors', scale: 1.0 },
      ];

      const provider = new ModalImageProvider({
        apiUrl: 'https://test.modal.run/generate',
        tokenId: 'test-id',
        tokenSecret: 'test-secret',
        generation: { loras },
      });

      assert.strictEqual(
        provider.generation.loras[0].path,
        'models/loras/custom-style.safetensors',
        'Path should be preserved exactly'
      );
    });
  });
});
