#!/usr/bin/env node

/**
 * Demo: Multi-Iteration Beam Search with N=4, M=2
 *
 * ✨ Latest Features & Innovations:
 * - Real-time rate limiting metrics API (see /demo or http://localhost:3000/demo)
 * - Accurate token tracking across all providers (LLM, Vision, Critique, Image)
 * - Improved Vision API error handling with detailed diagnostics
 * - Global rate limiter initialization for consistent metrics
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
 * Rate Limiting (Prevents OpenAI 429 Errors):
 * - Uses sensible defaults (LLM: 3, ImageGen: 2, Vision: 3 concurrent)
 * - Configurable via environment variables:
 *   - BEAM_SEARCH_RATE_LIMIT_LLM (default: 3 concurrent)
 *   - BEAM_SEARCH_RATE_LIMIT_IMAGE_GEN (default: 2 concurrent)
 *   - BEAM_SEARCH_RATE_LIMIT_VISION (default: 3 concurrent)
 * - Monitor live metrics at: http://localhost:3000/api/demo/rate-limits/status
 * - Demo visualization: http://localhost:3000/demo
 *
 * Token Tracking (NEW - Fixed in this session):
 * - Accurately tracks tokens for all provider types:
 *   • LLM (GPT-4): Expansion, refinement, critique operations
 *   • Vision (GPT-4V): Image analysis and ranking
 *   • Critique: Ranking-based, LLM-based, and rule-based paths
 *   • Image Generation: DALL-E operations (counted separately)
 * - Standardized metadata field names (tokensUsed) across all paths
 * - Cost tracking shows real token attribution by provider
 *
 * Vision API Error Handling (IMPROVED in this session):
 * - Three-level response validation (structure, content, trimmed)
 * - Detailed error diagnostics include:
 *   • Model name (helps identify which model failed)
 *   • Finish reason (explains why: length, content_filter, stop, etc.)
 *   • Refusal status (indicates content policy violations)
 *   • Original content length (shows if response was truncated)
 * - Prevents null/undefined access errors
 * - Consistent with openai-llm-provider.js best practices
 *
 * Output Structure:
 * - Metadata and images saved to: output/YYYY-MM-DD/ses-HHMMSS/
 * - Uses OutputPathManager for consistent path construction
 * - Complete token usage and cost analysis included in metadata
 *
 * Usage:
 *   node demo-beam-search.js
 *
 * Requirements:
 *   - OPENAI_API_KEY environment variable set
 *   - Optional: npm start (in another terminal) to run API server for demo metrics
 */

require('dotenv').config();

const { beamSearch } = require('./src/orchestrator/beam-search.js');
const rateLimitConfig = require('./src/config/rate-limits.js');
const OpenAILLMProvider = require('./src/providers/openai-llm-provider.js');
const OpenAIImageProvider = require('./src/providers/openai-image-provider.js');
const OpenAIVisionProvider = require('./src/providers/openai-vision-provider.js');
const CritiqueGenerator = require('./src/services/critique-generator.js');
const ImageRanker = require('./src/services/image-ranker.js');
const MetadataTracker = require('./src/services/metadata-tracker.js');
const TokenTracker = require('./src/utils/token-tracker.js');
const DebugLogger = require('./src/utils/debug-logger.js');
const { MODEL_PRICING } = require('./src/config/model-pricing.js');
const { buildSessionPath, buildMetadataPath, DEFAULT_OUTPUT_DIR } = require('./src/utils/output-path-manager.js');

/**
 * Custom logging wrapper to track beam search progress with debug info
 */
class BeamSearchLogger {
  constructor(providers, options = {}) {
    this.originalProviders = providers;
    this.iterationCounts = { llm: 0, imageGen: 0, vision: 0, critique: 0 };
    this.currentIteration = -1;
    this.debugLogger = new DebugLogger({ debug: options.debug !== false }); // Debug enabled by default
  }

  wrapProviders() {
    const wrapped = {
      llm: this.wrapLLM(this.originalProviders.llm),
      imageGen: this.wrapImageGen(this.originalProviders.imageGen),
      vision: this.wrapVision(this.originalProviders.vision),
      critiqueGen: this.wrapCritique(this.originalProviders.critiqueGen)
    };
    // Add imageRanker if provided
    if (this.originalProviders.imageRanker) {
      wrapped.imageRanker = this.wrapImageRanker(this.originalProviders.imageRanker);
    }
    return wrapped;
  }

