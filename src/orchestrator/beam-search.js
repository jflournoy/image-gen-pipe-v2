/**
 * TDD GREEN Phase: Beam Search Orchestrator
 *
 * Implements streaming parallel beam search for image generation.
 * Reference: docs/streaming-parallel-architecture.md
 */

const { RateLimiter } = require('../utils/rate-limiter.js');
const rateLimitConfig = require('../config/rate-limits.js');
const { registerLimiter } = require('../utils/rate-limiter-registry.js');

// Initialize rate limiters at module load time
// This ensures metrics are always available via the API, even before jobs start
const llmLimiter = new RateLimiter(rateLimitConfig.getLimit('llm'));
const imageGenLimiter = new RateLimiter(rateLimitConfig.getLimit('imageGen'));
const visionLimiter = new RateLimiter(rateLimitConfig.getLimit('vision'));

// Register limiters globally for API endpoint access
registerLimiter('llm', llmLimiter);
registerLimiter('imageGen', imageGenLimiter);
registerLimiter('vision', visionLimiter);

/**
 * Rank candidates by total score and select top M
 * @param {Array<Object>} candidates - Candidates with totalScore property
 * @param {number} keepTop - Number of top candidates to keep
 * @returns {Array<Object>} Top M candidates sorted by score (descending)
 */
function rankAndSelect(candidates, keepTop) {
  // Create a copy to avoid mutating original array
  const sorted = [...candidates].sort((a, b) => b.totalScore - a.totalScore);

  // Return top M candidates (or all if keepTop > candidate count)
  return sorted.slice(0, keepTop);
}

/**
 * Rank candidates using comparative evaluation (preferred over absolute scoring)
 * Uses ImageRanker to compare candidates relatively instead of scoring absolutely
 * @param {Array<Object>} candidates - Candidates with image URLs
 * @param {number} keepTop - Number of top candidates to keep
 * @param {Object} imageRanker - ImageRanker instance for comparative evaluation
 * @param {string} userPrompt - Original user prompt for comparison context
 * @param {Object} options - Options
 * @param {Array<Object>} [options.previousTopCandidates] - Previous iteration's top candidates (already ranked)
 * @returns {Promise<Array<Object>>} Top M candidates sorted by rank with ranking reasons
 */
async function rankAndSelectComparative(candidates, keepTop, imageRanker, userPrompt, options = {}) {
  const { previousTopCandidates = [] } = options;

  // Build image list for ranking with globally unique IDs
  // Format: "i{iteration}c{candidateId}" e.g., "i0c1" for iteration 0, candidate 1
  const images = candidates.map(candidate => ({
    candidateId: `i${candidate.metadata.iteration}c${candidate.metadata.candidateId}`,
    iteration: candidate.metadata.iteration,
    localId: candidate.metadata.candidateId,
    url: candidate.image.url
  }));

  // Build known comparisons from previous top candidates' rankings
  // If we have parents with rank 1 and rank 2, we know rank 1 > rank 2
  const knownComparisons = [];
  if (previousTopCandidates.length >= 2) {
    // Sort by ranking to get ordered pairs
    const sorted = [...previousTopCandidates].sort((a, b) =>
      (a.ranking?.rank || Infinity) - (b.ranking?.rank || Infinity)
    );

    // For each pair where rank(i) < rank(j), record i > j
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const winnerId = `i${sorted[i].metadata.iteration}c${sorted[i].metadata.candidateId}`;
        const loserId = `i${sorted[j].metadata.iteration}c${sorted[j].metadata.candidateId}`;
        knownComparisons.push({ winnerId, loserId });
      }
    }
  }

  // Get comparative rankings from ImageRanker with keepTop optimization
  // Pass known comparisons to avoid re-comparing parents from same iteration
  const { ensembleSize, tokenTracker } = options;
  const rankResult = await imageRanker.rankImages(images, userPrompt, { keepTop, knownComparisons, ensembleSize });

  // Handle both old format (array) and new format (object with metadata)
  const rankings = Array.isArray(rankResult) ? rankResult : rankResult.rankings;
  const rankingMetadata = !Array.isArray(rankResult) ? rankResult.metadata : {};

  // Record vision tokens if tokenTracker is provided
  if (tokenTracker && rankingMetadata.tokensUsed) {
    tokenTracker.recordUsage({
      provider: 'vision',
      operation: 'rank',
      tokens: rankingMetadata.tokensUsed
    });
  }

  // Create lookup map: globalId → ranking data
  const rankingMap = new Map(
    rankings.map(r => [r.candidateId, r])
  );

  // Attach ranking data to candidates using global ID
  const rankedCandidates = candidates.map(candidate => {
    const globalId = `i${candidate.metadata.iteration}c${candidate.metadata.candidateId}`;
    return {
      ...candidate,
      ranking: rankingMap.get(globalId)
    };
  });

  // Filter out candidates without rankings (happens when keepTop < N)
  // Then sort by rank (1 = best) and return top M
  const candidatesWithRankings = rankedCandidates.filter(c => c.ranking !== undefined);
  candidatesWithRankings.sort((a, b) => a.ranking.rank - b.ranking.rank);

  return candidatesWithRankings.slice(0, keepTop);
}

