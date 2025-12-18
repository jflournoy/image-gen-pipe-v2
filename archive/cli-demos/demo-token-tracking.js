#!/usr/bin/env node

/**
 * Demo: Token Efficiency Tracking
 *
 * This demonstrates how to track token usage across providers
 * to monitor costs and optimize model usage.
 *
 * Features:
 * - Tracks tokens per provider (LLM, Vision, Critique)
 * - Calculates efficiency metrics
 * - Estimates costs
 * - Generates summary reports
 *
 * Usage:
 *   node demo-token-tracking.js
 */

const TokenTracker = require('./src/utils/token-tracker.js');
const { MODEL_PRICING } = require('./src/config/model-pricing.js');

async function demo() {
  console.log('📊 Token Efficiency Tracking Demo\n');
  console.log('='.repeat(80));
  console.log('Simulating beam search with N=4, M=2, 3 iterations');
  console.log('='.repeat(80));
  console.log();

  // Create token tracker with session ID and centralized pricing
  // Pricing comes from src/config/model-pricing.js (December 2025 rates)
  // Source: https://openai.com/api/pricing/
  const tracker = new TokenTracker({
    sessionId: 'ses-demo',
    pricing: MODEL_PRICING  // Uses centralized pricing configuration
  });

  console.log('🔧 Simulating Iteration 0: Initial Expansion (N=4 candidates)');
  console.log('-'.repeat(80));

  // Simulate 4 candidates in iteration 0
  for (let i = 0; i < 4; i++) {
    // WHAT expansion (using expensive gpt-4)
    tracker.recordUsage({
      provider: 'llm',
      operation: 'expand',
      tokens: 120 + Math.floor(Math.random() * 40),
      metadata: { iteration: 0, candidateId: i, dimension: 'what', model: 'gpt-4' }
    });

    // HOW expansion (using expensive gpt-4)
    tracker.recordUsage({
      provider: 'llm',
      operation: 'expand',
      tokens: 110 + Math.floor(Math.random() * 30),
      metadata: { iteration: 0, candidateId: i, dimension: 'how', model: 'gpt-4' }
    });

    // Combine prompts (using expensive gpt-4)
    tracker.recordUsage({
      provider: 'llm',
      operation: 'combine',
      tokens: 80 + Math.floor(Math.random() * 20),
      metadata: { iteration: 0, candidateId: i, model: 'gpt-4' }
    });

    // Vision analysis (using expensive gpt-4o)
    tracker.recordUsage({
      provider: 'vision',
      operation: 'analyze',
      tokens: 450 + Math.floor(Math.random() * 100),
      metadata: { iteration: 0, candidateId: i, model: 'gpt-4o' }
    });

    console.log(`  ✅ Candidate ${i}: ${tracker.getStats().totalTokens.toLocaleString()} tokens (cumulative)`);
  }

  console.log();
  console.log('🔧 Simulating Iteration 1: Refinement - WHAT dimension (M=2 survivors)');
  console.log('-'.repeat(80));

  // Simulate 2 parents generating 2 children each (4 total)
  for (let parentIdx = 0; parentIdx < 2; parentIdx++) {
    // Generate critique (using gpt-4)
    tracker.recordUsage({
      provider: 'critique',
      operation: 'generate',
      tokens: 200 + Math.floor(Math.random() * 50),
      metadata: { iteration: 1, parentId: parentIdx, dimension: 'what', model: 'gpt-4' }
    });

    for (let childIdx = 0; childIdx < 2; childIdx++) {
      const candidateId = parentIdx * 2 + childIdx;

      // Refine WHAT (using gpt-4)
      tracker.recordUsage({
        provider: 'llm',
        operation: 'refine',
        tokens: 140 + Math.floor(Math.random() * 40),
        metadata: { iteration: 1, candidateId, dimension: 'what', parentId: parentIdx, model: 'gpt-4' }
      });

      // Combine (using gpt-4)
      tracker.recordUsage({
        provider: 'llm',
        operation: 'combine',
        tokens: 85 + Math.floor(Math.random() * 15),
        metadata: { iteration: 1, candidateId, model: 'gpt-4' }
      });

      // Vision (using gpt-4o)
      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 480 + Math.floor(Math.random() * 80),
        metadata: { iteration: 1, candidateId, model: 'gpt-4o' }
      });

      console.log(`  ✅ Candidate ${candidateId} (parent ${parentIdx}): ${tracker.getStats().totalTokens.toLocaleString()} tokens (cumulative)`);
    }
  }

  console.log();
  console.log('🔧 Simulating Iteration 2: Refinement - HOW dimension (M=2 survivors)');
  console.log('-'.repeat(80));

  // Simulate 2 parents generating 2 children each (4 total)
  for (let parentIdx = 0; parentIdx < 2; parentIdx++) {
    // Generate critique (using gpt-4)
    tracker.recordUsage({
      provider: 'critique',
      operation: 'generate',
      tokens: 210 + Math.floor(Math.random() * 60),
      metadata: { iteration: 2, parentId: parentIdx, dimension: 'how', model: 'gpt-4' }
    });

    for (let childIdx = 0; childIdx < 2; childIdx++) {
      const candidateId = parentIdx * 2 + childIdx;

      // Refine HOW (using gpt-4)
      tracker.recordUsage({
        provider: 'llm',
        operation: 'refine',
        tokens: 130 + Math.floor(Math.random() * 50),
        metadata: { iteration: 2, candidateId, dimension: 'how', parentId: parentIdx, model: 'gpt-4' }
      });

      // Combine (using gpt-4)
      tracker.recordUsage({
        provider: 'llm',
        operation: 'combine',
        tokens: 90 + Math.floor(Math.random() * 20),
        metadata: { iteration: 2, candidateId, model: 'gpt-4' }
      });

      // Vision (using gpt-4o)
      tracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: 490 + Math.floor(Math.random() * 70),
        metadata: { iteration: 2, candidateId, model: 'gpt-4o' }
      });

      console.log(`  ✅ Candidate ${candidateId} (parent ${parentIdx}): ${tracker.getStats().totalTokens.toLocaleString()} tokens (cumulative)`);
    }
  }

  console.log();
  console.log(tracker.formatSummary());

  // Display efficiency metrics
  const metrics = tracker.getEfficiencyMetrics();
  console.log('\n💡 Efficiency Insights');
  console.log('═'.repeat(60));
  console.log(`Average tokens per candidate: ${metrics.avgTokensPerCandidate.toFixed(0)}`);
  console.log('\nToken distribution by provider:');
  console.log(`  • LLM: ${metrics.providerPercentages.llm.toFixed(1)}%`);
  console.log(`  • Vision: ${metrics.providerPercentages.vision.toFixed(1)}%`);
  console.log(`  • Critique: ${metrics.providerPercentages.critique.toFixed(1)}%`);
  console.log(`\nMost expensive operation: ${metrics.mostExpensiveOperation} (${metrics.mostExpensiveOperationTokens.toLocaleString()} tokens)`);

  // Display breakdown by iteration
  const stats = tracker.getStats();
  console.log('\nTokens by iteration:');
  for (const [iter, tokens] of Object.entries(stats.byIteration)) {
    console.log(`  • Iteration ${iter}: ${tokens.toLocaleString()} tokens`);
  }

  // Display optimization suggestions
  console.log(tracker.formatOptimizationReport());

  console.log('\n✅ Demo complete!');
  console.log('\n💡 Integration tip: Pass tokenTracker to beamSearch config:');
  console.log('   const config = { beamWidth: 4, keepTop: 2, tokenTracker };');
  console.log('\n💡 Cost savings: Implement suggested model optimizations to reduce costs');
  console.log('   by using gpt-5.1-nano/mini for simpler LLM tasks and gpt-4o-mini for vision.');
  console.log('   GPT-5.1 models offer superior quality at 50-600x lower cost than legacy GPT-4!');
}

// Run the demo
demo().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
