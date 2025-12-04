/**
 * 🔴 TDD RED Phase: Provider Config Integration Tests
 *
 * Tests that providers read model defaults from provider-config.js
 * instead of hard-coding defaults like 'gpt-4' and 'dall-e-3'.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const providerConfig = require('../../src/config/provider-config.js');

describe('Provider Config Integration', () => {
  describe('🔴 Config provides cost-efficient defaults', () => {
    test('should provide gpt-5-mini or gpt-5-nano for LLM operations', () => {
      // Config should default to modern, cost-efficient models
      const llmModel = providerConfig.llm.model;

      // Should be a modern model, not legacy gpt-4
      assert.ok(llmModel.includes('gpt-5') || llmModel.includes('gpt-4o-mini'));
      assert.ok(!llmModel.includes('gpt-4') || llmModel.includes('gpt-4o'));
    });

    test('should provide operation-specific LLM models', () => {
      const models = providerConfig.llm.models;

      // Should have operation-specific models
      assert.ok(models.expand);
      assert.ok(models.refine);
      assert.ok(models.combine);

      // Expand and combine should use cheaper model (simple operations)
      assert.ok(models.expand.includes('nano') || models.expand.includes('mini'));
      assert.ok(models.combine.includes('nano') || models.combine.includes('mini'));
    });

    test('should provide gpt-4o-mini for vision by default', () => {
      const visionModel = providerConfig.vision.model;

      // Should default to cost-efficient vision model
      assert.strictEqual(visionModel, 'gpt-4o-mini');
    });

    test('should provide cost-efficient image model', () => {
      const imageModel = providerConfig.image.model;

      // Should not be dall-e-3 (legacy)
      assert.notStrictEqual(imageModel, 'dall-e-3');
    });
  });

  describe('🔴 OpenAI LLM Provider uses config', () => {
    test('should default to config model when no options provided', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      // Should use config default, not hard-coded gpt-4
      assert.notStrictEqual(provider.model, 'gpt-4');

      // Should use config value
      const expectedModel = providerConfig.llm.model;
      assert.strictEqual(provider.model, expectedModel);
    });

    test('should use operation-specific models from config', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key');

      // Should have operation-specific models from config
      assert.strictEqual(provider.models.expand, providerConfig.llm.models.expand);
      assert.strictEqual(provider.models.refine, providerConfig.llm.models.refine);
      assert.strictEqual(provider.models.combine, providerConfig.llm.models.combine);
    });

    test('should allow options to override config defaults', () => {
      const OpenAILLMProvider = require('../../src/providers/openai-llm-provider.js');
      const provider = new OpenAILLMProvider('fake-api-key', { model: 'gpt-4-turbo' });

      // Options should override config
      assert.strictEqual(provider.model, 'gpt-4-turbo');
    });
  });

  describe('🔴 OpenAI Vision Provider uses config', () => {
    test('should default to config model when no options provided', () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider('fake-api-key');

      // Should use config default (gpt-4o-mini), not hard-coded gpt-4o
      assert.notStrictEqual(provider.model, 'gpt-4o');

      // Should use config value
      const expectedModel = providerConfig.vision.model;
      assert.strictEqual(provider.model, expectedModel);
    });

    test('should allow options to override config defaults', () => {
      const OpenAIVisionProvider = require('../../src/providers/openai-vision-provider.js');
      const provider = new OpenAIVisionProvider('fake-api-key', { model: 'gpt-4o' });

      // Options should override config
      assert.strictEqual(provider.model, 'gpt-4o');
    });
  });

  describe('🔴 OpenAI Image Provider uses config', () => {
    test('should default to config model when no options provided', () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key');

      // Should use config default, not hard-coded dall-e-3
      assert.notStrictEqual(provider.model, 'dall-e-3');

      // Should use config value
      const expectedModel = providerConfig.image.model;
      assert.strictEqual(provider.model, expectedModel);
    });

    test('should allow options to override config defaults', () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', { model: 'dall-e-3' });

      // Options should override config
      assert.strictEqual(provider.model, 'dall-e-3');
    });
  });

  describe('🔴 Critique Generator uses config', () => {
    test('should default to config model when no options provided', () => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      const generator = new CritiqueGenerator({ apiKey: 'fake-api-key' });

      // Should use a cost-efficient model from config, not hard-coded gpt-4o-mini
      // CritiqueGenerator should use the LLM refine model (it's a moderate complexity task)
      assert.ok(generator.model);

      // Should be a modern, cost-efficient model
      assert.ok(generator.model.includes('mini') || generator.model.includes('nano'));
    });
  });
});