/**
 * Calculate total score from alignment and aesthetic scores
 * @param {number} alignmentScore - Alignment score (0-100)
 * @param {number} aestheticScore - Aesthetic score (0-10)
 * @param {number} alpha - Weight for alignment (default 0.7). Range 0-1.
 * @returns {number} Total score (0-100)
 */
function calculateTotalScore(alignmentScore, aestheticScore, alpha = 0.7) {
  // Normalize aesthetic score from 0-10 scale to 0-100 scale
  const normalizedAesthetic = aestheticScore * 10;

  // Weighted combination: alpha * alignment + (1-alpha) * aesthetic
  const totalScore = alpha * alignmentScore + (1 - alpha) * normalizedAesthetic;

  return totalScore;
}

/**
 * Process a single candidate through the streaming pipeline
 * @param {string} whatPrompt - Content prompt
 * @param {string} howPrompt - Style prompt
 * @param {Object} llmProvider - LLM provider instance
 * @param {Object} imageGenProvider - Image generation provider instance
 * @param {Object} visionProvider - Vision provider instance
 * @param {Object} options - Processing options
 * @param {number} options.iteration - Current iteration number
 * @param {number} options.candidateId - Candidate identifier
 * @param {string} options.dimension - 'what' or 'how'
 * @param {number} [options.alpha=0.7] - Scoring weight for alignment
 * @param {number} [options.parentId] - Parent candidate ID (for tracking lineage)
 * @param {string} [options.size] - Image size
 * @param {string} [options.quality] - Image quality
 * @returns {Promise<Object>} Candidate with all processing results
 */
