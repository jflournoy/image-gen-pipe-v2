/**
 * TDD RED Phase: LLM Provider Interface Tests
 *
 * LLM providers handle prompt refinement - expanding either:
 * - WHAT dimension (content: subjects, objects, actions)
 * - HOW dimension (style: lighting, composition, atmosphere)
 *
 * Based on SRS Section 5.4 - Provider Interfaces
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('LLMProvider Interface', () => {
  describe('Provider contract', () => {
    it('should have a name property', () => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      const provider = new MockLLMProvider();

      assert.ok(provider.name, 'Provider must have a name');
      assert.strictEqual(typeof provider.name, 'string');
    });

    it('should have a refinePrompt method', () => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      const provider = new MockLLMProvider();

      assert.ok(provider.refinePrompt, 'Provider must have refinePrompt method');
      assert.strictEqual(typeof provider.refinePrompt, 'function');
    });

    it('should return a Promise from refinePrompt', async () => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      const provider = new MockLLMProvider();

      const result = provider.refinePrompt('test prompt');
      assert.ok(result instanceof Promise, 'refinePrompt must return a Promise');
    });
  });

  describe('refinePrompt method', () => {
    let provider;

    beforeEach(() => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      provider = new MockLLMProvider();
    });

    it('should accept a prompt string', async () => {
      const prompt = 'a mountain landscape';

      // Should not throw
      await provider.refinePrompt(prompt);
    });

    it('should accept optional options object', async () => {
      const prompt = 'a mountain landscape';
      const options = {
        dimension: 'what',
        temperature: 0.7,
        maxTokens: 500
      };

      // Should not throw
      await provider.refinePrompt(prompt, options);
    });

    it('should return an object with required fields', async () => {
      const result = await provider.refinePrompt('test prompt');

      assert.ok(result, 'Result must not be null');
      assert.strictEqual(typeof result, 'object');
      assert.ok(result.refinedPrompt, 'Result must have refinedPrompt field');
      assert.strictEqual(typeof result.refinedPrompt, 'string');
      assert.ok(result.refinedPrompt.length > 0, 'Refined prompt must not be empty');
    });

    it('should return metadata about the refinement', async () => {
      const result = await provider.refinePrompt('test prompt');

      assert.ok(result.metadata, 'Result must have metadata');
      assert.strictEqual(typeof result.metadata, 'object');
      assert.ok(result.metadata.model, 'Metadata must include model');
      assert.ok(result.metadata.dimension, 'Metadata must include dimension');
      assert.ok(typeof result.metadata.tokensUsed === 'number', 'Metadata must include tokensUsed as number');
    });

    it('should optionally return explanation', async () => {
      const result = await provider.refinePrompt('test prompt');

      if (result.explanation) {
        assert.strictEqual(typeof result.explanation, 'string');
      }
    });

    it('should throw error for empty prompt', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt(''),
        /prompt.*required|prompt.*empty/i,
        'Should reject empty prompt'
      );
    });

    it('should throw error for null prompt', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt(null),
        /prompt.*required|prompt.*invalid/i,
        'Should reject null prompt'
      );
    });
  });

  describe('WHAT dimension refinement', () => {
    let provider;

    beforeEach(() => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      provider = new MockLLMProvider();
    });

    it('should refine WHAT dimension when specified', async () => {
      const prompt = 'a mountain';
      const result = await provider.refinePrompt(prompt, { dimension: 'what' });

      assert.strictEqual(result.metadata.dimension, 'what');
      assert.ok(
        result.refinedPrompt.length > prompt.length,
        'WHAT refinement should expand content details'
      );
    });

    it('should expand content details in WHAT dimension', async () => {
      const prompt = 'a cat';
      const result = await provider.refinePrompt(prompt, { dimension: 'what' });

      // Mock should add content-focused details
      const refinedLower = result.refinedPrompt.toLowerCase();
      // Should contain content-related additions (subjects, objects, actions)
      assert.ok(
        refinedLower.includes('cat'),
        'Refined prompt should retain original subject'
      );
    });

    it('should use WHAT dimension as default', async () => {
      const result = await provider.refinePrompt('test prompt');

      // Default should be WHAT dimension
      assert.strictEqual(result.metadata.dimension, 'what');
    });
  });

  describe('HOW dimension refinement', () => {
    let provider;

    beforeEach(() => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      provider = new MockLLMProvider();
    });

    it('should refine HOW dimension when specified', async () => {
      const prompt = 'a mountain';
      const result = await provider.refinePrompt(prompt, { dimension: 'how' });

      assert.strictEqual(result.metadata.dimension, 'how');
      assert.ok(
        result.refinedPrompt.length > prompt.length,
        'HOW refinement should expand style details'
      );
    });

    it('should expand style details in HOW dimension', async () => {
      const prompt = 'a sunset';
      const result = await provider.refinePrompt(prompt, { dimension: 'how' });

      // Mock should add style-focused details
      const refinedLower = result.refinedPrompt.toLowerCase();
      // Should retain original content
      assert.ok(
        refinedLower.includes('sunset'),
        'Refined prompt should retain original content'
      );
    });

    it('should focus on different aspects than WHAT dimension', async () => {
      const prompt = 'a tree';
      const whatResult = await provider.refinePrompt(prompt, { dimension: 'what' });
      const howResult = await provider.refinePrompt(prompt, { dimension: 'how' });

      // Results should be different
      assert.notStrictEqual(
        whatResult.refinedPrompt,
        howResult.refinedPrompt,
        'WHAT and HOW refinements should produce different results'
      );
    });
  });

  describe('Temperature control', () => {
    let provider;

    beforeEach(() => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      provider = new MockLLMProvider();
    });

    it('should accept temperature parameter', async () => {
      const result = await provider.refinePrompt('test', { temperature: 0.5 });

      assert.ok(result.refinedPrompt);
    });

    it('should use default temperature when not specified', async () => {
      const result = await provider.refinePrompt('test');

      // Should succeed with default temperature
      assert.ok(result.refinedPrompt);
    });

    it('should validate temperature range', async () => {
      // Temperature should be between 0 and 1
      await assert.rejects(
        async () => await provider.refinePrompt('test', { temperature: 1.5 }),
        /temperature.*range|temperature.*invalid/i,
        'Should reject temperature > 1.0'
      );

      await assert.rejects(
        async () => await provider.refinePrompt('test', { temperature: -0.1 }),
        /temperature.*range|temperature.*invalid/i,
        'Should reject temperature < 0.0'
      );
    });
  });

  describe('Token tracking', () => {
    let provider;

    beforeEach(() => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      provider = new MockLLMProvider();
    });

    it('should track tokens used', async () => {
      const result = await provider.refinePrompt('test prompt');

      assert.ok(typeof result.metadata.tokensUsed === 'number');
      assert.ok(result.metadata.tokensUsed > 0, 'Should report positive token count');
    });

    it('should respect maxTokens limit', async () => {
      const result = await provider.refinePrompt('test', { maxTokens: 100 });

      // Mock provider should respect token limit
      assert.ok(result.metadata.tokensUsed <= 100);
    });
  });

  describe('Error handling', () => {
    let provider;

    beforeEach(() => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      provider = new MockLLMProvider();
    });

    it('should handle API errors gracefully', async () => {
      // Mock provider should have a way to simulate errors
      // For now, just ensure it doesn't crash
      const result = await provider.refinePrompt('test prompt');
      assert.ok(result);
    });

    it('should validate dimension parameter', async () => {
      await assert.rejects(
        async () => await provider.refinePrompt('test', { dimension: 'invalid' }),
        /dimension.*what|how|dimension.*invalid/i,
        'Should reject invalid dimension'
      );
    });
  });

  describe('Deterministic behavior for testing', () => {
    let provider;

    beforeEach(() => {
      const MockLLMProvider = require('../../src/providers/mock-llm-provider.js');
      provider = new MockLLMProvider();
    });

    it('should produce consistent results for same inputs', async () => {
      const prompt = 'a mountain';
      const options = { dimension: 'what', temperature: 0.7 };

      const result1 = await provider.refinePrompt(prompt, options);
      const result2 = await provider.refinePrompt(prompt, options);

      // Mock provider should be deterministic for testing
      assert.strictEqual(
        result1.refinedPrompt,
        result2.refinedPrompt,
        'Mock provider should produce consistent results'
      );
    });
  });
});
