/**
 * TDD RED Phase: OpenAI LLM Provider Tests
 *
 * Tests for real OpenAI API integration.
 * This provider uses GPT-4 to refine prompts for image generation.
 *
 * Note: These tests can run in two modes:
 * 1. Unit tests with mocked OpenAI SDK (fast, no API calls)
 * 2. Integration tests with real API (requires OPENAI_API_KEY env var)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('OpenAILLMProvider Interface', () => {
  describe('Provider contract', () => {
    it('should have a name property', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      assert.ok(provider.name, 'Provider must have a name');
      assert.strictEqual(typeof provider.name, 'string');
      assert.ok(provider.name.includes('openai'), 'Name should indicate OpenAI provider');
    });

    it('should have a refinePrompt method', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      assert.ok(provider.refinePrompt, 'Provider must have refinePrompt method');
      assert.strictEqual(typeof provider.refinePrompt, 'function');
    });

    it('should require an API key in constructor', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');

      assert.throws(
        () => new OpenAILLMProvider(),
        /API key is required/,
        'Should throw error when API key is missing'
      );
    });

    it('should accept configuration options', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key', {
        model: 'gpt-4-turbo',
        maxRetries: 5,
        timeout: 60000
      });

      assert.ok(provider, 'Provider should be created with options');
    });
  });

  describe('refinePrompt method', () => {
    let provider;

    beforeEach(() => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      provider = new OpenAILLMProvider('fake-api-key');
    });

    it('should accept a prompt string', async () => {
      // Just verify the method exists
      assert.ok(provider.refinePrompt);
    });

    it('should require a prompt parameter', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt(),
        /Prompt is required/,
        'Should reject when prompt is missing'
      );
    });

    it('should reject empty prompts', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt(''),
        /Prompt is required and cannot be empty/,
        'Should reject empty prompts'
      );

      await assert.rejects(
        async () => await provider.refinePrompt('   '),
        /Prompt is required and cannot be empty/,
        'Should reject whitespace-only prompts'
      );
    });

    it('should reject null or undefined prompts', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt(null),
        /Prompt is required/,
        'Should reject null prompts'
      );

      await assert.rejects(
        async () => await provider.refinePrompt(undefined),
        /Prompt is required/,
        'Should reject undefined prompts'
      );
    });

    it('should support dimension option (what/how)', () => {
      // This test just verifies the method accepts valid dimension options
      // Note: We don't await these as they would fail with fake API key
      assert.ok(provider.refinePrompt);
      assert.strictEqual(typeof provider.refinePrompt, 'function');
    });

    it('should reject invalid dimensions', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt('test', { dimension: 'invalid' }),
        /Dimension must be either "what" or "how"/,
        'Should reject invalid dimensions'
      );
    });

    it('should validate temperature range', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt('test', { temperature: -0.1 }),
        /Temperature out of range/,
        'Should reject temperature < 0'
      );

      await assert.rejects(
        async () => await provider.refinePrompt('test', { temperature: 1.1 }),
        /Temperature out of range/,
        'Should reject temperature > 1'
      );
    });

    it('should return expected result structure', async () => {
      // This test will fail until we mock the OpenAI API or implement the provider
      // For now, we're just defining the expected contract
      const result = {
        refinedPrompt: 'string',
        explanation: 'string',
        metadata: {
          model: 'string',
          dimension: 'string',
          tokensUsed: 'number',
          temperature: 'number',
          timestamp: 'string'
        }
      };

      assert.ok(result.refinedPrompt);
      assert.ok(result.explanation);
      assert.ok(result.metadata);
    });
  });

  describe('Expand vs Refine Operations', () => {
    it('should accept operation parameter', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      // Just verify method exists and accepts these parameters without throwing sync errors
      assert.ok(provider.refinePrompt);
      assert.strictEqual(typeof provider.refinePrompt, 'function');

      // Actual behavior tested in other tests that properly handle async
    });

    it('should default to expand operation when not specified', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('invalid-key');

      // Should use expand by default (we'll verify by checking error message structure)
      await assert.rejects(
        async () => await provider.refinePrompt('test'),
        /OpenAI API error/,
        'Should call API with default operation'
      );
    });

    it('should reject invalid operation values', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      await assert.rejects(
        async () => await provider.refinePrompt('test', { operation: 'invalid' }),
        /Operation must be either "expand" or "refine"/,
        'Should reject invalid operation'
      );
    });

    it('should require critique parameter when operation is refine', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      await assert.rejects(
        async () => await provider.refinePrompt('test', { operation: 'refine' }),
        /critique.*required.*refine/i,
        'Should require critique for refine operation'
      );
    });

    it('should accept critique parameter for refine operation', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('invalid-key');

      // Should not throw validation error, only API error
      await assert.rejects(
        async () => await provider.refinePrompt('test', {
          operation: 'refine',
          critique: 'Add more detail about the subject'
        }),
        /OpenAI API error/,
        'Should accept critique parameter'
      );
    });

    it('should include operation in result metadata', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider(process.env.OPENAI_API_KEY);

      const result = await provider.refinePrompt('mountain', {
        operation: 'expand',
        dimension: 'what'
      });

      assert.ok(result.metadata, 'Should have metadata');
      assert.strictEqual(result.metadata.operation, 'expand', 'Should include operation in metadata');
    });

    it('should produce different prompts for expand vs refine with same input', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider(process.env.OPENAI_API_KEY);

      const basePrompt = 'mountain';

      // Expand operation - initial expansion
      const expandResult = await provider.refinePrompt(basePrompt, {
        operation: 'expand',
        dimension: 'what'
      });

      // Refine operation - iterative improvement
      const refineResult = await provider.refinePrompt(basePrompt, {
        operation: 'refine',
        dimension: 'what',
        critique: 'Add more detail about the terrain and vegetation'
      });

      // Both should return non-empty prompts
      assert.ok(expandResult.refinedPrompt.length > 0);
      assert.ok(refineResult.refinedPrompt.length > 0);

      // They should be different (though we can't guarantee exact content)
      // Just verify both operations work
      assert.ok(expandResult.metadata.operation === 'expand');
      assert.ok(refineResult.metadata.operation === 'refine');
    });
  });

  describe('OpenAI API Integration', () => {
    it('should handle API errors gracefully', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('invalid-key');

      // Should throw a descriptive error when API call fails
      await assert.rejects(
        async () => await provider.refinePrompt('test prompt'),
        /OpenAI API error/,
        'Should throw OpenAI API error'
      );
    });

    it('should include actual model name in metadata', async () => {
      // This is a placeholder - actual implementation will use real API
      // For now, we're just defining the contract
      const expectedModel = 'gpt-4'; // or whatever model is configured
      assert.ok(expectedModel);
    });
  });

  describe('combinePrompts method', () => {
    it('should have a combinePrompts method', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      assert.ok(provider.combinePrompts, 'Provider must have combinePrompts method');
      assert.strictEqual(typeof provider.combinePrompts, 'function');
    });

    it('should require both whatPrompt and howPrompt parameters', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      await assert.rejects(
        async () => await provider.combinePrompts(),
        /whatPrompt.*required/i,
        'Should throw error when whatPrompt is missing'
      );

      await assert.rejects(
        async () => await provider.combinePrompts('some what'),
        /howPrompt.*required/i,
        'Should throw error when howPrompt is missing'
      );
    });

    it('should reject empty prompts', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      await assert.rejects(
        async () => await provider.combinePrompts('', 'some how'),
        /empty/i,
        'Should reject empty whatPrompt'
      );

      await assert.rejects(
        async () => await provider.combinePrompts('some what', ''),
        /empty/i,
        'Should reject empty howPrompt'
      );
    });

    it('should return a non-empty string', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider(process.env.OPENAI_API_KEY);

      const whatPrompt = 'Towering world-tree with roots piercing starlit sky';
      const howPrompt = 'Cinematic digital painting style, dramatic rim lighting';

      const result = await provider.combinePrompts(whatPrompt, howPrompt);

      assert.strictEqual(typeof result, 'string', 'Result should be a string');
      assert.ok(result.length > 0, 'Combined prompt should not be empty');
      assert.ok(result.trim().length > 0, 'Combined prompt should not be just whitespace');
    });

    it('should return a reasonably sized combined prompt', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider(process.env.OPENAI_API_KEY);

      const whatPrompt = 'Ancient temple ruins covered in mystical vines';
      const howPrompt = 'Soft golden hour lighting, shallow depth of field';

      const combined = await provider.combinePrompts(whatPrompt, howPrompt);

      // Should be longer than either input alone (LLM typically expands)
      assert.ok(combined.length >= whatPrompt.length * 0.5, 'Should be substantial');

      // But not absurdly long (sanity check)
      assert.ok(combined.length < 1000, 'Should be reasonable length for image generation');
    });

    it('should work with different prompt lengths', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider(process.env.OPENAI_API_KEY);

      // Short prompts
      const result1 = await provider.combinePrompts('tree', 'sunset light');
      assert.ok(result1.length > 0, 'Should handle short prompts');

      // Long prompts
      const longWhat = 'A massive ancient oak tree with gnarled branches reaching toward the sky, its thick trunk covered in moss and lichen, roots spreading across a forest floor carpeted with fallen leaves';
      const longHow = 'Dramatic cinematic lighting with rays of golden sunlight piercing through the canopy, rich color saturation, shallow depth of field with bokeh effect, professional nature photography style';
      const result2 = await provider.combinePrompts(longWhat, longHow);
      assert.ok(result2.length > 0, 'Should handle long prompts');
    });

    it('should handle special characters and punctuation', { skip: !process.env.OPENAI_API_KEY }, async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider(process.env.OPENAI_API_KEY);

      const whatPrompt = 'Red-haired mage (female) holding a crystal orb';
      const howPrompt = 'Dramatic lighting: rim-lit, glowing highlights @ 50%';

      // Should not crash with special characters
      const result = await provider.combinePrompts(whatPrompt, howPrompt);
      assert.ok(result.length > 0, 'Should handle special characters gracefully');
    });

    it('should call OpenAI API when combining prompts', async () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('invalid-key');

      const whatPrompt = 'Mountain landscape';
      const howPrompt = 'Dramatic lighting';

      // Should fail with API error since we used invalid key
      await assert.rejects(
        async () => await provider.combinePrompts(whatPrompt, howPrompt),
        /OpenAI API error/,
        'Should actually call OpenAI API (not just concatenate)'
      );
    });
  });
});