async function processCandidateStream(
  whatPrompt,
  howPrompt,
  llmProvider,
  imageGenProvider,
  visionProvider,
  options = {}
) {
  const { metadataTracker, tokenTracker, iteration, candidateId, dimension, parentId } = options;

  // Stage 1: Combine prompts
  const combineResult = await llmProvider.combinePrompts(whatPrompt, howPrompt);
  const combined = combineResult.combinedPrompt;

  // Track combine operation tokens using actual metadata
  if (tokenTracker && combineResult.metadata) {
    tokenTracker.recordUsage({
      provider: 'llm',
      operation: 'combine',
      tokens: combineResult.metadata.tokensUsed,
      metadata: {
        model: combineResult.metadata.model,
        iteration,
        candidateId,
        operation: 'combine'
      }
    });
  }

  // DEFENSIVE PATTERN: Record attempt BEFORE risky API calls
  // This ensures we save prompts even if image generation fails
  if (metadataTracker) {
    await metadataTracker.recordAttempt({
      whatPrompt,
      howPrompt,
      metadata: {
        iteration,
        candidateId,
        dimension,
        parentId
      }
    });
  }

  // Stage 2: Generate image (starts as soon as combine finishes)
  const image = await imageGenProvider.generateImage(combined, options);

  // Track image generation
  if (tokenTracker && image.metadata) {
    tokenTracker.recordUsage({
      provider: 'image',
      operation: 'generate',
      tokens: 1, // Image gen doesn't use tokens, count as 1 generation
      metadata: {
        model: image.metadata.model,
        size: image.metadata.size,
        quality: image.metadata.quality,
        iteration: options.iteration,
        candidateId: options.candidateId,
        operation: 'generate'
      }
    });
  }

  // Stage 3: Evaluate image (skip if using comparative ranking)
  // When skipVisionAnalysis is true, ranking step will provide feedback
  let evaluation = null;
  let totalScore = null;

  if (!options.skipVisionAnalysis && visionProvider) {
    evaluation = await visionProvider.analyzeImage(image.url, combined);

    // Track vision tokens
    if (tokenTracker && evaluation.metadata?.tokensUsed) {
      tokenTracker.recordUsage({
        provider: 'vision',
        operation: 'analyze',
        tokens: evaluation.metadata.tokensUsed,
        metadata: {
          model: evaluation.metadata.model,
          iteration,
          candidateId,
          operation: 'analyze'
        }
      });
    }

    // Calculate total score
    const alpha = options.alpha !== undefined ? options.alpha : 0.7;
    totalScore = calculateTotalScore(
      evaluation.alignmentScore,
      evaluation.aestheticScore,
      alpha
    );
  }

  // DEFENSIVE PATTERN: Update attempt with results AFTER success
  // This adds image/evaluation data to the defensive metadata
  if (metadataTracker) {
    await metadataTracker.updateAttemptWithResults(iteration, candidateId, {
      combined,
      image,
      evaluation,
      totalScore
    });
  }

  // Return complete candidate object
  return {
    whatPrompt,
    howPrompt,
    combined,
    image,
    evaluation,
    totalScore,
    metadata: {
      iteration: options.iteration,
      candidateId: options.candidateId,
      dimension: options.dimension,
      parentId: options.parentId
    }
  };
}

/**
 * Initial expansion (Iteration 0) - Generate N WHAT+HOW pairs with variation
 * @param {string} userPrompt - Initial user prompt
 * @param {Object} llmProvider - LLM provider instance
 * @param {Object} imageGenProvider - Image generation provider instance
 * @param {Object} visionProvider - Vision provider instance
 * @param {Object} config - Configuration
 * @param {number} config.beamWidth - Number of candidates to generate (N)
 * @param {number} [config.temperature=0.7] - Temperature for stochastic variation
 * @param {number} [config.alpha=0.7] - Scoring weight for alignment
 * @returns {Promise<Array>} Array of N candidates
 */