  wrapImageRanker(imageRanker) {
    // Track comparison stats for this ranking session
    let comparisonStats = { apiCalls: 0, transitivityInferred: 0, totalVotes: 0 };

    // Helper to format candidate ID for display
    const formatId = (img) => {
      // Global ID format: "i{iteration}c{candidateId}" e.g., "i0c1"
      if (typeof img.candidateId === 'string' && img.candidateId.startsWith('i')) {
        return img.candidateId; // Already formatted
      }
      // Fallback for simple numeric IDs
      return `c${img.candidateId}`;
    };

    // Wrap compareWithEnsemble to log individual comparisons
    const originalCompareWithEnsemble = imageRanker.compareWithEnsemble.bind(imageRanker);
    imageRanker.compareWithEnsemble = async (imgA, imgB, prompt, options) => {
      const ensembleSize = options.ensembleSize || imageRanker.defaultEnsembleSize || 1;
      comparisonStats.apiCalls++;
      comparisonStats.totalVotes += ensembleSize;

      const idA = formatId(imgA);
      const idB = formatId(imgB);
      console.log(`        🔄 Comparing: ${idA} vs ${idB} (${ensembleSize} vote${ensembleSize > 1 ? 's' : ''})...`);

      const result = await originalCompareWithEnsemble(imgA, imgB, prompt, options);

      // Log multi-factor ranks (1=better, 2=worse)
      const ranksA = result.aggregatedRanks?.A || {};
      const ranksB = result.aggregatedRanks?.B || {};
      console.log(`           • Ranks [${idA}]: align=${ranksA.alignment?.toFixed(2) || '?'} aesth=${ranksA.aesthetics?.toFixed(2) || '?'} combined=${ranksA.combined?.toFixed(2) || '?'}`);
      console.log(`           • Ranks [${idB}]: align=${ranksB.alignment?.toFixed(2) || '?'} aesth=${ranksB.aesthetics?.toFixed(2) || '?'} combined=${ranksB.combined?.toFixed(2) || '?'}`);

      // Log ensemble votes if applicable
      if (ensembleSize > 1) {
        console.log(`           • Votes: A=${result.votes.A}, B=${result.votes.B} → Winner: ${result.winner} (conf: ${(result.confidence * 100).toFixed(0)}%)`);
      } else {
        console.log(`           • Winner: ${result.winner} (lower combined rank wins)`);
      }

      return result;
    };

    // Wrap _findBestWithTransitivity to log transitivity inferences
    const originalFindBest = imageRanker._findBestWithTransitivity.bind(imageRanker);
    imageRanker._findBestWithTransitivity = async (candidates, prompt, graph, options) => {
      // Wrap canInferWinner to track transitivity usage
      const originalCanInfer = graph.canInferWinner.bind(graph);
      graph.canInferWinner = (idA, idB) => {
        const result = originalCanInfer(idA, idB);
        if (result) {
          comparisonStats.transitivityInferred++;
          const loserId = result.winner === idA ? idB : idA;
          console.log(`        ⚡ Transitivity: ${result.winner} > ${loserId} (skipped API call!)`);
        }
        return result;
      };

      return originalFindBest(candidates, prompt, graph, options);
    };

    return {
      rankImages: async (images, prompt, options) => {
        // Reset stats for each ranking call
        comparisonStats = { apiCalls: 0, transitivityInferred: 0, totalVotes: 0 };

        const ensembleSize = options.ensembleSize || imageRanker.defaultEnsembleSize || 1;
        const method = ensembleSize > 1 ? `ensemble(${ensembleSize} votes/pair)` : 'single-vote';
        console.log(`\n  🏅 Pairwise ranking: ${images.length} candidates, keepTop=${options.keepTop || images.length}, ${method}`);
        console.log('     • ID format: i{iter}c{candidate} (e.g., i0c1 = iteration 0, candidate 1)');
        console.log('     • Using transitive inference to minimize comparisons');
        console.log('     • Multi-factor scoring: alignment (70%) + aesthetics (30%)');

        try {
          const rankResult = await imageRanker.rankImages(images, prompt, options);

          // Handle new return format: { rankings, metadata }
          const rankings = Array.isArray(rankResult) ? rankResult : rankResult.rankings;

          // Summary stats
          console.log('\n     📊 Comparison stats:');
          console.log(`        • API comparisons: ${comparisonStats.apiCalls}`);
          console.log(`        • Total votes cast: ${comparisonStats.totalVotes}`);
          console.log(`        • Transitivity inferences: ${comparisonStats.transitivityInferred}`);
          if (comparisonStats.transitivityInferred > 0) {
            console.log(`        • API calls saved: ${comparisonStats.transitivityInferred} (via transitivity)`);
          }

          console.log(`\n     ✅ Ranking complete: ${rankings.length} candidates ranked`);
          rankings.forEach((r, i) => {
            const reason = r.reason || 'No reason provided';
            const truncatedReason = reason.length > 60 ? reason.substring(0, 60) + '...' : reason;
            const ranks = r.ranks
              ? ` [align=${r.ranks.alignment?.toFixed(2)}, aesth=${r.ranks.aesthetics?.toFixed(2)}, comb=${r.ranks.combined?.toFixed(2)}]`
              : '';
            console.log(`        ${i + 1}. Candidate ${r.candidateId}${ranks}: "${truncatedReason}"`);
          });
          return rankings;
        } catch (error) {
          console.error(`     ❌ Ranking failed: ${error.message}`);
          throw error;
        }
      }
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

        // Display debug info (model + tokens)
        if (result.metadata) {
          const debugInfo = this.debugLogger.logProviderCall({
            provider: 'llm',
            operation: options.operation || 'refine',
            metadata: result.metadata
          });
          if (debugInfo) {
            console.log(debugInfo);
          }
        }

        return result;
      },
      combinePrompts: async (what, how) => {
        const result = await llm.combinePrompts(what, how);

        // Display debug info for combine operation
        if (result.metadata) {
          const debugInfo = this.debugLogger.logProviderCall({
            provider: 'llm',
            operation: 'combine',
            metadata: result.metadata
          });
          if (debugInfo) {
            console.log(debugInfo);
          }
        }

        return result;
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

        // Display debug info (model, no tokens for DALL-E)
        if (result.metadata) {
          const debugInfo = this.debugLogger.logProviderCall({
            provider: 'image',
            operation: 'generate',
            metadata: result.metadata
          });
          if (debugInfo) {
            console.log(debugInfo);
          }
        }

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

        // Display debug info (model + tokens)
        if (result.metadata) {
          const debugInfo = this.debugLogger.logProviderCall({
            provider: 'vision',
            operation: 'analyze',
            metadata: result.metadata
          });
          if (debugInfo) {
            console.log(debugInfo);
          }
        }

        console.log(`     📊 Scores: alignment=${result.alignmentScore}/100, aesthetic=${result.aestheticScore}/10`);
        return result;
      }
    };
  }

  wrapCritique(critique) {
    const self = this;
    return {
      generateCritique: async (evaluation, prompts, userPrompt, options) => {
        const result = await critique.generateCritique(evaluation, prompts, userPrompt, options);

        // Display debug info for critique generation
        if (result.metadata) {
          const debugInfo = self.debugLogger.logProviderCall({
            provider: 'critique',
            operation: 'generate',
            metadata: result.metadata
          });
          if (debugInfo) {
            console.log(debugInfo);
          }
        }

        // Display the actual critique content for top candidates
        console.log(`\n  📝 Critique for refinement (${options.dimension?.toUpperCase() || 'unknown'} dimension):`);

        // Show key critique components (result has critique, recommendation, reason as strings)
        if (result.critique) {
          const truncatedCritique = result.critique.length > 120
            ? result.critique.substring(0, 120) + '...'
            : result.critique;
          console.log(`     ✗ Issue: ${truncatedCritique}`);
        }

        if (result.recommendation) {
          const truncatedRec = result.recommendation.length > 120
            ? result.recommendation.substring(0, 120) + '...'
            : result.recommendation;
          console.log(`     → Recommendation: ${truncatedRec}`);
        }

        if (result.reason) {
          const truncatedReason = result.reason.length > 100
            ? result.reason.substring(0, 100) + '...'
            : result.reason;
          console.log(`     💡 Reason: ${truncatedReason}`);
        }

        return result;
      }
    };
  }
}

