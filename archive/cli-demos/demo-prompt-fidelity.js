#!/usr/bin/env node

/**
 * Demo script showcasing OpenAI Vision Provider with Prompt Fidelity evaluation
 *
 * This demonstrates the new prompt fidelity evaluation feature that provides:
 * - Numeric fidelity score (0.0-1.0)
 * - Structured analysis of image-prompt alignment
 * - Actionable strengths and weaknesses
 * - Foundation for iterative prompt refinement
 *
 * Usage:
 *   node demo-prompt-fidelity.js
 *
 * Requirements:
 *   - OPENAI_API_KEY environment variable set
 */

require('dotenv').config();

const OpenAILLMProvider = require('./src/providers/openai-llm-provider.js');
const OpenAIImageProvider = require('./src/providers/openai-image-provider.js');
const OpenAIVisionProvider = require('./src/providers/openai-vision-provider.js');
const TokenTracker = require('./src/utils/token-tracker.js');
const { MODEL_PRICING } = require('./src/config/model-pricing.js');

async function demo() {
  console.log('🎨 Prompt Fidelity Evaluation Demo\n');
  console.log('='.repeat(70));
  console.log('This demo shows how we evaluate image-prompt alignment');
  console.log('='.repeat(70));
  console.log();

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY not found in environment');
    console.error('   Please set it in your .env file or environment');
    process.exit(1);
  }

  // Initialize providers
  const llm = new OpenAILLMProvider(process.env.OPENAI_API_KEY);
  const imageGen = new OpenAIImageProvider(process.env.OPENAI_API_KEY);
  const vision = new OpenAIVisionProvider(process.env.OPENAI_API_KEY);

  // Initialize token tracker for cost efficiency
  const sessionId = `demo-fidelity-${Date.now()}`;
  const tokenTracker = new TokenTracker({
    sessionId,
    pricing: MODEL_PRICING
  });
  console.log('💰 Token efficiency tracking: ENABLED\n');

  // Step 1: Start with a simple prompt
  console.log('📝 Step 1: Expanding initial prompt');
  console.log('-'.repeat(70));

  const originalPrompt = 'a serene mountain landscape at sunset';
  console.log(`Original prompt: "${originalPrompt}"`);

  // Expand WHAT (content)
  const whatExpansion = await llm.refinePrompt(originalPrompt, {
    dimension: 'what',
    operation: 'expand'
  });
  console.log('\n✨ WHAT expansion (content):');
  console.log(`"${whatExpansion.refinedPrompt}"`);
  console.log(`Tokens: ${whatExpansion.metadata.tokensUsed}, Model: ${whatExpansion.metadata.model}`);

  // Track token usage
  tokenTracker.recordUsage({
    provider: 'llm',
    operation: 'expand',
    tokens: whatExpansion.metadata.tokensUsed,
    metadata: {
      model: whatExpansion.metadata.model,
      dimension: 'what',
      operation: 'expand'
    }
  });

  // Expand HOW (style)
  const howExpansion = await llm.refinePrompt(originalPrompt, {
    dimension: 'how',
    operation: 'expand'
  });
  console.log('\n🎨 HOW expansion (style):');
  console.log(`"${howExpansion.refinedPrompt}"`);
  console.log(`Tokens: ${howExpansion.metadata.tokensUsed}, Model: ${howExpansion.metadata.model}`);

  // Track token usage
  tokenTracker.recordUsage({
    provider: 'llm',
    operation: 'expand',
    tokens: howExpansion.metadata.tokensUsed,
    metadata: {
      model: howExpansion.metadata.model,
      dimension: 'how',
      operation: 'expand'
    }
  });

  // Combine prompts
  const combineResult = await llm.combinePrompts(
    whatExpansion.refinedPrompt,
    howExpansion.refinedPrompt
  );
  const combinedPrompt = combineResult.combinedPrompt;
  console.log('\n🔗 Combined prompt:');
  console.log(`"${combinedPrompt}"`);
  console.log(`Tokens: ${combineResult.metadata.tokensUsed}, Model: ${combineResult.metadata.model}`);

  // Track combine operation
  tokenTracker.recordUsage({
    provider: 'llm',
    operation: 'combine',
    tokens: combineResult.metadata.tokensUsed,
    metadata: {
      model: combineResult.metadata.model,
      operation: 'combine'
    }
  });

  console.log();
  console.log('='.repeat(70));
  console.log();

  // Step 2: Generate image
  console.log('🖼️  Step 2: Generating image');
  console.log('-'.repeat(70));

  console.log('Calling DALL-E 3...');
  const generatedImage = await imageGen.generateImage(combinedPrompt, {
    size: '1024x1024',
    quality: 'standard',
    iteration: 0,
    candidateId: 0,
    dimension: 'what'
  });

  console.log(`✅ Image generated: ${generatedImage.url}`);
  if (generatedImage.localPath) {
    console.log(`💾 Saved locally: ${generatedImage.localPath}`);
  }
  console.log(`📝 DALL-E revised prompt: "${generatedImage.revisedPrompt.substring(0, 80)}..."`);

  console.log();
  console.log('='.repeat(70));
  console.log();

  // Step 3: Evaluate prompt fidelity
  console.log('🔍 Step 3: Evaluating Prompt Fidelity');
  console.log('-'.repeat(70));

  console.log('Analyzing image with GPT-4o Vision...');
  const evaluation = await vision.analyzeImage(
    generatedImage.url,
    combinedPrompt
  );

  console.log('\n📊 Evaluation Results:');
  console.log('─'.repeat(70));
  console.log(`\n🎯 Alignment Score: ${evaluation.alignmentScore}/100`);
  console.log(`   (${(evaluation.alignmentScore / 100).toFixed(3)} on 0-1 scale)`);

  console.log('\n💭 Analysis:');
  console.log(`   ${evaluation.analysis}`);

  if (evaluation.strengths.length > 0) {
    console.log('\n✅ Strengths:');
    evaluation.strengths.forEach(strength => {
      console.log(`   • ${strength}`);
    });
  }

  if (evaluation.weaknesses.length > 0) {
    console.log('\n⚠️  Areas for Improvement:');
    evaluation.weaknesses.forEach(weakness => {
      console.log(`   • ${weakness}`);
    });
  }

  console.log('\n📈 Metadata:');
  console.log(`   Model: ${evaluation.metadata.model}`);
  console.log(`   Tokens used: ${evaluation.metadata.tokensUsed}`);
  console.log(`   Timestamp: ${evaluation.metadata.timestamp}`);

  // Track vision token usage
  tokenTracker.recordUsage({
    provider: 'vision',
    operation: 'analyze',
    tokens: evaluation.metadata.tokensUsed,
    metadata: {
      model: evaluation.metadata.model,
      operation: 'analyze'
    }
  });

  console.log();
  console.log('='.repeat(70));
  console.log();

  // Step 4: Demonstrate refinement potential
  console.log('🔄 Step 4: How this enables iterative refinement');
  console.log('-'.repeat(70));

  console.log('\n💡 The evaluation provides actionable feedback for refinement:');
  console.log();

  if (evaluation.alignmentScore < 80) {
    console.log('Since alignment < 80%, we could:');
    console.log('  1. Use weaknesses to generate critique');
    console.log('  2. Refine the prompt with: llm.refinePrompt(prompt, {');
    console.log('       operation: "refine",');
    console.log('       critique: "Address: ' + (evaluation.weaknesses[0] || 'improve alignment') + '"');
    console.log('     })');
    console.log('  3. Generate new image and re-evaluate');
    console.log('  4. Repeat until alignment > 80%');
  } else {
    console.log('✨ High alignment score! This prompt-image pair is well-aligned.');
    console.log('   In beam search, this candidate would be kept for the next round.');
  }

  console.log();
  console.log('='.repeat(70));
  console.log();

  // Display token efficiency report
  console.log('💰 Token Efficiency Report');
  console.log('='.repeat(70));

  console.log(tokenTracker.formatSummary());

  // Display optimization suggestions
  console.log(tokenTracker.formatOptimizationReport());

  console.log('='.repeat(70));
  console.log();
  console.log('✅ Demo complete!');
  console.log();
  console.log('📚 What we demonstrated:');
  console.log('   ✓ Expand prompt into WHAT and HOW dimensions');
  console.log('   ✓ Combine prompts for image generation');
  console.log('   ✓ Generate image with DALL-E 3');
  console.log('   ✓ Evaluate prompt fidelity with GPT-4o Vision');
  console.log('   ✓ Get structured feedback (score + strengths + weaknesses)');
  console.log('   ✓ Track token usage and costs for all operations');
  console.log();
  console.log('🚀 This is Step 5 of the beam search pipeline!');
  console.log();
}

// Run the demo
demo().catch(error => {
  console.error('❌ Demo failed:', error);
  console.error('\nStack trace:');
  console.error(error.stack);
  process.exit(1);
});