async function initialExpansion(
  userPrompt,
  llmProvider,
  imageGenProvider,
  visionProvider,
  config
) {
  const { beamWidth: N, temperature = 0.7, alpha = 0.7, rateLimitConcurrency, metadataTracker, tokenTracker } = config;

  // Rate limiters are initialized at module load time
  // They are reused across all jobs to maintain consistent metrics

  // Generate N WHAT+HOW pairs in parallel with stochastic variation and rate limiting
  const whatHowPairs = await Promise.all(
    Array(N).fill().map(async (_, i) => {
      // Generate WHAT and HOW in parallel for each candidate with rate limiting
      const [what, how] = await Promise.all([
        llmLimiter.execute(() => llmProvider.refinePrompt(userPrompt, {
          dimension: 'what',
          operation: 'expand',
          temperature
        })),
        llmLimiter.execute(() => llmProvider.refinePrompt(userPrompt, {
          dimension: 'how',
          operation: 'expand',
          temperature
        }))
      ]);

      // Track tokens for WHAT expansion
      if (tokenTracker && what.metadata?.tokensUsed) {
        tokenTracker.recordUsage({
          provider: 'llm',
          operation: 'expand',
          tokens: what.metadata.tokensUsed,
          metadata: {
            model: what.metadata.model,
            iteration: 0,
            candidateId: i,
            dimension: 'what',
            operation: 'expand'
          }
        });
      }

      // Track tokens for HOW expansion
      if (tokenTracker && how.metadata?.tokensUsed) {
        tokenTracker.recordUsage({
          provider: 'llm',
          operation: 'expand',
          tokens: how.metadata.tokensUsed,
          metadata: {
            model: how.metadata.model,
            iteration: 0,
            candidateId: i,
            dimension: 'how',
            operation: 'expand'
          }
        });
      }

      return {
        what: what.refinedPrompt,
        how: how.refinedPrompt
      };
    })
  );

  // Stream all N candidates through the pipeline with rate limiting
  const candidates = await Promise.all(
    whatHowPairs.map(({ what, how }, i) => {
      // Create wrapper that applies rate limiting for image gen and vision
      const limitedProcessCandidateStream = async () => {
        // Combine prompts (no rate limiting needed)
        const combineResult = await llmProvider.combinePrompts(what, how);
        const combined = combineResult.combinedPrompt;

        // Track combine operation tokens using actual metadata
        if (tokenTracker && combineResult.metadata) {
          tokenTracker.recordUsage({
            provider: 'llm',
            operation: 'combine',
            tokens: combineResult.metadata.tokensUsed,
            metadata: {
              model: combineResult.metadata.model,
              iteration: 0,
              candidateId: i,
              operation: 'combine'
            }
          });
        }

        // DEFENSIVE PATTERN: Record attempt BEFORE risky API calls
        if (metadataTracker) {
          await metadataTracker.recordAttempt({
            whatPrompt: what,
            howPrompt: how,
            metadata: {
              iteration: 0,
              candidateId: i,
              dimension: 'what',
              parentId: null
            }
          });
        }

        // Generate image with rate limiting
        const image = await imageGenLimiter.execute(() =>
          imageGenProvider.generateImage(combined, {
            iteration: 0,
            candidateId: i,
            dimension: 'what',
            alpha
          })
        );

        // Track image generation
        if (tokenTracker && image.metadata) {
          tokenTracker.recordUsage({
            provider: 'image',
            operation: 'generate',
            tokens: 1, // Image gen doesn't use tokens, count as 1 generation
            metadata: {
              model: image.metadata.model,
              size: image.metadata.size,
              quality: image.metadata.quality,
              iteration: 0,
              candidateId: i,
              dimension: 'what',
              operation: 'generate'
            }
          });
        }

        // Evaluate image with rate limiting (skip if using comparative ranking)
        let evaluation = null;
        let totalScore = null;

        if (!config.skipVisionAnalysis && visionProvider) {
          evaluation = await visionLimiter.execute(() =>
            visionProvider.analyzeImage(image.url, combined)
          );

          // Track vision tokens
          if (tokenTracker && evaluation.metadata?.tokensUsed) {
            tokenTracker.recordUsage({
              provider: 'vision',
              operation: 'analyze',
              tokens: evaluation.metadata.tokensUsed,
              metadata: {
                model: evaluation.metadata.model,
                iteration: 0,
                candidateId: i,
                operation: 'analyze'
              }
            });
          }

          // Calculate total score
          totalScore = calculateTotalScore(
            evaluation.alignmentScore,
            evaluation.aestheticScore,
            alpha
          );
        }

        // DEFENSIVE PATTERN: Update attempt with results AFTER success
        if (metadataTracker) {
          await metadataTracker.updateAttemptWithResults(0, i, {
            combined,
            image,
            evaluation,
            totalScore
          });
        }

        // Return complete candidate object
        return {
          whatPrompt: what,
          howPrompt: how,
          combined,
          image,
          evaluation,
          totalScore,
          metadata: {
            iteration: 0,
            candidateId: i,
            dimension: 'what'
          }
        };
      };

      return limitedProcessCandidateStream();
    })
  );

  return candidates;
}

/**
 * Refinement iteration (Iteration 1+) - Generate children from top parents
 * @param {Array} parents - Top M parent candidates from previous iteration
 * @param {Object} llmProvider - LLM provider instance
 * @param {Object} imageGenProvider - Image generation provider instance
 * @param {Object} visionProvider - Vision provider instance
 * @param {Object} critiqueGenProvider - Critique generator instance
 * @param {Object} config - Configuration
 * @param {number} config.beamWidth - Total candidates to generate (N)
 * @param {number} config.keepTop - Number of parents (M)
 * @param {number} [config.alpha=0.7] - Scoring weight for alignment
 * @param {number} iteration - Current iteration number
 * @returns {Promise<Array>} Array of N child candidates
 */
