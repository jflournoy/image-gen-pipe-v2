#!/usr/bin/env node

/**
 * Demo script showing all 4 provider interfaces in action
 *
 * Usage:
 *   node demo.js           # Use mock providers (default)
 *   node demo.js --real    # Use real providers (requires API keys)
 *   PROVIDER_MODE=real node demo.js  # Use env var
 *
 * Features:
 *   - Real providers save images locally with beam search structure
 *   - Images saved to: ./output/YYYY-MM-DD/ses-HHMMSS/
 *   - Mock providers skip local storage (no beam search context)
 *   - Token efficiency tracking with cost analysis and optimization suggestions
 */

const { createProviders } = require('./src/factory/provider-factory.js');
const TokenTracker = require('./src/utils/token-tracker.js');
const { MODEL_PRICING } = require('./src/config/model-pricing.js');

async function demo() {
  // Determine provider mode from CLI args or env
  const useRealProviders = process.argv.includes('--real');
  const mode = useRealProviders ? 'real' : 'mock';

  console.log('🎨 Image Generation Pipeline - Provider Demo\n');
  console.log('='.repeat(60));
  console.log(`Provider Mode: ${mode.toUpperCase()}`);
  console.log('='.repeat(60));
  console.log();

  // Initialize token tracker for cost efficiency tracking
  const sessionId = `demo-${Date.now()}`;
  const tokenTracker = new TokenTracker({
    sessionId,
    pricing: MODEL_PRICING
  });
  console.log('💰 Token efficiency tracking: ENABLED');
  console.log();

  // Create providers based on mode
  let providers;
  try {
    providers = createProviders({ mode });
  } catch (error) {
    console.error(`❌ Error creating providers: ${error.message}`);
    console.error('\nHint: For real providers, set OPENAI_API_KEY in .env file');
    process.exit(1);
  }

  const { llm, image, vision, scoring } = providers;

  // Step 1: Refine a prompt using LLM
  console.log('📝 Step 1: Refining prompt with LLM Provider');
  console.log('-'.repeat(60));

  const originalPrompt = 'a mountain landscape';

  console.log(`Original prompt: "${originalPrompt}"`);

  const whatRefinement = await llm.refinePrompt(originalPrompt, { dimension: 'what' });
  console.log('\nWHAT refinement (content):');
  console.log(`  → "${whatRefinement.refinedPrompt}"`);
  console.log(`  Tokens used: ${whatRefinement.metadata.tokensUsed}`);
  console.log(`  Model: ${whatRefinement.metadata.model || 'mock'}`);

  // Track token usage
  tokenTracker.recordUsage({
    provider: 'llm',
    operation: 'expand',
    tokens: whatRefinement.metadata.tokensUsed || 150,
    metadata: {
      model: whatRefinement.metadata.model || 'mock',
      dimension: 'what',
      operation: 'expand'
    }
  });

  const howRefinement = await llm.refinePrompt(originalPrompt, { dimension: 'how' });
  console.log('\nHOW refinement (style):');
  console.log(`  → "${howRefinement.refinedPrompt}"`);
  console.log(`  Tokens used: ${howRefinement.metadata.tokensUsed}`);
  console.log(`  Model: ${howRefinement.metadata.model || 'mock'}`);

  // Track token usage
  tokenTracker.recordUsage({
    provider: 'llm',
    operation: 'expand',
    tokens: howRefinement.metadata.tokensUsed || 150,
    metadata: {
      model: howRefinement.metadata.model || 'mock',
      dimension: 'how',
      operation: 'expand'
    }
  });

  console.log();
  console.log('='.repeat(60));
  console.log();

  // Step 1.5: Combine WHAT and HOW prompts
  console.log('🔗 Step 1.5: Combining WHAT and HOW prompts');
  console.log('-'.repeat(60));

  const combinedPrompt = mode === 'real'
    ? await llm.combinePrompts(whatRefinement.refinedPrompt, howRefinement.refinedPrompt)
    : whatRefinement.refinedPrompt; // Mock provider doesn't have combinePrompts yet

  if (mode === 'real') {
    console.log('Combined prompt created by LLM');
    // Track combine operation (combinePrompts doesn't return metadata yet, so estimate)
    tokenTracker.recordUsage({
      provider: 'llm',
      operation: 'combine',
      tokens: 100, // Estimate
      metadata: {
        model: 'gpt-5.1-nano', // From our config for simple operations
        operation: 'combine'
      }
    });
  } else {
    console.log('Using WHAT prompt only (mock mode)');
  }

  console.log();
  console.log('='.repeat(60));
  console.log();

  // Step 2: Generate an image
  console.log('🖼️  Step 2: Generating image with combined prompt');
  console.log('-'.repeat(60));

  console.log(`Using prompt: "${combinedPrompt.substring(0, 50)}..."`);

  const generatedImage = await image.generateImage(combinedPrompt, {
    size: '1024x1024',
    quality: 'hd',
    style: 'vivid',
    // Beam search context for local storage
    iteration: 0,
    candidateId: 0,
    dimension: 'what'
  });

  console.log('\nGenerated image:');
  console.log(`  URL: ${generatedImage.url}`);
  if (generatedImage.localPath) {
    console.log(`  💾 Saved locally: ${generatedImage.localPath}`);
  }
  console.log(`  Revised prompt: "${generatedImage.revisedPrompt.substring(0, 60)}..."`);
  console.log(`  Model: ${generatedImage.metadata.model}`);
  console.log(`  Size: ${generatedImage.metadata.size}`);
  console.log(`  Quality: ${generatedImage.metadata.quality}`);

  console.log();
  console.log('='.repeat(60));
  console.log();

  // Step 3: Analyze the image with Vision
  console.log('👁️  Step 3: Analyzing image with Vision Provider');
  console.log('-'.repeat(60));

  const analysis = await vision.analyzeImage(
    generatedImage.url,
    originalPrompt,
    { focusAreas: ['composition', 'lighting'] }
  );

  console.log(`Analysis: "${analysis.analysis}"`);
  console.log(`\nAlignment Score: ${analysis.alignmentScore}/100`);
  console.log(`Caption: "${analysis.caption}"`);
  console.log(`Tokens used: ${analysis.metadata.tokensUsed}`);
  console.log(`Model: ${analysis.metadata.model || 'mock'}`);

  // Track vision token usage
  tokenTracker.recordUsage({
    provider: 'vision',
    operation: 'analyze',
    tokens: analysis.metadata.tokensUsed || 500,
    metadata: {
      model: analysis.metadata.model || 'mock',
      operation: 'analyze'
    }
  });

  console.log();
  console.log('='.repeat(60));
  console.log();

  // Step 4: Score the candidate
  console.log('⭐ Step 4: Scoring candidate with Scoring Provider');
  console.log('-'.repeat(60));

  const candidate = {
    prompt: combinedPrompt,
    imageUrl: generatedImage.url,
    alignmentScore: analysis.alignmentScore
  };

  const score = await scoring.scoreCandidate(candidate, { alpha: 0.7 });

  console.log('Breakdown:');
  console.log(`  Alignment score: ${score.breakdown.alignment}/100`);
  console.log(`  Aesthetic score: ${score.breakdown.aesthetic}/10`);
  console.log(`\nTotal Score: ${score.totalScore}/100`);
  console.log(`Formula: 0.7 × ${score.breakdown.alignment} + 0.3 × (${score.breakdown.aesthetic} × 10)`);
  console.log(`       = ${score.totalScore.toFixed(2)}`);

  console.log();
  console.log('='.repeat(60));
  console.log();

  // Step 5: Compare multiple candidates
  console.log('🏆 Step 5: Comparing multiple candidates');
  console.log('-'.repeat(60));

  const candidates = [
    { prompt: 'mountains', imageUrl: 'https://example.com/good.png', alignmentScore: 85 },
    { prompt: 'mountains', imageUrl: 'https://example.com/okay.png', alignmentScore: 70 },
    { prompt: 'mountains', imageUrl: 'https://example.com/best.png', alignmentScore: 95 }
  ];

  console.log('Scoring 3 candidates...\n');

  const scores = await Promise.all(
    candidates.map(async (c, i) => {
      const s = await scoring.scoreCandidate(c);
      return { index: i + 1, ...s };
    })
  );

  // Sort by total score (descending)
  scores.sort((a, b) => b.totalScore - a.totalScore);

  console.log('Rankings (by total score):');
  scores.forEach((s, rank) => {
    console.log(`  ${rank + 1}. Candidate #${s.index}: ${s.totalScore.toFixed(2)} points`);
    console.log(`     (alignment: ${s.breakdown.alignment}, aesthetic: ${s.breakdown.aesthetic})`);
  });

  console.log();
  console.log('='.repeat(60));
  console.log();

  // Display token efficiency report
  console.log('💰 Token Efficiency Report');
  console.log('='.repeat(60));

  tokenTracker.finalize();
  console.log(tokenTracker.formatSummary());

  // Display optimization suggestions
  console.log(tokenTracker.formatOptimizationReport());

  console.log('✅ Demo complete! All 4 providers working correctly.');
  console.log();
  console.log('💡 This demonstrates the full pipeline:');
  console.log('   1. LLM refines prompts (WHAT/HOW dimensions)');
  console.log('   2. ImageGen creates images from refined prompts');
  console.log('   3. Vision analyzes images and calculates alignment');
  console.log('   4. Scoring combines scores for candidate ranking');
  console.log('   5. Token efficiency tracking shows costs and optimization opportunities');
  console.log();
}

// Run the demo
demo().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