async function demo() {
  // Ensemble configuration - use 3 for reliable ranking, 1 for speed
  const ensembleSize = parseInt(process.env.ENSEMBLE_SIZE || '3', 10);

  console.log('🚀 Beam Search Demo: Multi-Iteration Refinement');
  console.log('='.repeat(80));
  console.log('Configuration:');
  console.log('  • N = 4 (beam width: 4 candidates per iteration)');
  console.log('  • M = 2 (keep top: 2 best candidates survive)');
  console.log('  • Expansion ratio: 2 children per parent');
  console.log('  • Max iterations: 3 (iteration 0, 1, 2)');
  console.log(`  • Ensemble size: ${ensembleSize} (votes per comparison for reliability)`);
  console.log('  • Vision model: gpt-5-nano with Flex pricing ($0.025/1M tokens - 50% savings!)');
  console.log('');
  console.log('✨ Latest Innovations (just added):');
  console.log('  • Real-time rate limiting visualization API');
  console.log('  • Fixed token tracking bug (Vision & Critique now properly tracked)');
  console.log('  • Improved Vision API error diagnostics');
  console.log('  • Global rate limiter initialization for consistent metrics');
  console.log('');
  console.log('Streamlined Flow (unified pairwise ranking):');
  console.log('  1. Generate images (no per-image vision scoring)');
  console.log('  2. Ensemble pairwise ranking → multiple votes per pair for reliability');
  console.log('  3. Transitive inference → minimizes API calls (if A>B and B>C, skip A vs C)');
  console.log('  4. Critique uses ranking feedback → refines prompts');
  console.log('');
  console.log('Rate Limiting (prevents OpenAI 429 errors):');
  console.log(`  • LLM concurrency: ${rateLimitConfig.defaults.llm} requests`);
  console.log(`  • Image Gen concurrency: ${rateLimitConfig.defaults.imageGen} requests`);
  console.log(`  • Vision concurrency: ${rateLimitConfig.defaults.vision} requests`);
  console.log('  • Configure via: BEAM_SEARCH_RATE_LIMIT_* env vars');
  console.log('  • Ensemble size via: ENSEMBLE_SIZE env var (default: 3)');
  console.log('  • 📊 Monitor live metrics: http://localhost:3000/api/demo/rate-limits/status');
  console.log('');
  console.log('💰 Token Tracking (FIXED - Accurate provider attribution):');
  console.log('  • LLM: GPT-4 expansion, refinement, critique operations');
  console.log('  • Vision: GPT-4V image analysis and ranking comparisons');
  console.log('  • Critique: Ranking-based, LLM-based, and rule-based evaluation');
  console.log('  • Image Gen: DALL-E 3 generation (separate counter)');
  console.log('  • See token report at end for full cost breakdown');
  console.log('');
  console.log('💡 Cost Optimization with Flex Pricing:');
  console.log('  • Vision model uses OpenAI Flex tier pricing');
  console.log('  • 50% cost savings vs Standard pricing tier');
  console.log('  • Trade-off: Occasional 429 rate limits, handled with automatic retry');
  console.log('  • See docs/FLEX_PRICING_STRATEGY.md for complete strategy details');
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
  const userPrompt = 'a hyperreal photorealistic painting of the american west during sunset with a mysterious attractive woman subtly placed somewhere in the image. I want it to look like a photograph with subtle hints that it is a photoreal painting. i want to woman to be almost hidden but also intriguing, inviting, and attractive to the viewer. In fact, she should be gorgeous, please emphasize this. i want the american west to have a quality that is epic like the new frontier. Emphasize photorealism. Emphasize grandiousity.';

  // Initialize providers
  console.log('\n🔧 Initializing providers...');
  const providers = {
    llm: new OpenAILLMProvider(process.env.OPENAI_API_KEY),
    imageGen: new OpenAIImageProvider(process.env.OPENAI_API_KEY, { sessionId }),
    vision: new OpenAIVisionProvider(process.env.OPENAI_API_KEY),
    critiqueGen: new CritiqueGenerator({ apiKey: process.env.OPENAI_API_KEY }),
    imageRanker: new ImageRanker({
      apiKey: process.env.OPENAI_API_KEY,
      defaultEnsembleSize: ensembleSize
    })
  };
  console.log(`✅ All providers initialized (ImageRanker with ensembleSize=${ensembleSize})`);

  // Wrap providers with logging (includes imageRanker)
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
  console.log('🏆 FINAL COMPARISON: Top 2 Candidates');
  console.log('='.repeat(80));

  // Display both finalists side by side
  const finalists = winner.finalists || [winner];
  const displayFinalist = (candidate, position) => {
    const globalId = `i${candidate.metadata.iteration}c${candidate.metadata.candidateId}`;
    const label = position === 1 ? '🥇 WINNER' : '🥈 RUNNER-UP';
    const ranking = candidate.ranking || {};

    console.log(`\n${label} (${globalId}):`);

    // Show ranking scores
    if (ranking.ranks) {
      const r = ranking.ranks;
      console.log(`   📊 Scores: align=${r.alignment?.toFixed(2) || '?'} aesth=${r.aesthetics?.toFixed(2) || '?'} combined=${r.combined?.toFixed(2) || '?'}`);
    }

    // Show prompts (abbreviated)
    const whatAbbrev = candidate.whatPrompt.length > 60
      ? candidate.whatPrompt.substring(0, 60) + '...'
      : candidate.whatPrompt;
    const howAbbrev = candidate.howPrompt.length > 60
      ? candidate.howPrompt.substring(0, 60) + '...'
      : candidate.howPrompt;
    console.log(`   📝 WHAT: "${whatAbbrev}"`);
    console.log(`   🎨 HOW: "${howAbbrev}"`);

    // Show image path
    if (candidate.image?.localPath) {
      console.log(`   🖼️  Image: ${candidate.image.localPath}`);
    }

    // Show ranking reason
    if (ranking.reason) {
      const reasonAbbrev = ranking.reason.length > 100
        ? ranking.reason.substring(0, 100) + '...'
        : ranking.reason;
      console.log(`   💬 Ranking reason: ${reasonAbbrev}`);
    }
  };

  // Show both candidates
  finalists.slice(0, 2).forEach((candidate, idx) => {
    displayFinalist(candidate, idx + 1);
  });

  // Show why winner won (the comparison that decided it)
  console.log('\n' + '-'.repeat(80));
  console.log('⚖️  WHY WINNER WON:');
  console.log('-'.repeat(80));

  if (finalists.length >= 2) {
    const winnerRanking = winner.ranking || {};
    const runnerUp = finalists[1];
    const runnerRanking = runnerUp.ranking || {};

    // Compare scores
    if (winnerRanking.ranks && runnerRanking.ranks) {
      const wR = winnerRanking.ranks;
      const rR = runnerRanking.ranks;
      const alignDiff = (rR.alignment || 0) - (wR.alignment || 0);
      const aesthetDiff = (rR.aesthetics || 0) - (wR.aesthetics || 0);

      console.log('\n   📈 Score comparison (lower = better):');
      console.log(`      Winner combined:    ${wR.combined?.toFixed(2) || '?'}`);
      console.log(`      Runner-up combined: ${rR.combined?.toFixed(2) || '?'}`);

      if (alignDiff !== 0 || aesthetDiff !== 0) {
        const factors = [];
        if (alignDiff > 0) factors.push(`+${alignDiff.toFixed(2)} alignment`);
        if (alignDiff < 0) factors.push(`${alignDiff.toFixed(2)} alignment`);
        if (aesthetDiff > 0) factors.push(`+${aesthetDiff.toFixed(2)} aesthetics`);
        if (aesthetDiff < 0) factors.push(`${aesthetDiff.toFixed(2)} aesthetics`);
        console.log(`      Winner advantage: ${factors.join(', ')}`);
      }
    }

    // Show strengths comparison
    if (winnerRanking.strengths?.length > 0 || winnerRanking.winnerStrengths?.length > 0) {
      const strengths = winnerRanking.strengths || winnerRanking.winnerStrengths || [];
      console.log(`\n   ✅ Winner strengths: ${strengths.join(', ')}`);
    }

    if (runnerRanking.weaknesses?.length > 0 || runnerRanking.loserWeaknesses?.length > 0) {
      const weaknesses = runnerRanking.weaknesses || runnerRanking.loserWeaknesses || [];
      console.log(`   ⚠️  Runner-up weaknesses: ${weaknesses.join(', ')}`);
    }

    // Show the decisive comparison reason if available
    if (winnerRanking.reason) {
      console.log(`\n   💡 Decision: ${winnerRanking.reason}`);
    }
  } else {
    console.log('   Only one finalist - no comparison available');
  }

  console.log('\n' + '='.repeat(80));
  console.log('📋 WINNER DETAILS');
  console.log('='.repeat(80));

  // Display scores (legacy fallback when not using ranking)
  if (winner.evaluation && winner.totalScore !== null) {
    console.log('\n📊 Scores (legacy mode):');
    console.log(`   • Total Score: ${winner.totalScore.toFixed(2)}/100`);
    console.log(`   • Alignment Score: ${winner.evaluation.alignmentScore}/100 (content match)`);
    console.log(`   • Aesthetic Score: ${winner.evaluation.aestheticScore}/10 (visual quality)`);
  }

  console.log('\n🔍 Metadata:');
  const globalId = `i${winner.metadata.iteration}c${winner.metadata.candidateId}`;
  console.log(`   • Global ID: ${globalId} (iteration ${winner.metadata.iteration}, candidate ${winner.metadata.candidateId})`);
  if (winner.metadata.parentId !== undefined && winner.metadata.parentId !== null) {
    console.log(`   • Parent: i${winner.metadata.iteration - 1}c${winner.metadata.parentId}`);
  }
  console.log(`   • Last Refined Dimension: ${winner.metadata.dimension}`);

  console.log('\n📝 Prompts:');
  console.log(`   • WHAT (content): "${winner.whatPrompt.substring(0, 80)}..."`);
  console.log(`   • HOW (style): "${winner.howPrompt.substring(0, 80)}..."`);
  console.log(`   • Combined: "${winner.combined.substring(0, 80)}..."`);

  console.log('\n🖼️  Image:');
  // Check if URL is a data URL (base64 encoded) to avoid printing raw base64
  if (winner.image.url.startsWith('data:image/')) {
    console.log('   • URL: <base64 data URL - see local file>');
  } else {
    console.log(`   • URL: ${winner.image.url}`);
  }
  if (winner.image.localPath) {
    console.log(`   • Local: ${winner.image.localPath}`);
  }

  // Display evaluation info (available when using vision analysis)
  // or ranking details (when using comparative ranking)
  if (winner.evaluation) {
    console.log('\n📈 Evaluation:');
    console.log(`   • Analysis: ${winner.evaluation.analysis}`);
    if (winner.evaluation.strengths?.length > 0) {
      console.log(`   • Strengths: ${winner.evaluation.strengths.join(', ')}`);
    }
    if (winner.evaluation.weaknesses?.length > 0) {
      console.log(`   • Weaknesses: ${winner.evaluation.weaknesses.join(', ')}`);
    }
  } else if (winner.ranking) {
    // Show ranking details when no evaluation (comparative ranking mode)
    console.log('\n📈 Ranking Details:');
    if (winner.ranking.ranks) {
      const r = winner.ranking.ranks;
      console.log(`   • Alignment rank: ${r.alignment?.toFixed(2) || '?'} (1=best)`);
      console.log(`   • Aesthetics rank: ${r.aesthetics?.toFixed(2) || '?'} (1=best)`);
      console.log(`   • Combined score: ${r.combined?.toFixed(2) || '?'} (lower=better)`);
    }
    if (winner.ranking.winnerStrengths?.length > 0) {
      console.log(`   • Strengths: ${winner.ranking.winnerStrengths.join(', ')}`);
    }
    if (winner.ranking.loserWeaknesses?.length > 0) {
      console.log(`   • Competitors weak on: ${winner.ranking.loserWeaknesses.join(', ')}`);
    }
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

  console.log(tokenTracker.formatSummary());

  // Display optimization suggestions
  console.log(tokenTracker.formatOptimizationReport());

  console.log('\n' + '='.repeat(80));
  console.log('✅ Beam search completed successfully!');
  console.log('\n💡 Key Observations:');
  console.log('   • Iteration 0: Generated 4 diverse candidates, kept top 2');
  console.log('   • Iteration 1: Refined WHAT (content), kept top 2');
  console.log('   • Iteration 2: Refined HOW (style), kept top 2');
  console.log('   • Unified pairwise ranking: Same algorithm for any N images');
  console.log(`   • Ensemble voting (${ensembleSize} votes/pair): Reduces ranking variance`);
  console.log('   • Transitive inference: Minimizes API calls (if A>B>C, skip A vs C)');
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
