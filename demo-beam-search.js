#!/usr/bin/env node

/**
 * Demo: Multi-Iteration Beam Search with N=4, M=2
 *
 * This demonstrates the complete beam search algorithm:
 * - N = 4 (beam width: 4 candidates per iteration)
 * - M = 2 (keep top: 2 best candidates survive each round)
 * - Expansion ratio: N/M = 2 children per parent
 *
 * Algorithm Flow:
 * 1. Iteration 0: Generate 4 diverse WHAT+HOW pairs (expansion)
 *    → Rank by score → Keep top 2
 * 2. Iteration 1: 2 parents generate 4 children (refine WHAT/content)
 *    → Rank by score → Keep top 2
 * 3. Iteration 2: 2 parents generate 4 children (refine HOW/style)
 *    → Rank by score → Keep top 2
 * 4. Return best candidate from final iteration
 *
 * Rate Limiting:
 * - Uses sensible defaults to prevent OpenAI API rate limit errors (429)
 * - Configurable via environment variables:
 *   - BEAM_SEARCH_RATE_LIMIT_LLM (default: 3 concurrent)
 *   - BEAM_SEARCH_RATE_LIMIT_IMAGE_GEN (default: 2 concurrent)
 *   - BEAM_SEARCH_RATE_LIMIT_VISION (default: 3 concurrent)
 *
 * Output Structure:
 * - Metadata and images saved to: output/YYYY-MM-DD/ses-HHMMSS/
 * - Uses OutputPathManager for consistent path construction
 *
 * Usage:
 *   node demo-beam-search.js
 *
 * Requirements:
 *   - OPENAI_API_KEY environment variable set
 */

require('dotenv').config();

const { beamSearch } = require('./src/orchestrator/beam-search.js');
const rateLimitConfig = require('./src/config/rate-limits.js');
const OpenAILLMProvider = require('./src/providers/openai-llm-provider.js');
const OpenAIImageProvider = require('./src/providers/openai-image-provider.js');
const OpenAIVisionProvider = require('./src/providers/openai-vision-provider.js');
const CritiqueGenerator = require('./src/services/critique-generator.js');
const MetadataTracker = require('./src/services/metadata-tracker.js');
const TokenTracker = require('./src/utils/token-tracker.js');
const { MODEL_PRICING } = require('./src/config/model-pricing.js');
const { buildSessionPath, buildMetadataPath, DEFAULT_OUTPUT_DIR } = require('./src/utils/output-path-manager.js');

/**
 * Custom logging wrapper to track beam search progress
 */
class BeamSearchLogger {
  constructor(providers) {
    this.originalProviders = providers;
    this.iterationCounts = { llm: 0, imageGen: 0, vision: 0, critique: 0 };
    this.currentIteration = -1;
  }

  wrapProviders() {
    return {
      llm: this.wrapLLM(this.originalProviders.llm),
      imageGen: this.wrapImageGen(this.originalProviders.imageGen),
      vision: this.wrapVision(this.originalProviders.vision),
      critiqueGen: this.wrapCritique(this.originalProviders.critiqueGen)
    };
  }

  wrapLLM(llm) {
    return {
      refinePrompt: async (prompt, options) => {
        if (options.operation === 'expand' && this.currentIteration !== 0) {
          this.currentIteration = 0;
          console.log('\n' + '='.repeat(80));
          console.log('🔄 ITERATION 0: Initial Expansion (N=4 diverse candidates)');
          console.log('='.repeat(80));
        }
        const result = await llm.refinePrompt(prompt, options);
        return result;
      },
      combinePrompts: async (what, how) => {
        return llm.combinePrompts(what, how);
      }
    };
  }

  wrapImageGen(imageGen) {
    return {
      generateImage: async (prompt, options) => {
        if (options.iteration !== this.currentIteration && options.iteration > 0) {
          this.currentIteration = options.iteration;
          const dimension = options.iteration % 2 === 1 ? 'WHAT (content)' : 'HOW (style)';
          console.log('\n' + '='.repeat(80));
          console.log(`🔄 ITERATION ${options.iteration}: Refinement - ${dimension}`);
          console.log('='.repeat(80));
        }

        console.log(`  🖼️  Generating image for candidate ${options.candidateId}...`);
        const result = await imageGen.generateImage(prompt, options);
        if (result.localPath) {
          console.log(`     💾 Saved: ${result.localPath}`);
        }
        return result;
      }
    };
  }