async function refinementIteration(
  parents,
  llmProvider,
  imageGenProvider,
  visionProvider,
  critiqueGenProvider,
  config,
  iteration
) {
  const { beamWidth: N, keepTop: M, alpha = 0.7, metadataTracker, tokenTracker, skipVisionAnalysis } = config;
  const expansionRatio = Math.floor(N / M);

  // Determine dimension: odd iterations refine WHAT, even refine HOW
  const dimension = iteration % 2 === 1 ? 'what' : 'how';

  // Generate M critiques in parallel (one per parent)
  const parentsWithCritiques = await Promise.all(
    parents.map(async (parent) => {
      // Use ranking feedback if available (new flow), otherwise use evaluation (legacy)
      const feedback = parent.ranking || parent.evaluation;

      const critique = await critiqueGenProvider.generateCritique(
        feedback,
        {
          what: parent.whatPrompt,
          how: parent.howPrompt,
          combined: parent.combined
        },
        {
          dimension,
          iteration
        }
      );

      // Track critique tokens
      if (tokenTracker && critique.metadata?.tokensUsed) {
        tokenTracker.recordUsage({
          provider: 'critique',
          operation: 'generate',
          tokens: critique.metadata.tokensUsed,
          metadata: {
            model: critique.metadata.model,
            iteration,
            candidateId: parent.metadata.candidateId,
            dimension,
            operation: 'generate'
          }
        });
      }

      return { ...parent, critique };
    })
  );

  // Generate N total children (each parent generates expansionRatio children)
  const allChildren = await Promise.all(
    parentsWithCritiques.flatMap((parent, parentIdx) =>
      Array(expansionRatio).fill().map(async (_, childIdx) => {
        const candidateId = parentIdx * expansionRatio + childIdx;

        // Refine the selected dimension using critique
        const refinedResult = await llmProvider.refinePrompt(
          dimension === 'what' ? parent.whatPrompt : parent.howPrompt,
          {
            operation: 'refine',
            dimension,
            critique: parent.critique
          }
        );

        // Track refine tokens
        if (tokenTracker && refinedResult.metadata?.tokensUsed) {
          tokenTracker.recordUsage({
            provider: 'llm',
            operation: 'refine',
            tokens: refinedResult.metadata.tokensUsed,
            metadata: {
              model: refinedResult.metadata.model,
              iteration,
              candidateId,
              dimension,
              operation: 'refine'
            }
          });
        }

        // Construct new prompts: refine selected dimension, inherit other
        const whatPrompt = dimension === 'what'
          ? refinedResult.refinedPrompt
          : parent.whatPrompt;
        const howPrompt = dimension === 'how'
          ? refinedResult.refinedPrompt
          : parent.howPrompt;

        // Stream child through pipeline
        return processCandidateStream(
          whatPrompt,
          howPrompt,
          llmProvider,
          imageGenProvider,
          visionProvider,
          {
            iteration,
            candidateId,
            dimension,
            parentId: parent.metadata.candidateId,
            alpha,
            metadataTracker,
            tokenTracker,
            skipVisionAnalysis
          }
        );
      })
    )
  );

  return allChildren;
}

/**
 * Main beam search orchestrator
 * @param {string} userPrompt - Initial user prompt
 * @param {Object} providers - Provider instances
 * @param {Object} providers.llm - LLM provider instance
 * @param {Object} providers.imageGen - Image generation provider instance
 * @param {Object} providers.vision - Vision provider instance
 * @param {Object} providers.critiqueGen - Critique generator instance
 * @param {Object} config - Configuration
 * @param {number} config.beamWidth - Number of candidates per iteration (N)
 * @param {number} config.keepTop - Number of top candidates to keep (M)
 * @param {number} config.maxIterations - Maximum number of iterations to run
 * @param {number} [config.alpha=0.7] - Scoring weight for alignment
 * @param {number} [config.temperature=0.7] - Temperature for stochastic variation
 * @param {Object} [config.metadataTracker] - Optional metadata tracker instance
 * @param {Function} [config.onIterationComplete] - Optional callback after each iteration
 * @param {Function} [config.onCandidateProcessed] - Optional callback for each candidate
 * @returns {Promise<Object>} Best candidate after all iterations
 */
