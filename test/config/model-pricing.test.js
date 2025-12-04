/**
 * Tests for centralized model pricing configuration
 *
 * Verifies that pricing data is accessible and utility functions work correctly.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const {
  MODEL_PRICING,
  MODEL_RECOMMENDATIONS,
  getPricing,
  getRecommendedModel,
  calculateCost,
  compareCosts
} = require('../../src/config/model-pricing.js');

describe('Model Pricing Configuration', () => {
  test('should export MODEL_PRICING with current OpenAI rates', () => {
    assert.ok(MODEL_PRICING, 'MODEL_PRICING should be defined');
    assert.ok(typeof MODEL_PRICING === 'object', 'MODEL_PRICING should be an object');

    // Verify GPT-5 models exist
    assert.ok(MODEL_PRICING['gpt-5.1'], 'Should have gpt-5.1 pricing');
    assert.ok(MODEL_PRICING['gpt-5'], 'Should have gpt-5 pricing');
    assert.ok(MODEL_PRICING['gpt-5-mini'], 'Should have gpt-5-mini pricing');
    assert.ok(MODEL_PRICING['gpt-5-nano'], 'Should have gpt-5-nano pricing');

    // Verify GPT-4o models exist
    assert.ok(MODEL_PRICING['gpt-4o'], 'Should have gpt-4o pricing');
    assert.ok(MODEL_PRICING['gpt-4o-mini'], 'Should have gpt-4o-mini pricing');

    // Verify legacy models exist
    assert.ok(MODEL_PRICING['gpt-4'], 'Should have gpt-4 pricing');
    assert.ok(MODEL_PRICING['gpt-3.5-turbo'], 'Should have gpt-3.5-turbo pricing');
  });

  test('should have correct pricing values (December 2025 rates)', () => {
    // GPT-5 models (with input/output pricing)
    assert.strictEqual(MODEL_PRICING['gpt-5.1'].input, 0.00000125, 'gpt-5.1 input = $1.25/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-5.1'].output, 0.000005, 'gpt-5.1 output = $5.00/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-5-mini'].input, 0.00000025, 'gpt-5-mini input = $0.25/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-5-mini'].output, 0.000001, 'gpt-5-mini output = $1.00/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-5-nano'].input, 0.00000005, 'gpt-5-nano input = $0.05/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-5-nano'].output, 0.0000002, 'gpt-5-nano output = $0.20/1M tokens');

    // GPT-4o models (with input/output pricing)
    assert.strictEqual(MODEL_PRICING['gpt-4o'].input, 0.0000025, 'gpt-4o input = $2.50/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-4o'].output, 0.00001, 'gpt-4o output = $10.00/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-4o-mini'].input, 0.00000015, 'gpt-4o-mini input = $0.15/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-4o-mini'].output, 0.0000006, 'gpt-4o-mini output = $0.60/1M tokens');

    // Legacy models (with input/output pricing)
    assert.strictEqual(MODEL_PRICING['gpt-4'].input, 0.00003, 'gpt-4 input = $30.00/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-4'].output, 0.00012, 'gpt-4 output = $120.00/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-3.5-turbo'].input, 0.0000005, 'gpt-3.5-turbo input = $0.50/1M tokens');
    assert.strictEqual(MODEL_PRICING['gpt-3.5-turbo'].output, 0.000002, 'gpt-3.5-turbo output = $2.00/1M tokens');
  });

  test('getPricing() should return correct pricing for valid models', () => {
    const price = getPricing('gpt-5-nano');
    assert.ok(typeof price === 'object', 'Should return pricing object');
    assert.strictEqual(price.input, 0.00000005);
    assert.strictEqual(price.output, 0.0000002);

    const price2 = getPricing('gpt-4o');
    assert.ok(typeof price2 === 'object', 'Should return pricing object');
    assert.strictEqual(price2.input, 0.0000025);
    assert.strictEqual(price2.output, 0.00001);
  });

  test('getPricing() should return null for unknown models', () => {
    const price = getPricing('gpt-unknown-model');
    assert.strictEqual(price, null);
  });

  test('calculateCost() should correctly compute cost', () => {
    // 1,000,000 input tokens with gpt-5-nano ($0.05/1M input) = $0.05
    const cost = calculateCost('gpt-5-nano', 1000000);
    // Use tolerance for floating point comparison
    assert.ok(Math.abs(cost - 0.05) < 0.000001, `Expected ~$0.05, got $${cost}`);

    // 10,000 input tokens with gpt-4 ($30/1M input) = $0.30
    const cost2 = calculateCost('gpt-4', 10000);
    assert.ok(Math.abs(cost2 - 0.30) < 0.000001, `Expected ~$0.30, got $${cost2}`);
  });

  test('calculateCost() should throw for unknown models', () => {
    assert.throws(
      () => calculateCost('unknown-model', 1000),
      /Unknown model/
    );
  });

  test('compareCosts() should calculate savings correctly', () => {
    const comparison = compareCosts('gpt-4', 'gpt-5-nano', 10000);

    // gpt-4: 10000 * 0.00003 (input price) = $0.30
    // gpt-5-nano: 10000 * 0.00000005 (input price) = $0.0005
    // Savings: $0.2995 (~99.8%)

    assert.ok(comparison.currentCost > 0.29);
    assert.ok(comparison.currentCost < 0.31);
    assert.ok(comparison.suggestedCost > 0);
    assert.ok(comparison.suggestedCost < 0.001);
    assert.ok(comparison.savings > 0.29);
    assert.ok(comparison.savingsPercentage > 99);
    assert.strictEqual(comparison.worthSwitching, true);
  });

  test('compareCosts() should identify when not worth switching', () => {
    // Compare gpt-5-nano to itself (no savings)
    const comparison = compareCosts('gpt-5-nano', 'gpt-5-nano', 10000);

    assert.strictEqual(comparison.savings, 0);
    assert.strictEqual(comparison.savingsPercentage, 0);
    assert.strictEqual(comparison.worthSwitching, false);
  });

  test('getRecommendedModel() should suggest correct models for use cases', () => {
    // Simple operations should use nano
    const expandRec = getRecommendedModel('expand');
    assert.strictEqual(expandRec.model, 'gpt-5-nano');
    assert.strictEqual(expandRec.tier, 'simple');

    // Moderate operations should use mini
    const refineRec = getRecommendedModel('refine');
    assert.strictEqual(refineRec.model, 'gpt-5-mini');
    assert.strictEqual(refineRec.tier, 'moderate');

    // Vision operations should use gpt-4o-mini
    const visionRec = getRecommendedModel('image_analysis');
    assert.strictEqual(visionRec.model, 'gpt-4o-mini');
    assert.strictEqual(visionRec.tier, 'vision');
  });

  test('getRecommendedModel() should return moderate tier for unknown use cases', () => {
    const rec = getRecommendedModel('unknown_operation');
    assert.strictEqual(rec.model, 'gpt-5-mini');
    assert.strictEqual(rec.tier, 'moderate');
  });

  test('MODEL_RECOMMENDATIONS should define all tiers', () => {
    assert.ok(MODEL_RECOMMENDATIONS.simple, 'Should have simple tier');
    assert.ok(MODEL_RECOMMENDATIONS.moderate, 'Should have moderate tier');
    assert.ok(MODEL_RECOMMENDATIONS.complex, 'Should have complex tier');
    assert.ok(MODEL_RECOMMENDATIONS.vision, 'Should have vision tier');
    assert.ok(MODEL_RECOMMENDATIONS.vision_premium, 'Should have vision_premium tier');

    // Each tier should have required fields
    for (const [tier, config] of Object.entries(MODEL_RECOMMENDATIONS)) {
      assert.ok(config.model, `${tier} should have model`);
      assert.ok(Array.isArray(config.use_cases), `${tier} should have use_cases array`);
      assert.ok(typeof config.cost_per_1m === 'number', `${tier} should have cost_per_1m`);
    }
  });

  test('pricing should reflect cost hierarchy (cheaper models have lower costs)', () => {
    // GPT-5 hierarchy (comparing input prices)
    assert.ok(MODEL_PRICING['gpt-5-nano'].input < MODEL_PRICING['gpt-5-mini'].input);
    assert.ok(MODEL_PRICING['gpt-5-mini'].input < MODEL_PRICING['gpt-5.1'].input);

    // GPT-4o hierarchy (comparing input prices)
    assert.ok(MODEL_PRICING['gpt-4o-mini'].input < MODEL_PRICING['gpt-4o'].input);

    // Legacy to modern comparison (comparing input prices)
    assert.ok(MODEL_PRICING['gpt-5-nano'].input < MODEL_PRICING['gpt-3.5-turbo'].input);
    assert.ok(MODEL_PRICING['gpt-5-mini'].input < MODEL_PRICING['gpt-4-turbo'].input);
  });

  // 🔴 TDD RED: Test for separate input/output token pricing
  test('🔴 should have separate input and output token pricing for each model', () => {
    // Verify that pricing has input/output structure
    const gpt5nano = MODEL_PRICING['gpt-5-nano'];
    assert.ok(typeof gpt5nano === 'object', 'Pricing should be an object with input/output');
    assert.ok(typeof gpt5nano.input === 'number', 'Should have input token price');
    assert.ok(typeof gpt5nano.output === 'number', 'Should have output token price');

    // Verify output is more expensive than input (typical 4x multiplier for GPT-5)
    assert.ok(gpt5nano.output > gpt5nano.input, 'Output tokens should be more expensive than input');

    // Check correct pricing from official docs (Standard tier)
    assert.strictEqual(gpt5nano.input, 0.00000005, 'gpt-5-nano input = $0.05/1M');
    assert.strictEqual(gpt5nano.output, 0.0000002, 'gpt-5-nano output = $0.20/1M');
  });

  test('🔴 calculateCost() should handle separate input and output tokens', () => {
    // Test with 1000 input tokens and 500 output tokens on gpt-5-nano
    // Expected: (1000 * $0.00000005) + (500 * $0.0000002) = $0.00005 + $0.0001 = $0.00015
    const cost = calculateCost('gpt-5-nano', { input: 1000, output: 500 });
    assert.ok(Math.abs(cost - 0.00015) < 0.0000001, `Expected ~$0.00015, got $${cost}`);
  });

  test('🔴 calculateCost() should accept legacy single token count for backward compatibility', () => {
    // When given a single number, treat it as input tokens only
    const cost = calculateCost('gpt-5-nano', 1000);
    const expectedCost = 1000 * 0.00000005; // Input tokens only
    assert.ok(Math.abs(cost - expectedCost) < 0.0000001);
  });
});
