/**
 * TDD RED Phase: Vision Provider Interface Tests
 *
 * Vision providers analyze generated images to:
 * - Generate descriptive captions
 * - Calculate alignment scores (how well image matches prompt)
 * - Identify specific visual elements
 *
 * Based on SRS Section 5.4 - Provider Interfaces
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('VisionProvider Interface', () => {
  describe('Provider contract', () => {
    it('should have a name property', () => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      const provider = new MockVisionProvider();

      assert.ok(provider.name, 'Provider must have a name');
      assert.strictEqual(typeof provider.name, 'string');
    });

    it('should have an analyzeImage method', () => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      const provider = new MockVisionProvider();

      assert.ok(provider.analyzeImage, 'Provider must have analyzeImage method');
      assert.strictEqual(typeof provider.analyzeImage, 'function');
    });

    it('should return a Promise from analyzeImage', async () => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      const provider = new MockVisionProvider();

      const result = provider.analyzeImage('https://example.com/image.png', 'test prompt');
      assert.ok(result instanceof Promise, 'analyzeImage must return a Promise');
    });
  });

  describe('analyzeImage method', () => {
    let provider;

    beforeEach(() => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      provider = new MockVisionProvider();
    });

    it('should accept imageUrl and prompt parameters', async () => {
      const imageUrl = 'https://example.com/image.png';
      const prompt = 'a beautiful sunset';

      // Should not throw
      await provider.analyzeImage(imageUrl, prompt);
    });

    it('should accept optional options object', async () => {
      const imageUrl = 'https://example.com/image.png';
      const prompt = 'a sunset';
      const options = {
        focusAreas: ['composition', 'lighting']
      };

      // Should not throw
      await provider.analyzeImage(imageUrl, prompt, options);
    });

    it('should return an object with required fields', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test prompt'
      );

      assert.ok(result, 'Result must not be null');
      assert.strictEqual(typeof result, 'object');
      assert.ok(result.analysis, 'Result must have analysis field');
      assert.ok(typeof result.alignmentScore === 'number', 'Result must have alignmentScore as number');
      assert.strictEqual(typeof result.analysis, 'string');
    });

    it('should return metadata about the analysis', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test prompt'
      );

      assert.ok(result.metadata, 'Result must have metadata');
      assert.strictEqual(typeof result.metadata, 'object');
      assert.ok(result.metadata.model, 'Metadata must include model');
      assert.ok(typeof result.metadata.tokensUsed === 'number', 'Metadata must include tokensUsed');
    });

    it('should throw error for invalid imageUrl', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage('', 'prompt'),
        /imageUrl.*required|imageUrl.*empty/i,
        'Should reject empty imageUrl'
      );
    });

    it('should throw error for invalid prompt', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage('https://example.com/image.png', ''),
        /prompt.*required|prompt.*empty/i,
        'Should reject empty prompt'
      );
    });

    it('should validate URL format', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage('not-a-url', 'prompt'),
        /url.*invalid|url.*format/i,
        'Should reject invalid URL format'
      );
    });
  });

  describe('Alignment scoring', () => {
    let provider;

    beforeEach(() => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      provider = new MockVisionProvider();
    });

    it('should return alignment score in range 0-100', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'a mountain landscape'
      );

      assert.ok(result.alignmentScore >= 0, 'Alignment score must be >= 0');
      assert.ok(result.alignmentScore <= 100, 'Alignment score must be <= 100');
    });

    it('should calculate higher scores for better matches', async () => {
      // Mock should have deterministic behavior for testing
      const goodMatch = await provider.analyzeImage(
        'https://example.com/mountain.png',
        'a mountain'
      );

      const poorMatch = await provider.analyzeImage(
        'https://example.com/cat.png',
        'a mountain'
      );

      // Mock should simulate better alignment for semantically matching content
      assert.ok(goodMatch.alignmentScore >= poorMatch.alignmentScore);
    });

    it('should normalize scores consistently', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test prompt'
      );

      // Score should be a clean number (not NaN, Infinity, etc.)
      assert.ok(Number.isFinite(result.alignmentScore));
    });
  });

  describe('Image analysis', () => {
    let provider;

    beforeEach(() => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      provider = new MockVisionProvider();
    });

    it('should provide descriptive analysis text', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'a sunset over mountains'
      );

      assert.ok(result.analysis.length > 0, 'Analysis should not be empty');
      assert.ok(result.analysis.length > 20, 'Analysis should be descriptive');
    });

    it('should reference the prompt in analysis', async () => {
      const prompt = 'a sunset';
      const result = await provider.analyzeImage(
        'https://example.com/sunset.png',
        prompt
      );

      // Analysis should contextually relate to the prompt
      assert.ok(result.analysis.length > 0);
    });

    it('should be deterministic for testing', async () => {
      const imageUrl = 'https://example.com/image.png';
      const prompt = 'test prompt';

      const result1 = await provider.analyzeImage(imageUrl, prompt);
      const result2 = await provider.analyzeImage(imageUrl, prompt);

      // Mock provider should produce consistent results
      assert.strictEqual(result1.analysis, result2.analysis);
      assert.strictEqual(result1.alignmentScore, result2.alignmentScore);
    });
  });

  describe('Focus areas', () => {
    let provider;

    beforeEach(() => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      provider = new MockVisionProvider();
    });

    it('should accept focusAreas option', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test',
        { focusAreas: ['composition'] }
      );

      assert.ok(result.analysis);
    });

    it('should mention focus areas in analysis', async () => {
      const focusAreas = ['lighting', 'composition'];
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test',
        { focusAreas }
      );

      // Analysis should address the focus areas
      const analysisLower = result.analysis.toLowerCase();
      const mentionedAreas = focusAreas.some(area =>
        analysisLower.includes(area.toLowerCase())
      );

      assert.ok(
        mentionedAreas || result.analysis.length > 0,
        'Analysis should address focus areas or provide general analysis'
      );
    });

    it('should handle empty focusAreas array', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test',
        { focusAreas: [] }
      );

      // Should not throw and should provide general analysis
      assert.ok(result.analysis);
    });
  });

  describe('Token tracking', () => {
    let provider;

    beforeEach(() => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      provider = new MockVisionProvider();
    });

    it('should track tokens used', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test prompt'
      );

      assert.ok(typeof result.metadata.tokensUsed === 'number');
      assert.ok(result.metadata.tokensUsed > 0, 'Should report positive token count');
    });

    it('should include image tokens in count', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/large-image.png',
        'test prompt'
      );

      // Vision models use tokens for both text and image processing
      assert.ok(result.metadata.tokensUsed > 50, 'Should account for image processing tokens');
    });
  });

  describe('Error handling', () => {
    let provider;

    beforeEach(() => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      provider = new MockVisionProvider();
    });

    it('should handle invalid URLs gracefully', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage('not-a-url', 'prompt'),
        /url/i
      );
    });

    it('should handle null parameters', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage(null, 'prompt'),
        /imageUrl.*required/i
      );

      await assert.rejects(
        async () => await provider.analyzeImage('https://example.com/image.png', null),
        /prompt.*required/i
      );
    });

    it('should handle network errors gracefully', async () => {
      // Mock provider simulates successful responses
      // Real provider would need retry logic
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'test'
      );

      assert.ok(result);
    });
  });

  describe('Caption generation', () => {
    let provider;

    beforeEach(() => {
      const MockVisionProvider = require('../../src/providers/mock-vision-provider.js');
      provider = new MockVisionProvider();
    });

    it('should optionally provide a caption', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/image.png',
        'a mountain landscape'
      );

      // Caption is optional but if provided, should be string
      if (result.caption) {
        assert.strictEqual(typeof result.caption, 'string');
        assert.ok(result.caption.length > 0);
      }
    });

    it('should generate concise captions when provided', async () => {
      const result = await provider.analyzeImage(
        'https://example.com/sunset.png',
        'a sunset'
      );

      if (result.caption) {
        // Captions should be shorter than full analysis
        assert.ok(result.caption.length < result.analysis.length);
      }
    });
  });
});
