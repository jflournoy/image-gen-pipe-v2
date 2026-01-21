/**
 * Test: Service Manager Encoder Path Validation
 *
 * Validates that:
 * 1. validateFluxEncoderPaths() function exists and is exported
 * 2. Local models require all 3 encoder paths (CLIP-L, T5-XXL, VAE)
 * 3. HuggingFace models skip validation
 * 4. Encoder files must exist on filesystem
 * 5. startService() calls validation before spawning process
 */

const test = require('node:test');
const assert = require('assert');
const path = require('path');

const projectRoot = path.join(__dirname, '../..');

test('🔴 RED: Service Manager Encoder Validation', async (t) => {
  await t.test('validateFluxEncoderPaths() export', async (t) => {
    await t.test('should export validateFluxEncoderPaths function', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      assert.strictEqual(
        typeof ServiceManager.validateFluxEncoderPaths,
        'function',
        'validateFluxEncoderPaths should be exported as a function'
      );
    });
  });

  await t.test('Validation logic', async (t) => {
    await t.test('should return valid=true when all encoder paths provided for local model', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      const result = ServiceManager.validateFluxEncoderPaths({
        modelPath: 'services/checkpoints/flux-dev-fp8.safetensors',
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        textEncoder2Path: 'services/encoders/model.safetensors',
        vaePath: 'services/encoders/ae.safetensors'
      });

      assert.strictEqual(result.valid, true, 'Should validate when all paths provided');
      assert.strictEqual(result.error, undefined, 'Should have no error when valid');
    });

    await t.test('should return valid=false when local model but encoder paths missing', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      const result = ServiceManager.validateFluxEncoderPaths({
        modelPath: 'services/checkpoints/model.safetensors'
        // Missing all encoder paths
      });

      assert.strictEqual(result.valid, false, 'Should be invalid when encoder paths missing');
      assert.ok(result.error, 'Should have error message');
      assert.match(result.error, /encoder/i, 'Error should mention encoder');
    });

    await t.test('should return valid=true when no model path (HuggingFace)', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      const result = ServiceManager.validateFluxEncoderPaths({});

      assert.strictEqual(result.valid, true, 'Should be valid for HuggingFace models (no modelPath)');
    });

    await t.test('should detect missing CLIP-L encoder', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      const result = ServiceManager.validateFluxEncoderPaths({
        modelPath: 'services/checkpoints/model.safetensors',
        // Missing textEncoderPath (CLIP-L)
        textEncoder2Path: 'services/encoders/model.safetensors',
        vaePath: 'services/encoders/ae.safetensors'
      });

      assert.strictEqual(result.valid, false);
      assert.match(result.error, /CLIP/i, 'Error should mention CLIP-L encoder');
    });

    await t.test('should detect missing T5-XXL encoder', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      const result = ServiceManager.validateFluxEncoderPaths({
        modelPath: 'services/checkpoints/model.safetensors',
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        // Missing textEncoder2Path (T5-XXL)
        vaePath: 'services/encoders/ae.safetensors'
      });

      assert.strictEqual(result.valid, false);
      assert.match(result.error, /T5/i, 'Error should mention T5-XXL encoder');
    });

    await t.test('should detect missing VAE encoder', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      const result = ServiceManager.validateFluxEncoderPaths({
        modelPath: 'services/checkpoints/model.safetensors',
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        textEncoder2Path: 'services/encoders/model.safetensors'
        // Missing vaePath
      });

      assert.strictEqual(result.valid, false);
      assert.match(result.error, /VAE/i, 'Error should mention VAE encoder');
    });

    await t.test('should validate encoder files exist on filesystem', () => {
      const ServiceManager = require('../../src/utils/service-manager');
      const result = ServiceManager.validateFluxEncoderPaths({
        modelPath: 'services/checkpoints/flux-dev-fp8.safetensors',
        textEncoderPath: 'nonexistent/path/clip_l.safetensors',
        textEncoder2Path: 'services/encoders/model.safetensors',
        vaePath: 'services/encoders/ae.safetensors'
      });

      assert.strictEqual(result.valid, false, 'Should be invalid when file does not exist');
      assert.match(result.error, /does not exist/i, 'Error should mention file not found');
    });
  });

  await t.test('Integration with startService()', async (t) => {
    await t.test('should return error immediately if validation fails', async () => {
      const ServiceManager = require('../../src/utils/service-manager');

      const result = await ServiceManager.startService('flux', {
        modelPath: 'services/checkpoints/flux-dev-fp8.safetensors'
        // Missing encoder paths
      });

      assert.strictEqual(result.success, false, 'Should fail when validation fails');
      assert.ok(result.error, 'Should return error message');
      assert.match(result.error, /encoder/i, 'Error should mention encoder requirement');
    });

    await t.test('should allow startService with valid encoder paths', async () => {
      const ServiceManager = require('../../src/utils/service-manager');

      const result = await ServiceManager.startService('flux', {
        modelPath: 'services/checkpoints/flux-dev-fp8.safetensors',
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        textEncoder2Path: 'services/encoders/model.safetensors',
        vaePath: 'services/encoders/ae.safetensors'
      });

      // Validation should pass (service may still fail for other reasons like port in use)
      // But it should NOT fail with encoder validation error
      if (!result.success) {
        assert.doesNotMatch(
          result.error || '',
          /encoder.*missing/i,
          'Should not fail validation when all encoder paths provided'
        );
      }
    });
  });
});
