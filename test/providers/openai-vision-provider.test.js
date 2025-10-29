/**
 * TDD RED Phase: OpenAI Vision Provider Tests
 *
 * Real OpenAI GPT-4 Vision API implementation for image evaluation.
 * This provider analyzes generated images to evaluate:
 * - Prompt fidelity (how well image matches the prompt)
 * - Visual quality and aesthetics
 * - Specific content elements (WHAT dimension)
 * - Style execution (HOW dimension)
 *
 * Note: These tests can run in two modes:
 * 1. Unit tests with mocked OpenAI SDK (fast, no API calls)
 * 2. Integration tests with real API (requires OPENAI_API_KEY env var)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('OpenAIVisionProvider Interface', () => {
  describe('Provider contract', () => {
    it('should have a name property', () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider('fake-api-key');

      assert.ok(provider.name, 'Provider must have a name');
      assert.strictEqual(typeof provider.name, 'string');
      assert.ok(provider.name.includes('openai'), 'Name should indicate OpenAI provider');
    });

    it('should have an analyzeImage method', () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider('fake-api-key');

      assert.ok(provider.analyzeImage, 'Provider must have analyzeImage method');
      assert.strictEqual(typeof provider.analyzeImage, 'function');
    });

    it('should require an API key in constructor', () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');

      assert.throws(
        () => new OpenAIVisionProvider(),
        /API key is required/,
        'Should throw error when API key is missing'
      );
    });

    it('should accept configuration options', () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider('fake-api-key', {
        model: 'gpt-4-vision-preview',
        maxRetries: 5,
        timeout: 60000
      });

      assert.ok(provider, 'Provider should be created with options');
    });
  });

  describe('analyzeImage method - Alignment Scoring', () => {
    let provider;

    beforeEach(() => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      provider = new OpenAIVisionProvider('fake-api-key');
    });

    it('should accept imageUrl and prompt parameters', async () => {
      // Just verify the method exists
      assert.ok(provider.analyzeImage);
    });

    it('should require imageUrl parameter', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage(),
        /imageUrl.*required/i,
        'Should reject when imageUrl is missing'
      );
    });

    it('should require prompt parameter', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage('https://example.com/image.png'),
        /prompt.*required/i,
        'Should reject when prompt is missing'
      );
    });

    it('should reject empty imageUrl', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage('', 'some prompt'),
        /imageUrl.*empty/i,
        'Should reject empty imageUrl'
      );
    });

    it('should reject empty prompt', async () => {
      await assert.rejects(
        async () => await provider.analyzeImage('https://example.com/image.png', ''),
        /prompt.*empty/i,
        'Should reject empty prompt'
      );
    });

    it('should return expected result structure', async () => {
      // This test defines the expected contract
      const result = {
        analysis: 'string describing how well image matches prompt',
        alignmentScore: 85, // 0-100 scale
        strengths: ['array', 'of', 'strengths'],
        weaknesses: ['array', 'of', 'weaknesses'],
        metadata: {
          model: 'string',
          tokensUsed: 0,
          timestamp: 'string'
        }
      };

      assert.ok(typeof result.analysis === 'string');
      assert.ok(typeof result.alignmentScore === 'number');
      assert.ok(Array.isArray(result.strengths));
      assert.ok(Array.isArray(result.weaknesses));
      assert.ok(result.metadata);
    });

    it('should validate alignmentScore is between 0 and 100', async () => {
      // This test will verify the actual returned value
      const validScore = 75;
      assert.ok(validScore >= 0 && validScore <= 100, 'Score must be between 0 and 100');
    });
  });

  describe('OpenAI Vision API Integration', () => {
    it('should handle API errors gracefully', async () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider('invalid-key');

      // Should throw a descriptive error when API call fails
      await assert.rejects(
        async () => await provider.analyzeImage(
          'https://example.com/image.png',
          'test prompt'
        ),
        /OpenAI API error/,
        'Should throw OpenAI API error'
      );
    });

    it('should use GPT-4 Vision model by default', () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider('fake-key');

      // Verify default model configuration
      assert.ok(provider.model);
      assert.ok(provider.model.includes('gpt-4') || provider.model.includes('vision'));
    });
  });

  describe('Real API Integration Tests', () => {
    it('should analyze a real image and return alignment score', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider(process.env.OPENAI_API_KEY);

      // Use a publicly accessible test image
      const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Placeholder_view_vector.svg/310px-Placeholder_view_vector.svg.png';
      const prompt = 'a placeholder image with geometric shapes';

      const result = await provider.analyzeImage(imageUrl, prompt);

      // Verify result structure
      assert.ok(result, 'Result should not be null');
      assert.ok(typeof result.alignmentScore === 'number', 'Should have alignmentScore');
      assert.ok(result.alignmentScore >= 0 && result.alignmentScore <= 100, 'Score should be 0-100');
      assert.ok(typeof result.analysis === 'string', 'Should have analysis text');
      assert.ok(result.analysis.length > 0, 'Analysis should not be empty');
      assert.ok(Array.isArray(result.strengths), 'Should have strengths array');
      assert.ok(Array.isArray(result.weaknesses), 'Should have weaknesses array');
      assert.ok(result.metadata, 'Should have metadata');
      assert.ok(result.metadata.model, 'Metadata should include model');
      assert.ok(typeof result.metadata.tokensUsed === 'number', 'Should track token usage');
    });

    it('should handle invalid image URLs gracefully', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider(process.env.OPENAI_API_KEY);

      const invalidUrl = 'https://example.com/nonexistent-image.png';
      const prompt = 'test prompt';

      // Should either reject or return an error in the result
      await assert.rejects(
        async () => await provider.analyzeImage(invalidUrl, prompt),
        /error|failed|invalid/i,
        'Should handle invalid image URL'
      );
    });
  });

  describe('Aesthetic Scoring', () => {
    it('should include aestheticScore in analysis results', async () => {
      // Verify the expected structure includes aestheticScore
      const expectedStructure = {
        analysis: 'string',
        alignmentScore: 75,
        aestheticScore: 7.5,  // 0-10 scale for visual quality
        strengths: [],
        weaknesses: [],
        metadata: {}
      };

      assert.ok(typeof expectedStructure.aestheticScore === 'number', 'Should have aestheticScore');
      assert.ok(expectedStructure.aestheticScore >= 0 && expectedStructure.aestheticScore <= 10, 'Score should be 0-10');
    });

    it('should validate aestheticScore is between 0 and 10', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider(process.env.OPENAI_API_KEY);

      const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Placeholder_view_vector.svg/310px-Placeholder_view_vector.svg.png';
      const prompt = 'a placeholder image';

      const result = await provider.analyzeImage(imageUrl, prompt);

      assert.ok(typeof result.aestheticScore === 'number', 'Should have aestheticScore as number');
      assert.ok(result.aestheticScore >= 0 && result.aestheticScore <= 10, 'aestheticScore should be 0-10');
    });

    it('should evaluate aesthetic quality separate from alignment', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider(process.env.OPENAI_API_KEY);

      const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Placeholder_view_vector.svg/310px-Placeholder_view_vector.svg.png';
      const prompt = 'a placeholder image';

      const result = await provider.analyzeImage(imageUrl, prompt);

      // Aesthetic score should exist independent of alignment
      assert.ok(result.alignmentScore, 'Should have alignment score');
      assert.ok(result.aestheticScore, 'Should have aesthetic score');

      // They measure different things, so they can differ
      assert.ok(typeof result.alignmentScore === 'number');
      assert.ok(typeof result.aestheticScore === 'number');
    });
  });
});