async function beamSearch(userPrompt, providers, config) {
  const { llm, imageGen, vision, critiqueGen, imageRanker } = providers;
  const { maxIterations, keepTop, metadataTracker, tokenTracker, onIterationComplete, onCandidateProcessed, ensembleSize } = config;

  // Determine ranking strategy: Use comparative ranking if imageRanker provided
  const useComparativeRanking = imageRanker !== undefined;

  // Build config with skipVisionAnalysis when using ranking
  const pipelineConfig = {
    ...config,
    skipVisionAnalysis: useComparativeRanking
  };

  // Iteration 0: Initial expansion
  let candidates = await initialExpansion(
    userPrompt,
    llm,
    imageGen,
    vision,
    pipelineConfig
  );

  // Notify about processed candidates (optional callback)
  if (onCandidateProcessed) {
    candidates.forEach(candidate => onCandidateProcessed(candidate));
  }

  // Rank and select top M candidates
  // Use comparative ranking if imageRanker provided, otherwise use score-based ranking
  let topCandidates;
  if (useComparativeRanking) {
    topCandidates = await rankAndSelectComparative(candidates, keepTop, imageRanker, userPrompt, { ensembleSize, tokenTracker });
  } else {
    topCandidates = rankAndSelect(candidates, keepTop);
  }

  // Update survived status for iteration 0 candidates if tracker provided
  if (metadataTracker) {
    await Promise.all(candidates.map(candidate =>
      metadataTracker.updateAttemptWithResults(
        candidate.metadata.iteration,
        candidate.metadata.candidateId,
        {
          combined: candidate.combined,
          image: candidate.image,
          evaluation: candidate.evaluation,
          totalScore: candidate.totalScore
        },
        {
          survived: topCandidates.includes(candidate)
        }
      )
    ));
  }

  // Notify iteration complete (optional callback)
  if (onIterationComplete) {
    onIterationComplete({
      iteration: 0,
      candidates,
      topCandidates
    });
  }

  // Iterations 1+: Refinement
  for (let iteration = 1; iteration < maxIterations; iteration++) {
    // Generate N children from M parents
    candidates = await refinementIteration(
      topCandidates,
      llm,
      imageGen,
      vision,
      critiqueGen,
      pipelineConfig,
      iteration
    );

    // Notify about processed candidates (optional callback)
    if (onCandidateProcessed) {
      candidates.forEach(candidate => onCandidateProcessed(candidate));
    }

    // Rank and select top M for next iteration
    // Include both parents and children to ensure best from ANY iteration survives
    const allCandidates = [...topCandidates, ...candidates];

    // Use comparative ranking if imageRanker provided, otherwise use score-based ranking
    if (useComparativeRanking) {
      // Pass previous top candidates to avoid re-comparing known pairs
      const previousTop = topCandidates;
      topCandidates = await rankAndSelectComparative(allCandidates, keepTop, imageRanker, userPrompt, { previousTopCandidates: previousTop, ensembleSize, tokenTracker });
    } else {
      topCandidates = rankAndSelect(allCandidates, keepTop);
    }

    // Update survived status for iteration candidates if tracker provided
    if (metadataTracker) {
      await Promise.all(candidates.map(candidate =>
        metadataTracker.updateAttemptWithResults(
          candidate.metadata.iteration,
          candidate.metadata.candidateId,
          {
            combined: candidate.combined,
            image: candidate.image,
            evaluation: candidate.evaluation,
            totalScore: candidate.totalScore
          },
          {
            survived: topCandidates.includes(candidate)
          }
        )
      ));
    }

    // Notify iteration complete (optional callback)
    if (onIterationComplete) {
      onIterationComplete({
        iteration,
        candidates,
        topCandidates
      });
    }
  }

  // Mark final winner if tracker provided
  const winner = topCandidates[0];
  if (metadataTracker) {
    await metadataTracker.markFinalWinner({
      iteration: winner.metadata.iteration,
      candidateId: winner.metadata.candidateId,
      totalScore: winner.totalScore
    });
  }

  // Return best candidate with all finalists for comparison display
  // Attach finalists to winner for backward compatibility
  winner.finalists = topCandidates;
  return winner;
}

module.exports = {
  rankAndSelect,
  rankAndSelectComparative,
  calculateTotalScore,
  processCandidateStream,
  initialExpansion,
  refinementIteration,
  beamSearch
};
