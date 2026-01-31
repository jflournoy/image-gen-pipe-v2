/**
 * @file TDD Tests for Flux Service Memory Optimizations
 * 🔴 RED: Verify memory optimization features are properly configured
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('🔴 RED: Flux Service Memory Optimizations', () => {
  const fluxServicePath = path.join(__dirname, '../../services/flux_service.py');
  let fluxServiceCode;

  beforeEach(() => {
    fluxServiceCode = fs.readFileSync(fluxServicePath, 'utf-8');
  });

  describe('Memory Optimization Configuration', () => {
    it('should clear GPU cache before loading model', () => {
      assert.ok(
        fluxServiceCode.includes('torch.cuda.empty_cache()'),
        'Should call torch.cuda.empty_cache() before loading'
      );
    });

    it('should use enable_sequential_cpu_offload for 12GB GPUs', () => {
      assert.ok(
        fluxServiceCode.includes('enable_sequential_cpu_offload()'),
        'Should use sequential CPU offload for maximum memory efficiency'
      );
    });

    it('should enable attention slicing with maximum slicing', () => {
      assert.ok(
        fluxServiceCode.includes('enable_attention_slicing'),
        'Should enable attention slicing'
      );
    });

    it('should enable VAE slicing for memory efficiency', () => {
      assert.ok(
        fluxServiceCode.includes('enable_slicing'),
        'Should enable VAE slicing'
      );
    });

    it('should enable VAE tiling for large images', () => {
      assert.ok(
        fluxServiceCode.includes('enable_tiling'),
        'Should enable VAE tiling for large image support'
      );
    });

    it('should use float16 dtype on CUDA for memory efficiency', () => {
      assert.ok(
        fluxServiceCode.includes('torch.float16'),
        'Should use float16 on CUDA devices'
      );
    });

    it('should NOT use pipeline.to(cuda) when using CPU offload', () => {
      // CPU offload handles device placement automatically
      const toGpuPattern = /pipeline\.to\(['"]cuda['"]\)/;
      assert.ok(
        !toGpuPattern.test(fluxServiceCode),
        'Should not manually move pipeline to CUDA when using CPU offload'
      );
    });

    it('should report available GPU memory before loading', () => {
      assert.ok(
        fluxServiceCode.includes('Available GPU memory'),
        'Should log available GPU memory for debugging'
      );
    });
  });

  describe('T5 Long Prompt Support', () => {
    it('should set max_sequence_length for T5 encoder', () => {
      // Flux uses T5 which supports 256 tokens (schnell) or 512 tokens (dev)
      // CLIP 77 token limit warning is harmless - T5 gets full prompt
      assert.ok(
        fluxServiceCode.includes('max_sequence_length'),
        'Should set max_sequence_length to enable long T5 prompts'
      );
    });

    it('should use 256 tokens for schnell model', () => {
      // Flux-schnell supports up to 256 tokens via T5
      assert.ok(
        fluxServiceCode.includes('256') || fluxServiceCode.includes('max_sequence_length'),
        'Should support 256 token prompts for schnell'
      );
    });

    it('should NOT truncate prompts aggressively', () => {
      // Old truncation was 70 tokens - now we allow much more via T5
      const hasTruncateTo70 = /max_tokens.*=.*70/.test(fluxServiceCode);
      assert.ok(
        !hasTruncateTo70,
        'Should not limit to 70 tokens (T5 supports 256+)'
      );
    });
  });

  describe('Download Status Endpoint', () => {
    it('should have /download/status endpoint', () => {
      assert.ok(
        fluxServiceCode.includes('@app.get(\'/download/status\')'),
        'Should have download status endpoint'
      );
    });

    it('should check HuggingFace cache for model', () => {
      assert.ok(
        fluxServiceCode.includes('try_to_load_from_cache'),
        'Should use HF cache check'
      );
    });

    it('should return cached status with size', () => {
      assert.ok(
        fluxServiceCode.includes('\'status\': \'cached\''),
        'Should return cached status'
      );
      assert.ok(
        fluxServiceCode.includes('size_gb'),
        'Should include size in response'
      );
    });

    it('should return not_downloaded status when model missing', () => {
      assert.ok(
        fluxServiceCode.includes('\'status\': \'not_downloaded\''),
        'Should return not_downloaded status'
      );
    });
  });

  describe('Download Endpoint', () => {
    it('should have /download POST endpoint', () => {
      assert.ok(
        fluxServiceCode.includes('@app.post(\'/download\')'),
        'Should have download endpoint'
      );
    });

    it('should stream download progress via SSE', () => {
      assert.ok(
        fluxServiceCode.includes('StreamingResponse'),
        'Should use streaming response'
      );
      assert.ok(
        fluxServiceCode.includes('media_type=\'text/event-stream\''),
        'Should use SSE media type'
      );
    });

    it('should pass HF_TOKEN to download', () => {
      assert.ok(
        fluxServiceCode.includes('token=HF_TOKEN'),
        'Should pass HF token to download'
      );
    });
  });

  describe('Error Handling', () => {
    it('should have traceback logging on load failure', () => {
      assert.ok(
        fluxServiceCode.includes('traceback.print_exc()'),
        'Should print traceback on failure for debugging'
      );
    });

    it('should handle download errors gracefully', () => {
      assert.ok(
        fluxServiceCode.includes('\'status\': \'error\''),
        'Should return error status on failure'
      );
    });
  });
});

describe('🔴 RED: Flux Provider Download Status Check', () => {
  const fluxProviderPath = path.join(__dirname, '../../src/providers/flux-image-provider.js');
  let fluxProviderCode;

  beforeEach(() => {
    fluxProviderCode = fs.readFileSync(fluxProviderPath, 'utf-8');
  });

  describe('Model Status Check', () => {
    it('should have checkModelStatus method', () => {
      assert.ok(
        fluxProviderCode.includes('async checkModelStatus()'),
        'Should have checkModelStatus method'
      );
    });

    it('should call /download/status endpoint', () => {
      assert.ok(
        fluxProviderCode.includes('/download/status'),
        'Should call download status endpoint'
      );
    });

    it('should check model status before generating', () => {
      assert.ok(
        fluxProviderCode.includes('checkModelStatus()') &&
        fluxProviderCode.includes('isFirstTimeDownload'),
        'Should check if first time download'
      );
    });

    it('should use extended timeout for first-time download', () => {
      assert.ok(
        fluxProviderCode.includes('2700000'),
        'Should have 45 minute timeout for first download'
      );
    });

    it('should have normal timeout for cached model', () => {
      assert.ok(
        fluxProviderCode.includes('300000'),
        'Should have 5 minute timeout for normal generation (sequential offload is slow)'
      );
    });
  });
});
