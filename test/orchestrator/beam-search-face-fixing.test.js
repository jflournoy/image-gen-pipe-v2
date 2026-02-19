/**
 * Tests for Beam Search integration with face fixing
 * TDD RED phase - these tests should fail initially
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const beamSearch = require('../../src/orchestrator/beam-search');

describe('Beam Search - Face Fixing Integration', () => {
  let mockProviders;

  before(() => {
    // Mock LLM provider
    const mockLLMProvider = {
      async refinePrompt(prompt, _options) {
        return {
          refinedPrompt: `refined: ${prompt}`,
          metadata: { model: 'mock-llm', tokens: 100 }
        };
      },
      async combinePrompts(what, how, _options) {
        return {
          combinedPrompt: `${what}, ${how}`,
          metadata: { model: 'mock-llm', tokens: 150 }
        };
      }
    };

    // Mock Image provider with face fixing support
    const mockImageProvider = {
      modelType: 'flux',
      async generateImage(prompt, options = {}) {
        return {
          url: 'http://example.com/image.png',
          localPath: '/tmp/image.png',
          metadata: {
            model: 'flux-dev',
            prompt: prompt,
            seed: 12345,
            // Face fixing metadata should be included if enabled
            face_fixing: options.fix_faces ? {
              applied: true,
              faces_count: 2,
              restoration_strength: options.restoration_strength || 0.7,
              upscale: options.face_upscale || 1,
              time: 1.5
            } : undefined
          }
        };
      }
    };

    // Mock Vision provider
    const mockVisionProvider = {
      async analyzeImage(_imageReference, _combinedPrompt) {
        return {
          alignmentScore: 85,
          aestheticScore: 9.0,
          metadata: {
            model: 'mock-vision',
            tokensUsed: 200
          }
        };
      }
    };

    mockProviders = {
      llmProvider: mockLLMProvider,
      imageGenProvider: mockImageProvider,
      visionProvider: mockVisionProvider
    };
  });

  describe('Face fixing parameter passing', () => {
    it('should pass face fixing parameters to image provider when enabled', async () => {
      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: mockProviders.imageGenProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: true,  // Enable face fixing
        restorationStrength: 0.8,
        faceUpscale: 2,
        onStepProgress: () => {}
      };

      const result = await beamSearch.beamSearch('portrait of a person', providers, config);

      // Should have face fixing metadata
      assert.ok(result.image, 'Should have generated image');
      assert.ok(result.image.metadata, 'Should have image metadata');
      assert.ok(result.image.metadata.face_fixing, 'Should include face fixing metadata');
      assert.strictEqual(
        result.image.metadata.face_fixing.applied,
        true,
        'Face fixing should be applied'
      );
      assert.strictEqual(
        result.image.metadata.face_fixing.restoration_strength,
        0.8,
        'Should use correct restoration_strength value'
      );
      assert.strictEqual(
        result.image.metadata.face_fixing.upscale,
        2,
        'Should use correct upscale value'
      );
    });

    it('should use default face fixing parameters when not specified', async () => {
      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: mockProviders.imageGenProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: true,  // Enable with defaults
        onStepProgress: () => {}
      };

      const result = await beamSearch.beamSearch('portrait of a person', providers, config);

      assert.ok(result.image.metadata.face_fixing, 'Should include face fixing metadata');
      assert.strictEqual(
        result.image.metadata.face_fixing.restoration_strength,
        0.7,
        'Should use default restoration_strength of 0.7'
      );
      assert.strictEqual(
        result.image.metadata.face_fixing.upscale,
        1,
        'Should use default upscale of 1 (no upscaling)'
      );
    });

    it('should skip face fixing when disabled', async () => {
      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: mockProviders.imageGenProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: false,  // Disabled
        onStepProgress: () => {}
      };

      const result = await beamSearch.beamSearch('portrait of a person', providers, config);

      // Should not have face fixing metadata when disabled
      assert.strictEqual(
        result.image.metadata.face_fixing,
        undefined,
        'Should not include face fixing metadata when disabled'
      );
    });

    it('should omit face fixing metadata when not explicitly set', async () => {
      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: mockProviders.imageGenProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        // No fixFaces parameter
        onStepProgress: () => {}
      };

      const result = await beamSearch.beamSearch('a beautiful sunset', providers, config);

      assert.strictEqual(
        result.image.metadata.face_fixing,
        undefined,
        'Should not include face fixing metadata by default'
      );
    });
  });

  describe('Face fixing with different providers', () => {
    it('should work with Modal provider', async () => {
      const modalProvider = {
        modelType: 'modal-sdxl',
        async generateImage(prompt, options = {}) {
          return {
            url: 'http://example.com/modal-image.png',
            localPath: '/tmp/modal-image.png',
            metadata: {
              model: 'modal-sdxl',
              prompt: prompt,
              face_fixing: options.fix_faces ? {
                applied: true,
                faces_count: 1,
                restoration_strength: options.restoration_strength || 0.7,
                upscale: options.face_upscale || 1,
                time: 2.1
              } : undefined
            }
          };
        }
      };

      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: modalProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: true,
        restorationStrength: 0.9,
        onStepProgress: () => {}
      };

      const result = await beamSearch.beamSearch('close-up portrait', providers, config);

      assert.ok(result.image.metadata.face_fixing, 'Should support face fixing with Modal');
      assert.strictEqual(
        result.image.metadata.face_fixing.restoration_strength,
        0.9,
        'Should pass restoration_strength to Modal provider'
      );
    });

    it('should work with Flux provider', async () => {
      const fluxProvider = {
        modelType: 'flux',
        async generateImage(prompt, options = {}) {
          return {
            url: 'http://example.com/flux-image.png',
            localPath: '/tmp/flux-image.png',
            metadata: {
              model: 'flux-dev',
              prompt: prompt,
              face_fixing: options.fix_faces ? {
                applied: true,
                faces_count: 3,
                restoration_strength: options.restoration_strength || 0.7,
                upscale: options.face_upscale || 1,
                time: 1.8
              } : undefined
            }
          };
        }
      };

      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: fluxProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: true,
        faceUpscale: 2,
        onStepProgress: () => {}
      };

      const result = await beamSearch.beamSearch('group portrait', providers, config);

      assert.ok(result.image.metadata.face_fixing, 'Should support face fixing with Flux');
      assert.strictEqual(
        result.image.metadata.face_fixing.upscale,
        2,
        'Should pass upscale to Flux provider'
      );
    });
  });

  describe('Progress reporting', () => {
    it('should report face fixing progress when enabled', async () => {
      const progressMessages = [];

      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: mockProviders.imageGenProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: true,
        onStepProgress: (progress) => {
          progressMessages.push(progress);
        }
      };

      await beamSearch.beamSearch('portrait', providers, config);

      // Should have progress message for face fixing (or at least not crash)
      // Progress reporting is optional but should work if implemented
      assert.ok(
        progressMessages.length > 0,
        'Should report some progress during beam search'
      );
    });
  });

  describe('Parameter validation', () => {
    it('should handle invalid restoration_strength values gracefully', async () => {
      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: mockProviders.imageGenProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: true,
        restorationStrength: 1.5,  // Invalid: should be 0.0-1.0
        onStepProgress: () => {}
      };

      // Should either clamp to valid range or throw error
      // For now, we'll just ensure it doesn't crash
      await assert.doesNotReject(
        async () => {
          await beamSearch.beamSearch('portrait', providers, config);
        },
        'Should handle invalid restoration_strength without crashing'
      );
    });

    it('should handle invalid upscale values gracefully', async () => {
      const providers = {
        llm: mockProviders.llmProvider,
        imageGen: mockProviders.imageGenProvider,
        vision: mockProviders.visionProvider,
        critiqueGen: { async generateCritique() { return { critique: 'test' }; } }
      };

      const config = {
        beamWidth: 1,
        maxIterations: 1,
        keepTop: 1,
        fixFaces: true,
        faceUpscale: 5,  // Invalid: should be 1 or 2
        onStepProgress: () => {}
      };

      // Should either clamp to valid range or throw error
      await assert.doesNotReject(
        async () => {
          await beamSearch.beamSearch('portrait', providers, config);
        },
        'Should handle invalid upscale without crashing'
      );
    });
  });
});