  wrapVision(vision) {
    return {
      analyzeImage: async (imageUrl, prompt) => {
        const result = await vision.analyzeImage(imageUrl, prompt);
        console.log(`     📊 Scores: alignment=${result.alignmentScore}/100, aesthetic=${result.aestheticScore}/10`);
        return result;
      }
    };
  }

  wrapCritique(critique) {
    return {
      generateCritique: async (evaluation, prompts, options) => {
        return critique.generateCritique(evaluation, prompts, options);
      }
    };
  }
}

async function demo() {
  console.log('🚀 Beam Search Demo: Multi-Iteration Refinement');
  console.log('='.repeat(80));
  console.log('Configuration:');
  console.log('  • N = 4 (beam width: 4 candidates per iteration)');
  console.log('  • M = 2 (keep top: 2 best candidates survive)');
  console.log('  • Expansion ratio: 2 children per parent');
  console.log('  • Max iterations: 3 (iteration 0, 1, 2)');
  console.log('  • Alpha: 0.7 (70% alignment, 30% aesthetic)');
  console.log('');
  console.log('Rate Limiting (prevents OpenAI 429 errors):');
  console.log(`  • LLM concurrency: ${rateLimitConfig.defaults.llm} requests`);
  console.log(`  • Image Gen concurrency: ${rateLimitConfig.defaults.imageGen} requests`);
  console.log(`  • Vision concurrency: ${rateLimitConfig.defaults.vision} requests`);
  console.log('  • Configure via: BEAM_SEARCH_RATE_LIMIT_* env vars');
  console.log('='.repeat(80));

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('\n❌ Error: OPENAI_API_KEY not found in environment');
    console.error('   Please set it in your .env file or environment');
    process.exit(1);
  }

  // Generate session ID in ses-HHMMSS format
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const sessionId = `ses-${hours}${minutes}${seconds}`;

  // Configuration
  const userPrompt = 'a serene mountain landscape at sunset';

  // Initialize providers
  console.log('\n🔧 Initializing providers...');
  const providers = {
    llm: new OpenAILLMProvider(process.env.OPENAI_API_KEY),
    imageGen: new OpenAIImageProvider(process.env.OPENAI_API_KEY, { sessionId }),
    vision: new OpenAIVisionProvider(process.env.OPENAI_API_KEY),
    critiqueGen: new CritiqueGenerator({ apiKey: process.env.OPENAI_API_KEY })
  };
  console.log('✅ All providers initialized');

  // Wrap providers with logging
  const logger = new BeamSearchLogger(providers);
  const wrappedProviders = logger.wrapProviders();

  // Initialize metadata tracker
  console.log(`📊 Initializing metadata tracker (session: ${sessionId})...`);
  const metadataTracker = new MetadataTracker({
    sessionId,
    userPrompt,
    config: {
      beamWidth: 4,
      keepTop: 2,
      maxIterations: 3,
      alpha: 0.7,
      temperature: 0.8
    }
  });
  await metadataTracker.initialize();
  console.log('✅ Metadata tracker ready');

  // Initialize token tracker for cost efficiency
  console.log(`💰 Initializing token efficiency tracker (session: ${sessionId})...`);
  const tokenTracker = new TokenTracker({
    sessionId,
    pricing: MODEL_PRICING
  });
  console.log('✅ Token tracker ready - cost tracking enabled');

  const config = {
    beamWidth: 4,        // N = 4 candidates
    keepTop: 2,          // M = 2 survivors
    maxIterations: 3,    // Run 3 iterations (0, 1, 2)
    alpha: 0.7,          // 70% alignment, 30% aesthetic
    temperature: 0.8,    // Stochastic variation for diversity
    metadataTracker,     // Add metadata tracker to config
    tokenTracker         // Add token tracker to config
    // Note: Rate limits use defaults from rate-limits.js automatically
    // No need to specify rateLimitConcurrency - beam search uses sensible defaults
    // Can override via BEAM_SEARCH_RATE_LIMIT_* environment variables
  };

  console.log('\n📝 User Prompt: "' + userPrompt + '"');
  console.log('\n⏱️  Starting beam search...\n');

  const startTime = Date.now();

  // Run beam search
  const winner = await beamSearch(userPrompt, wrappedProviders, config);

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);

  // Display results
  console.log('\n' + '='.repeat(80));
  console.log('🏆 WINNER: Best Candidate from Final Iteration');
  console.log('='.repeat(80));
  console.log('\n📊 Final Scores:');
  console.log(`   • Total Score: ${winner.totalScore.toFixed(2)}/100`);
  console.log(`   • Alignment Score: ${winner.evaluation.alignmentScore}/100 (content match)`);
  console.log(`   • Aesthetic Score: ${winner.evaluation.aestheticScore}/10 (visual quality)`);

  console.log('\n🔍 Metadata:');
  console.log(`   • From Iteration: ${winner.metadata.iteration}`);
  console.log(`   • Candidate ID: ${winner.metadata.candidateId}`);
  if (winner.metadata.parentId !== undefined) {
    console.log(`   • Parent ID: ${winner.metadata.parentId} (lineage tracking)`);
  }
  console.log(`   • Last Refined Dimension: ${winner.metadata.dimension}`);

  console.log('\n📝 Prompts:');
  console.log(`   • WHAT (content): "${winner.whatPrompt.substring(0, 80)}..."`);
  console.log(`   • HOW (style): "${winner.howPrompt.substring(0, 80)}..."`);
  console.log(`   • Combined: "${winner.combined.substring(0, 80)}..."`);

  console.log('\n🖼️  Image:');
  console.log(`   • URL: ${winner.image.url}`);
  if (winner.image.localPath) {
    console.log(`   • Local: ${winner.image.localPath}`);
  }

  console.log('\n📈 Evaluation:');
  console.log(`   • Analysis: ${winner.evaluation.analysis}`);
  if (winner.evaluation.strengths.length > 0) {
    console.log(`   • Strengths: ${winner.evaluation.strengths.join(', ')}`);
  }
  if (winner.evaluation.weaknesses.length > 0) {
    console.log(`   • Weaknesses: ${winner.evaluation.weaknesses.join(', ')}`);
  }

  console.log('\n⏱️  Performance:');
  console.log(`   • Total time: ${duration}s`);

  console.log('\n📊 Session Metadata:');
  console.log(`   • Session ID: ${sessionId}`);
  console.log(`   • Metadata saved to: ${buildMetadataPath(DEFAULT_OUTPUT_DIR, sessionId)}`);
  console.log(`   • Images saved to: ${buildSessionPath(DEFAULT_OUTPUT_DIR, sessionId)}/`);

  // Display lineage info
  const metadata = await metadataTracker.getMetadata();
  if (metadata.lineage) {
    console.log('\n🌳 Winner Lineage (evolution path):');
    metadata.lineage.forEach((node, idx) => {
      const prefix = idx === 0 ? '   ├─' : '   └─';
      console.log(`${prefix} Iteration ${node.iteration}, Candidate ${node.candidateId}`);
    });
  }

  // Display token efficiency report
  console.log('\n' + '='.repeat(80));
  console.log('💰 Token Efficiency Report');
  console.log('='.repeat(80));

  tokenTracker.finalize();
  console.log(tokenTracker.formatSummary());

  // Display optimization suggestions
  console.log(tokenTracker.formatOptimizationReport());

  console.log('\n' + '='.repeat(80));
  console.log('✅ Beam search completed successfully!');
  console.log('\n💡 Key Observations:');
  console.log('   • Iteration 0: Generated 4 diverse candidates, kept top 2');
  console.log('   • Iteration 1: Refined WHAT (content), kept top 2');
  console.log('   • Iteration 2: Refined HOW (style), kept top 2');
  console.log('   • Winner emerged through iterative refinement + selection pressure');
  console.log('   • Complete metadata and lineage tracked in metadata.json');
  console.log('   • Token efficiency tracking shows real costs and optimization opportunities');
  console.log('='.repeat(80));
  console.log();
}

// Run the demo
demo().catch(error => {
  console.error('\n❌ Demo failed:', error);
  console.error('\nStack trace:');
  console.error(error.stack);
  process.exit(1);
});
