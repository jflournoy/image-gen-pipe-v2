/**
 * 🔴 TDD RED Phase: Token Efficiency Tracker Tests
 *
 * Tracks token usage across all providers to enable cost optimization.
 * Monitors: LLM, Vision, and Critique token consumption per operation.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');

describe('TokenTracker', () => {
  describe('🔴 Class Structure', () => {
    test('should create TokenTracker instance', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      assert.ok(tracker);
      assert.strictEqual(typeof tracker.recordUsage, 'function');
      assert.strictEqual(typeof tracker.getStats, 'function');
    });

    test('should initialize with zero usage', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();
      const stats = tracker.getStats();

      assert.strictEqual(stats.totalTokens, 0);
      assert.strictEqual(stats.llmTokens, 0);
      assert.strictEqual(stats.visionTokens, 0);
      assert.strictEqual(stats.critiqueTokens, 0);
    });

    test('should support session ID for tracking', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({ sessionId: 'ses-123456' });

      assert.strictEqual(tracker.sessionId, 'ses-123456');
    });
  });

  describe('🔴 Recording Token Usage', () => {
    test('should record LLM token usage', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 150,
        metadata: {
          dimension: 'what',
          iteration: 0
        }
      });

      const stats = tracker.getStats();
      assert.strictEqual(stats.llmTokens, 150);
      assert.strictEqual(stats.totalTokens, 150);
    });

    test('should record Vision token usage', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 500,
        metadata: {
          iteration: 0,
          candidateId: 0
        }
      });

      const stats = tracker.getStats();
      assert.strictEqual(stats.visionTokens, 500);
      assert.strictEqual(stats.totalTokens, 500);
    });

    test('should record Critique token usage', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({
        provider: 'critique',
        operation: 'generate',
        tokens: 300,
        metadata: {
          dimension: 'what',
          iteration: 1
        }
      });

      const stats = tracker.getStats();
      assert.strictEqual(stats.critiqueTokens, 300);
      assert.strictEqual(stats.totalTokens, 300);
    });

    test('should accumulate token usage across multiple calls', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({ provider: 'llm', operation: 'expand', tokens: 100 });
      tracker.recordUsage({ provider: 'llm', operation: 'refine', tokens: 150 });
      tracker.recordUsage({ provider: 'vision', operation: 'analyze', tokens: 500 });

      const stats = tracker.getStats();
      assert.strictEqual(stats.llmTokens, 250);
      assert.strictEqual(stats.visionTokens, 500);
      assert.strictEqual(stats.totalTokens, 750);
    });

    test('should track timestamp for each usage record', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();
      const before = Date.now();

      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 100
      });

      const after = Date.now();
      const records = tracker.getRecords();

      assert.strictEqual(records.length, 1);
      assert.ok(records[0].timestamp >= before);
      assert.ok(records[0].timestamp <= after);
    });
  });

  describe('🔴 Token Usage by Operation', () => {
    test('should track tokens by operation type', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({ provider: 'llm', operation: 'expand', tokens: 100 });
      tracker.recordUsage({ provider: 'llm', operation: 'expand', tokens: 120 });
      tracker.recordUsage({ provider: 'llm', operation: 'refine', tokens: 150 });

      const stats = tracker.getStats();

      assert.strictEqual(stats.byOperation.expand, 220);
      assert.strictEqual(stats.byOperation.refine, 150);
    });

    test('should track tokens by iteration', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 100,
        metadata: { iteration: 0 }
      });

      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 500,
        metadata: { iteration: 0 }
      });

      tracker.recordUsage({
        provider: 'llm',
        operation: 'refine',
        tokens: 150,
        metadata: { iteration: 1 }
      });

      const stats = tracker.getStats();

      assert.strictEqual(stats.byIteration[0], 600);
      assert.strictEqual(stats.byIteration[1], 150);
    });
  });

  describe('🔴 Efficiency Metrics', () => {
    test('should calculate average tokens per candidate', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      // Simulate 4 candidates with varying token usage
      tracker.recordUsage({ provider: 'llm', tokens: 100, metadata: { candidateId: 0 } });
      tracker.recordUsage({ provider: 'vision', tokens: 500, metadata: { candidateId: 0 } });

      tracker.recordUsage({ provider: 'llm', tokens: 120, metadata: { candidateId: 1 } });
      tracker.recordUsage({ provider: 'vision', tokens: 480, metadata: { candidateId: 1 } });

      tracker.recordUsage({ provider: 'llm', tokens: 110, metadata: { candidateId: 2 } });
      tracker.recordUsage({ provider: 'vision', tokens: 520, metadata: { candidateId: 2 } });

      tracker.recordUsage({ provider: 'llm', tokens: 130, metadata: { candidateId: 3 } });
      tracker.recordUsage({ provider: 'vision', tokens: 490, metadata: { candidateId: 3 } });

      const metrics = tracker.getEfficiencyMetrics();

      // Total: 2450 tokens, 4 candidates = 612.5 avg
      assert.strictEqual(metrics.avgTokensPerCandidate, 612.5);
    });

    test('should calculate tokens per provider percentage', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({ provider: 'llm', tokens: 300 });
      tracker.recordUsage({ provider: 'vision', tokens: 500 });
      tracker.recordUsage({ provider: 'critique', tokens: 200 });

      const metrics = tracker.getEfficiencyMetrics();

      // Total: 1000 tokens
      assert.strictEqual(metrics.providerPercentages.llm, 30);
      assert.strictEqual(metrics.providerPercentages.vision, 50);
      assert.strictEqual(metrics.providerPercentages.critique, 20);
    });

    test('should identify most expensive operation', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({ provider: 'llm', operation: 'expand', tokens: 100 });
      tracker.recordUsage({ provider: 'llm', operation: 'expand', tokens: 120 });
      tracker.recordUsage({ provider: 'llm', operation: 'refine', tokens: 150 });
      tracker.recordUsage({ provider: 'vision', operation: 'analyze', tokens: 1500 });

      const metrics = tracker.getEfficiencyMetrics();

      assert.strictEqual(metrics.mostExpensiveOperation, 'analyze');
      assert.strictEqual(metrics.mostExpensiveOperationTokens, 1500);
    });
  });

  describe('🔴 Cost Estimation', () => {
    test('should estimate cost based on token usage', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      // Typical OpenAI pricing (as of 2024)
      const pricing = {
        llm: 0.00001, // $0.01 per 1K tokens (GPT-4)
        vision: 0.00001, // $0.01 per 1K tokens (GPT-4V)
        critique: 0.00001 // $0.01 per 1K tokens (GPT-4)
      };

      const tracker = new TokenTracker({ pricing });

      tracker.recordUsage({ provider: 'llm', tokens: 1000 });
      tracker.recordUsage({ provider: 'vision', tokens: 5000 });
      tracker.recordUsage({ provider: 'critique', tokens: 2000 });

      const cost = tracker.getEstimatedCost();

      // 1000 * 0.00001 + 5000 * 0.00001 + 2000 * 0.00001 = 0.08
      assert.strictEqual(cost.total, 0.08);
      assert.strictEqual(cost.llm, 0.01);
      assert.strictEqual(cost.vision, 0.05);
      assert.strictEqual(cost.critique, 0.02);
    });
  });

  describe('🔴 Summary Reports', () => {
    test('should generate summary report', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({ sessionId: 'ses-123456' });

      tracker.recordUsage({ provider: 'llm', operation: 'expand', tokens: 200 });
      tracker.recordUsage({ provider: 'vision', operation: 'analyze', tokens: 500 });

      const summary = tracker.getSummary();

      assert.strictEqual(summary.sessionId, 'ses-123456');
      assert.strictEqual(summary.totalTokens, 700);
      assert.strictEqual(summary.totalRecords, 2);
      assert.ok(summary.startTime);
      assert.ok(summary.endTime);
    });

    test('should format summary as readable string', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker();

      tracker.recordUsage({ provider: 'llm', tokens: 300 });
      tracker.recordUsage({ provider: 'vision', tokens: 500 });

      const formatted = tracker.formatSummary();

      assert.ok(typeof formatted === 'string');
      assert.ok(formatted.includes('Total Tokens: 800'));
      assert.ok(formatted.includes('LLM: 300'));
      assert.ok(formatted.includes('Vision: 500'));
    });
  });

  describe('🔴 Integration with Metadata', () => {
    test('should support exporting to JSON', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({ sessionId: 'ses-123456' });

      tracker.recordUsage({ provider: 'llm', tokens: 200 });

      const json = tracker.toJSON();

      assert.ok(typeof json === 'object');
      assert.strictEqual(json.sessionId, 'ses-123456');
      assert.strictEqual(json.totalTokens, 200);
      assert.ok(Array.isArray(json.records));
    });

    test('should support loading from JSON', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const data = {
        sessionId: 'ses-123456',
        records: [
          { provider: 'llm', operation: 'expand', tokens: 200, timestamp: Date.now() },
          { provider: 'vision', operation: 'analyze', tokens: 500, timestamp: Date.now() }
        ]
      };

      const tracker = TokenTracker.fromJSON(data);

      assert.strictEqual(tracker.sessionId, 'ses-123456');
      const stats = tracker.getStats();
      assert.strictEqual(stats.totalTokens, 700);
    });
  });

  describe('🔴 Model Optimization Suggestions', () => {
    test('should suggest cheaper models for appropriate operations', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          // Current models (GPT-5 era with input/output pricing)
          'gpt-5.1': { input: 0.00000125, output: 0.000005 },
          'gpt-5-mini': { input: 0.00000025, output: 0.000001 },
          'gpt-5-nano': { input: 0.00000005, output: 0.0000002 },
          'gpt-4o': { input: 0.0000025, output: 0.00001 },
          'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },
          // Legacy models
          'gpt-4': { input: 0.00003, output: 0.00012 },
          'gpt-3.5-turbo': { input: 0.0000005, output: 0.000002 }
        }
      });

      // Simulate usage with expensive models
      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 1000,
        metadata: { model: 'gpt-4' }
      });

      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 5000,
        metadata: { model: 'gpt-4o' }
      });

      const suggestions = tracker.getOptimizationSuggestions();

      assert.ok(Array.isArray(suggestions));
      assert.ok(suggestions.length > 0);

      // Should suggest cheaper models
      const llmSuggestion = suggestions.find(s => s.operation === 'expand');
      assert.ok(llmSuggestion);
      assert.ok(llmSuggestion.currentModel);
      assert.ok(llmSuggestion.suggestedModel);
      assert.ok(llmSuggestion.potentialSavings > 0);
    });

    test('should calculate potential cost savings per operation', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          'gpt-5-nano': { input: 0.00000005, output: 0.0000002 },
          'gpt-4': { input: 0.00003, output: 0.00012 }
        }
      });

      // 10,000 tokens with gpt-4 = $0.30 (using input price)
      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 10000,
        metadata: { model: 'gpt-4' }
      });

      const suggestions = tracker.getOptimizationSuggestions();
      const expandSuggestion = suggestions.find(s => s.operation === 'expand');

      // Potential savings: 10000 * (0.00003 - 0.00000005) = $0.2995 (~99.8% savings)
      assert.ok(expandSuggestion);
      assert.ok(expandSuggestion.potentialSavings > 0.29);
      assert.ok(expandSuggestion.potentialSavings < 0.31);
    });

    test('should estimate total potential savings', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          'gpt-5-nano': { input: 0.00000005, output: 0.0000002 },
          'gpt-4': { input: 0.00003, output: 0.00012 },
          'gpt-4o': { input: 0.0000025, output: 0.00001 },
          'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 }
        }
      });

      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 5000,
        metadata: { model: 'gpt-4' }
      });

      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 20000,
        metadata: { model: 'gpt-4o' }
      });

      const optimization = tracker.getOptimizationSummary();

      assert.ok(optimization.currentCost > 0);
      assert.ok(optimization.optimizedCost >= 0);
      assert.ok(optimization.totalSavings > 0);
      assert.ok(optimization.savingsPercentage > 0);
      assert.ok(optimization.savingsPercentage <= 100);
    });

    test('should suggest gpt-5-nano for simple LLM operations', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          'gpt-4': { input: 0.00003, output: 0.00012 },
          'gpt-5-nano': { input: 0.00000005, output: 0.0000002 }
        }
      });

      tracker.recordUsage({
        provider: 'llm',
        operation: 'combine',
        tokens: 1000,
        metadata: { model: 'gpt-4' }
      });

      const suggestions = tracker.getOptimizationSuggestions();
      const combineSuggestion = suggestions.find(s => s.operation === 'combine');

      assert.ok(combineSuggestion);
      assert.strictEqual(combineSuggestion.suggestedModel, 'gpt-5-nano');
      assert.ok(combineSuggestion.reason.includes('straightforward') || combineSuggestion.reason.includes('cheaper'));
    });

    test('should suggest gpt-4o-mini for vision analysis', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          'gpt-4o': 0.000005,
          'gpt-4o-mini': 0.00000015
        }
      });

      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 5000,
        metadata: { model: 'gpt-4o' }
      });

      const suggestions = tracker.getOptimizationSuggestions();
      const visionSuggestion = suggestions.find(s => s.operation === 'analyze');

      assert.ok(visionSuggestion);
      assert.strictEqual(visionSuggestion.suggestedModel, 'gpt-4o-mini');
      assert.ok(visionSuggestion.potentialSavings > 0);
    });

    test('should not suggest optimization if already using cheapest model', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          'gpt-4': 0.00003,
          'gpt-5.1-nano': 0.00000005
        }
      });

      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 1000,
        metadata: { model: 'gpt-5.1-nano' }
      });

      const suggestions = tracker.getOptimizationSuggestions();
      const expandSuggestion = suggestions.find(s => s.operation === 'expand');

      // Should not suggest anything or suggest keeping current model
      assert.ok(!expandSuggestion || expandSuggestion.potentialSavings === 0);
    });

    test('should format optimization report', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          'gpt-4': { input: 0.00003, output: 0.00012 },
          'gpt-5-nano': { input: 0.00000005, output: 0.0000002 }
        }
      });

      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 10000,
        metadata: { model: 'gpt-4' }
      });

      const report = tracker.formatOptimizationReport();

      assert.ok(typeof report === 'string');
      assert.ok(report.includes('Optimization'));
      assert.ok(report.includes('Savings'));
      assert.ok(report.includes('gpt-5-nano') || report.includes('suggested'));
    });

    test('should prioritize suggestions by potential savings', () => {
      const TokenTracker = require('../../src/utils/token-tracker.js');

      const tracker = new TokenTracker({
        pricing: {
          'gpt-5-nano': { input: 0.00000005, output: 0.0000002 },
          'gpt-4': { input: 0.00003, output: 0.00012 },
          'gpt-4o': { input: 0.0000025, output: 0.00001 },
          'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 }
        }
      });

      // High token operation
      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 50000,
        metadata: { model: 'gpt-4o' }
      });

      // Lower token operation
      tracker.recordUsage({
        provider: 'llm',
        operation: 'expand',
        tokens: 1000,
        metadata: { model: 'gpt-4' }
      });

      const suggestions = tracker.getOptimizationSuggestions();

      // Should be sorted by potential savings (descending)
      if (suggestions.length > 1) {
        assert.ok(
          suggestions[0].potentialSavings >= suggestions[1].potentialSavings,
          'Suggestions should be ordered by potential savings'
        );
      }
    });
  });
});
