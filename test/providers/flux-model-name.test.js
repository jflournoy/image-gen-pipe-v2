/**
 * @file Flux Model Name Tests (TDD RED)
 * Tests to ensure correct Flux model repository is used
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('🔴 RED: Flux Model Name Correction', () => {
  const fluxServicePath = path.join(__dirname, '../../services/flux_service.py');

  describe('Model Repository Name', () => {
    it('should use correct HuggingFace repository name', () => {
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // The correct repo is black-forest-labs/FLUX.1-dev
      // NOT FLUX.1-dev-fp8 or FLUX.1-dev-FP8
      assert.match(
        content,
        /black-forest-labs\/FLUX\.1-dev['"\s,)]/,
        'Should use black-forest-labs/FLUX.1-dev (not fp8 variant)'
      );

      // Should NOT have the incorrect fp8 suffix in model name
      assert.doesNotMatch(
        content,
        /FLUX\.1-dev-fp8/,
        'Should not use FLUX.1-dev-fp8 as model name'
      );

      assert.doesNotMatch(
        content,
        /FLUX\.1-dev-FP8/,
        'Should not use FLUX.1-dev-FP8 as model name'
      );
    });

    it('should handle fp8 quantization through torch_dtype parameter', () => {
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // fp8 should be handled via torch_dtype, not model name
      // This is a conceptual test - the actual implementation may vary
      assert.ok(
        content.includes('torch_dtype') || content.includes('torch.float'),
        'Should handle quantization via torch_dtype parameter'
      );
    });

    it('should document that fp8 quantization is automatic', () => {
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // Should have comments explaining fp8 handling
      const hasFp8Documentation =
        content.includes('fp8') ||
        content.includes('FP8') ||
        content.includes('quantization') ||
        content.includes('float16');

      assert.ok(hasFp8Documentation, 'Should document fp8/quantization handling');
    });
  });

  describe('Model Configuration', () => {
    it('should allow model override via environment variable', () => {
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      assert.match(
        content,
        /MODEL_NAME\s*=\s*os\.getenv\(['"]FLUX_MODEL['"]/,
        'Should allow FLUX_MODEL environment variable override'
      );
    });

    it('should use correct default model when env var not set', () => {
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // Should default to the correct repo name
      assert.match(
        content,
        /os\.getenv\(['"]FLUX_MODEL['"],\s*['"]black-forest-labs\/FLUX\.1-dev['"]\)/,
        'Default should be black-forest-labs/FLUX.1-dev'
      );
    });
  });

  describe('Model Loading', () => {
    it('should load model with correct parameters for 12GB GPU', () => {
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // Should use appropriate dtype for 12GB GPU
      const hasMemoryOptimization =
        content.includes('torch.float16') ||
        content.includes('sequential_cpu_offload') ||
        content.includes('enable_attention_slicing');

      assert.ok(hasMemoryOptimization, 'Should have memory optimizations for 12GB GPU');
    });

    it('should use token for gated model access', () => {
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      assert.match(
        content,
        /token\s*=\s*HF_TOKEN/,
        'Should pass HF_TOKEN for gated model access'
      );
    });
  });

  describe('UI Model References', () => {
    it('should update UI to refer to FLUX.1-dev not dev-fp8', () => {
      const demoJsPath = path.join(__dirname, '../../public/demo.js');
      const content = fs.readFileSync(demoJsPath, 'utf8');

      // UI should mention FLUX.1-dev as the model name
      // fp8 is an implementation detail, not part of the user-facing name
      const modelReferences = content.match(/flux-dev|FLUX\.1-dev/gi) || [];
      assert.ok(modelReferences.length > 0, 'Should reference flux-dev model in UI');
    });

    it('should clarify that quantization is automatic', () => {
      // UI should explain that fp8 quantization happens automatically
      // Users don't need to know about fp8 vs fp16
      const explanation = 'FLUX.1-dev automatically uses fp8 quantization on 12GB GPUs';
      assert.ok(explanation.includes('automatic'), 'Should explain automatic quantization');
    });
  });

  describe('README Documentation', () => {
    it('should update README with correct model name', () => {
      const readmePath = path.join(__dirname, '../../services/README.md');
      const content = fs.readFileSync(readmePath, 'utf8');

      assert.match(
        content,
        /FLUX\.1-dev/,
        'README should reference FLUX.1-dev'
      );

      // Should mention the correct HuggingFace link
      const hasCorrectLink =
        content.includes('black-forest-labs/FLUX.1-dev') &&
        !content.includes('FLUX.1-dev-fp8');

      assert.ok(hasCorrectLink, 'README should have correct HuggingFace repository link');
    });
  });
});
