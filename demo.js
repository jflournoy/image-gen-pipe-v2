#!/usr/bin/env node

/**
 * Demo script showing all 4 provider interfaces in action
 *
 * Usage:
 *   node demo.js           # Use mock providers (default)
 *   node demo.js --real    # Use real providers (requires API keys)
 *   PROVIDER_MODE=real node demo.js  # Use env var
 */

const { createProviders } = require('./src/factory/provider-factory.js');

async function demo() {
  // Determine provider mode from CLI args or env
  const useRealProviders = process.argv.includes('--real');
  const mode = useRealProviders ? 'real' : 'mock';

  console.log('🎨 Image Generation Pipeline - Provider Demo\n');
  console.log('='.repeat(60));
  console.log(`Provider Mode: ${mode.toUpperCase()}`);
  console.log('='.repeat(60));
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

  const howRefinement = await llm.refinePrompt(originalPrompt, { dimension: 'how' });
  console.log('\nHOW refinement (style):');
  console.log(`  → "${howRefinement.refinedPrompt}"`);
  console.log(`  Tokens used: ${howRefinement.metadata.tokensUsed}`);

  console.log();
  console.log('='.repeat(60));
  console.log();

  // Step 2: Generate an image
  console.log('🖼️  Step 2: Generating image with refined prompt');
  console.log('-'.repeat(60));

  const combinedPrompt = whatRefinement.refinedPrompt;

  console.log(`Using prompt: "${combinedPrompt.substring(0, 50)}..."`);

  const generatedImage = await image.generateImage(combinedPrompt, {
    size: '1024x1024',
    quality: 'hd',
    style: 'vivid'
  });

  console.log('\nGenerated image:');
  console.log(`  URL: ${generatedImage.url}`);
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
  console.log('✅ Demo complete! All 4 providers working correctly.');
  console.log();
  console.log('💡 This demonstrates the full pipeline:');
  console.log('   1. LLM refines prompts (WHAT/HOW dimensions)');
  console.log('   2. ImageGen creates images from refined prompts');
  console.log('   3. Vision analyzes images and calculates alignment');
  console.log('   4. Scoring combines scores for candidate ranking');
  console.log();
}

// Run the demo
demo().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
