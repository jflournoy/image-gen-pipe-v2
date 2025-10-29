#!/usr/bin/env node

/**
 * Demo: Complete Single Iteration of Beam Search Pipeline
 *
 * This demonstrates ALL steps working together in one iteration:
 * 1. User provides initial prompt
 * 2. Expand into WHAT (content) and HOW (style) prompts
 * 3. Combine WHAT + HOW into unified prompt
 * 4. Generate image with DALL-E 3
 * 5. Evaluate image with GPT-4o Vision (alignment + aesthetic scores)
 * 6. Generate structured critique based on evaluation (dimension-aware)
 * 7. Refine prompt using critique (WHAT or HOW depending on iteration)
 * 8. Ready for next iteration!
 *
 * Usage:
 *   node demo-single-iteration.js
 *
 * Requirements:
 *   - OPENAI_API_KEY environment variable set
 */

require('dotenv').config();

const OpenAILLMProvider = require('./src/providers/openai-llm-provider.js');
const OpenAIImageProvider = require('./src/providers/openai-image-provider.js');
const OpenAIVisionProvider = require('./src/providers/openai-vision-provider.js');
const CritiqueGenerator = require('./src/services/critique-generator.js');

async function demo() {
  console.log('🔄 Complete Single Iteration Demo\n');
  console.log('='.repeat(80));
  console.log('Demonstrating all 8 steps of the beam search pipeline');
  console.log('='.repeat(80));
  console.log();

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY not found in environment');
    console.error('   Please set it in your .env file or environment');
    process.exit(1);
  }

  // Initialize all components
  console.log('🔧 Initializing components...');
  const llm = new OpenAILLMProvider(process.env.OPENAI_API_KEY);
  const imageGen = new OpenAIImageProvider(process.env.OPENAI_API_KEY);
  const vision = new OpenAIVisionProvider(process.env.OPENAI_API_KEY);
  const critique = new CritiqueGenerator({ apiKey: process.env.OPENAI_API_KEY });
  console.log('✅ All components initialized\n');

  console.log('='.repeat(80));
  console.log();

  // STEP 1: User provides initial prompt
  console.log('📝 STEP 1: Initial User Prompt');
  console.log('-'.repeat(80));
  const initialPrompt = 'a serene mountain landscape at sunset';
  console.log(`User prompt: "${initialPrompt}"`);
  console.log();

  // STEP 2: Expand into WHAT and HOW prompts
  console.log('='.repeat(80));
  console.log();
  console.log('✨ STEP 2: Expand into WHAT (content) and HOW (style) prompts');
  console.log('-'.repeat(80));

  console.log('Expanding WHAT dimension (content)...');
  const whatExpansion = await llm.refinePrompt(initialPrompt, {
    dimension: 'what',
    operation: 'expand'
  });
  console.log(`✅ WHAT: "${whatExpansion.refinedPrompt}"`);
  console.log(`   Tokens: ${whatExpansion.metadata.tokensUsed}`);

  console.log('\nExpanding HOW dimension (style)...');
  const howExpansion = await llm.refinePrompt(initialPrompt, {
    dimension: 'how',
    operation: 'expand'
  });
  console.log(`✅ HOW: "${howExpansion.refinedPrompt}"`);
  console.log(`   Tokens: ${howExpansion.metadata.tokensUsed}`);
  console.log();

  // STEP 3: Combine WHAT + HOW
  console.log('='.repeat(80));
  console.log();
  console.log('🔗 STEP 3: Combine WHAT + HOW prompts');
  console.log('-'.repeat(80));

  console.log('Combining prompts...');
  const combinedPrompt = await llm.combinePrompts(
    whatExpansion.refinedPrompt,
    howExpansion.refinedPrompt
  );
  console.log(`✅ Combined: "${combinedPrompt}"`);
  console.log();

  // STEP 4: Generate image
  console.log('='.repeat(80));
  console.log();
  console.log('🖼️  STEP 4: Generate Image');
  console.log('-'.repeat(80));

  console.log('Calling DALL-E 3...');
  const generatedImage = await imageGen.generateImage(combinedPrompt, {
    size: '1024x1024',
    quality: 'standard',
    iteration: 0,
    candidateId: 0,
    dimension: 'what'  // First iteration refines WHAT
  });
  console.log(`✅ Image generated: ${generatedImage.url}`);
  if (generatedImage.localPath) {
    console.log(`💾 Saved to: ${generatedImage.localPath}`);
  }
  console.log(`📝 DALL-E revised: "${generatedImage.revisedPrompt.substring(0, 100)}..."`);
  console.log();

  // STEP 5: Evaluate image
  console.log('='.repeat(80));
  console.log();
  console.log('🔍 STEP 5: Evaluate Image with Vision Provider');
  console.log('-'.repeat(80));

  console.log('Analyzing image with GPT-4o Vision...');
  const evaluation = await vision.analyzeImage(
    generatedImage.url,
    combinedPrompt
  );
  console.log(`✅ Alignment Score: ${evaluation.alignmentScore}/100 (content match)`);
  console.log(`✨ Aesthetic Score: ${evaluation.aestheticScore}/10 (visual quality)`);
  console.log(`📊 Analysis: ${evaluation.analysis}`);
  if (evaluation.strengths.length > 0) {
    console.log(`💪 Strengths: ${evaluation.strengths.join(', ')}`);
  }
  if (evaluation.weaknesses.length > 0) {
    console.log(`⚠️  Weaknesses: ${evaluation.weaknesses.join(', ')}`);
  }
  console.log(`🔢 Tokens used: ${evaluation.metadata.tokensUsed}`);
  console.log();

  // STEP 6: Generate critique
  console.log('='.repeat(80));
  console.log();
  console.log('💭 STEP 6: Generate Structured Critique');
  console.log('-'.repeat(80));

  // First iteration refines WHAT (content)
  const dimension = 'what';  // Alternate: odd iterations = 'what', even = 'how'

  console.log(`Generating critique for ${dimension.toUpperCase()} dimension...`);
  const critiqueResult = await critique.generateCritique(
    evaluation,
    {
      what: whatExpansion.refinedPrompt,
      how: howExpansion.refinedPrompt,
      combined: combinedPrompt
    },
    {
      dimension: dimension,
      iteration: 0
    }
  );

  console.log('✅ Critique generated:');
  console.log(`   📌 Critique: ${critiqueResult.critique}`);
  console.log(`   💡 Recommendation: ${critiqueResult.recommendation}`);
  console.log(`   🎯 Reason: ${critiqueResult.reason}`);
  console.log(`   📊 Score used: ${critiqueResult.metadata.scoreType} (${dimension === 'what' ? 'alignment' : 'aesthetic'})`);
  console.log(`   🔢 Tokens used: ${critiqueResult.metadata.tokensUsed}`);
  console.log();

  // STEP 7: Refine prompt using critique
  console.log('='.repeat(80));
  console.log();
  console.log('🔄 STEP 7: Refine Prompt Based on Critique');
  console.log('-'.repeat(80));

  console.log(`Refining ${dimension.toUpperCase()} prompt with structured critique...`);
  const refinedPrompt = await llm.refinePrompt(
    dimension === 'what' ? whatExpansion.refinedPrompt : howExpansion.refinedPrompt,
    {
      operation: 'refine',
      dimension: dimension,
      critique: critiqueResult  // Pass entire structured critique object!
    }
  );

  console.log(`✅ Refined ${dimension.toUpperCase()} prompt:`);
  console.log(`   "${refinedPrompt.refinedPrompt}"`);
  console.log(`   🔢 Tokens used: ${refinedPrompt.metadata.tokensUsed}`);
  console.log();

  // STEP 8: Ready for next iteration
  console.log('='.repeat(80));
  console.log();
  console.log('🚀 STEP 8: Ready for Next Iteration');
  console.log('-'.repeat(80));

  console.log('State for next iteration:');
  console.log(`   WHAT prompt: "${dimension === 'what' ? refinedPrompt.refinedPrompt : whatExpansion.refinedPrompt}"`);
  console.log(`   HOW prompt: "${dimension === 'how' ? refinedPrompt.refinedPrompt : howExpansion.refinedPrompt}"`);
  console.log(`   Previous alignment score: ${evaluation.alignmentScore}/100`);
  console.log(`   Previous aesthetic score: ${evaluation.aestheticScore}/10`);
  console.log(`   Next dimension to refine: ${dimension === 'what' ? 'HOW (style)' : 'WHAT (content)'}`);
  console.log();

  // Summary
  console.log('='.repeat(80));
  console.log();
  console.log('✅ Complete Iteration Demonstrated!');
  console.log();
  console.log('📊 Summary:');
  console.log('   ✓ Expanded terse prompt into rich WHAT/HOW prompts');
  console.log('   ✓ Combined prompts for unified image generation');
  console.log('   ✓ Generated image with DALL-E 3');
  console.log('   ✓ Evaluated with dual scoring: alignment (content) + aesthetic (visual)');
  console.log('   ✓ Generated dimension-aware critique (uses relevant score)');
  console.log('   ✓ Refined prompt using structured critique');
  console.log('   ✓ Ready to repeat cycle with improved prompts');
  console.log();
  console.log('🔄 This process repeats for multiple iterations (beam search)');
  console.log('   - Alternate between refining WHAT (odd) and HOW (even) iterations');
  console.log('   - WHAT dimension: uses alignment score (content match)');
  console.log('   - HOW dimension: uses aesthetic score (visual quality)');
  console.log('   - Keep top candidates (beam width)');
  console.log('   - Track lineage and scores');
  console.log('   - Continue until max iterations or convergence');
  console.log();
  console.log('🎯 All 7 components working together seamlessly!');
  console.log('   Only the Orchestrator remains to automate this loop.');
  console.log();
}

// Run the demo
demo().catch(error => {
  console.error('❌ Demo failed:', error);
  console.error('\nStack trace:');
  console.error(error.stack);
  process.exit(1);
});
