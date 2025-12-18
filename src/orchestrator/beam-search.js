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
 * Check if an error is a safety violation
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is a safety violation
 */
function isSafetyViolation(error) {
  const message = error.message || '';
  return message.includes('safety') ||
         message.includes('safety_violations') ||
         message.includes('content policy') ||
         message.includes('rejected');
}

/**
 * Generate image with automatic safety violation retry
 * If the prompt triggers a safety violation, uses LLM to rephrase and retries once
 * @param {string} prompt - The combined prompt to generate an image from
 * @param {Object} imageGenProvider - Image generation provider instance
 * @param {Object} llmProvider - LLM provider for rephrasing on safety violations
 * @param {Object} options - Generation options
 * @param {Function} [options.onStepProgress] - Progress callback for status updates
 * @param {string} [options.candidateId] - Candidate ID for logging
 * @returns {Promise<Object>} Generated image result
 */
async function generateImageWithSafetyRetry(prompt, imageGenProvider, llmProvider, options = {}) {
  const { onStepProgress, candidateIdStr, ...genOptions } = options;
  // Use candidateIdStr for logging/progress messages, keep numeric candidateId in genOptions for image saving

  try {
    // First attempt - generate with original prompt
    return await imageGenLimiter.execute(() =>
      imageGenProvider.generateImage(prompt, genOptions)
    );
  } catch (error) {
    // Check if this is a safety violation
    if (!isSafetyViolation(error)) {
      // Not a safety error, re-throw
      throw error;
    }

    // Emit progress: safety violation detected, attempting rephrase
    if (onStepProgress) {
      onStepProgress({
        stage: 'safety',
        status: 'rephrasing',
        candidateId: candidateIdStr,
        message: `⚠️ ${candidateIdStr}: Safety violation - rephrasing prompt...`
      });
    }

    console.log(`[SafetyRetry] ${candidateIdStr}: Safety violation detected, attempting rephrase. Error: ${error.message}`);

    // Extract specific violation type from error message if available
    // e.g., "safety_violations=[sexual]" -> "sexual"
    const violationMatch = error.message.match(/safety_violations=\[([^\]]+)\]/);
    const violationType = violationMatch ? violationMatch[1] : 'content policy';

    // Use LLM to rephrase the prompt to be safer
    const rephraseSystemPrompt = `You are a prompt safety expert. The following image generation prompt was flagged by a content safety system.
Your task is to rephrase it to be appropriate while preserving the user's original artistic intent.

IMPORTANT:
- Keep the core visual concept and composition
- Remove or replace any potentially problematic elements
- Maintain the artistic style and mood where possible
- Return ONLY the rephrased prompt, nothing else`;

    const rephraseUserPrompt = `Original prompt (flagged for safety): "${prompt}"

Safety system error: ${error.message}
Violation type: ${violationType}

Rephrase this to avoid the "${violationType}" violation while keeping the artistic intent:`;

    try {
      const rephraseResult = await llmLimiter.execute(() =>
        llmProvider.generateText(rephraseUserPrompt, {
          systemPrompt: rephraseSystemPrompt,
          maxTokens: 500,
          temperature: 0.7
        })
      );

      const rephrasedPrompt = rephraseResult.trim();
      console.log(`[SafetyRetry] ${candidateIdStr}: Rephrased prompt: "${rephrasedPrompt.substring(0, 100)}..."`);

      // Emit progress: retrying with rephrased prompt
      if (onStepProgress) {
        onStepProgress({
          stage: 'safety',
          status: 'retrying',
          candidateId: candidateIdStr,
          message: `🔄 ${candidateIdStr}: Retrying with rephrased prompt...`
        });
      }

      // Second attempt - generate with rephrased prompt
      const result = await imageGenLimiter.execute(() =>
        imageGenProvider.generateImage(rephrasedPrompt, genOptions)
      );

      // Emit progress: safety retry succeeded
      if (onStepProgress) {
        onStepProgress({
          stage: 'safety',
          status: 'success',
          candidateId: candidateIdStr,
          message: `✓ ${candidateIdStr}: Safety retry succeeded`
        });
      }

      // Mark that this image used a rephrased prompt
      result.metadata = result.metadata || {};
      result.metadata.safetyRephrased = true;
      result.metadata.originalPrompt = prompt;
      result.metadata.rephrasedPrompt = rephrasedPrompt;

      return result;
    } catch (rephraseError) {
      // LLM rephrasing failed - likely the LLM also refused to engage with the content
      console.error(`[SafetyRetry] ${candidateIdStr}: LLM rephrase failed: ${rephraseError.message}`);

      // Determine if this was an LLM refusal vs other error
      const isLLMRefusal = rephraseError.message.includes('refused') ||
                          rephraseError.message.includes('empty content');

      const failureReason = isLLMRefusal
        ? 'Content too problematic to rephrase'
        : rephraseError.message;

      if (onStepProgress) {
        onStepProgress({
          stage: 'safety',
          status: 'failed',
          candidateId: candidateIdStr,
          message: `✗ ${candidateIdStr}: ${failureReason}`
        });
      }

      // Throw original error so caller knows what triggered the issue
      throw error;
    }
  }
}

/**
 * Compute global ranks across all iterations
 *
 * Rules:
 * 1. Iteration 0: All candidates get sequential global ranks (1 to N)
 * 2. Iteration 1+:
 *    - Children that rank above ALL parents: get sequential global ranks
 *    - Parents: maintain their relative order, shifted by children above them
 *    - Children that rank below ANY parent: tied at floor rank (worst from iteration 0)
 *
 * @param {Array<Object>} rankedCandidates - Candidates sorted by within-iteration rank
 * @param {Array<Object>} parents - Previous top candidates (parents for this iteration)
 * @param {number} floorRank - The worst rank from iteration 0 (N for beamWidth N)
 * @param {number} iteration - Current iteration number
 * @returns {Array<Object>} Candidates with globalRank assigned
 */
function computeGlobalRanks(rankedCandidates, parents, floorRank, iteration) {
  if (iteration === 0) {
    // Iteration 0: Sequential global ranks for all
    return rankedCandidates.map((candidate, idx) => ({
      ...candidate,
      globalRank: idx + 1
    }));
  }

  // Create a Set of parent IDs for quick lookup
  const parentIds = new Set(
    parents.map(p => `i${p.metadata.iteration}c${p.metadata.candidateId}`)
  );

  // Find the position of the worst-ranked parent in the current ranking
  let worstParentPosition = -1;
  for (let i = 0; i < rankedCandidates.length; i++) {
    const candidateId = `i${rankedCandidates[i].metadata.iteration}c${rankedCandidates[i].metadata.candidateId}`;
    if (parentIds.has(candidateId)) {
      worstParentPosition = i;
    }
  }

  // If no parents found (shouldn't happen), treat all as above parents
  if (worstParentPosition === -1) {
    return rankedCandidates.map((candidate, idx) => ({
      ...candidate,
      globalRank: idx + 1
    }));
  }

  // Assign global ranks
  let currentGlobalRank = 1;
  const result = [];

  for (let i = 0; i < rankedCandidates.length; i++) {
    const candidate = rankedCandidates[i];
    const candidateId = `i${candidate.metadata.iteration}c${candidate.metadata.candidateId}`;
    const isParent = parentIds.has(candidateId);
    const isBelowWorstParent = i > worstParentPosition;

    if (isBelowWorstParent && !isParent) {
      // Child ranked below worst parent: tied at floor rank
      result.push({
        ...candidate,
        globalRank: floorRank,
        globalRankNote: 'tied_at_floor'
      });
    } else {
      // Above or at parent level, or is a parent: sequential global rank
      result.push({
        ...candidate,
        globalRank: currentGlobalRank
      });
      currentGlobalRank++;
    }
  }

  return result;
}

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
  // Enable graceful degradation to prevent single vision API failures from crashing entire beam search
  const { ensembleSize, tokenTracker, onStepProgress } = options;
  const rankResult = await imageRanker.rankImages(images, userPrompt, {
    keepTop,
    knownComparisons,
    ensembleSize,
    gracefulDegradation: true,
    onProgress: (progressData) => {
      // Emit ranking progress updates via WebSocket
      if (onStepProgress) {
        const { completed, total, candidateA, candidateB, winner, inferred, error } = progressData;
        onStepProgress({
          stage: 'ranking',
          status: 'progress',
          message: `🔄 Ranking: Comparing ${candidateA} vs ${candidateB} (${completed}/${total})${inferred ? ' (inferred)' : ''}${error ? ' (failed)' : ''}`,
          progress: { completed, total }
        });
      }
    }
  });

  // Handle both old format (array) and new format (object with metadata)
  const rankings = Array.isArray(rankResult) ? rankResult : rankResult.rankings;
  const rankingMetadata = !Array.isArray(rankResult) ? rankResult.metadata : {};

  // Log any errors that occurred during ranking (graceful degradation)
  if (rankingMetadata.errors && rankingMetadata.errors.length > 0) {
    console.warn(`[BeamSearch] Ranking completed with ${rankingMetadata.errors.length} error(s):`);
    rankingMetadata.errors.forEach((err, idx) => {
      console.warn(`  ${idx + 1}. ${err.type}: ${err.message}`);
    });
  }

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

  // All candidates should have rankings through complete transitivity hierarchy
  // Filter out any without rankings (should not happen in normal operation)
  // Then sort by rank (1 = best) to get complete hierarchy
  const candidatesWithRankings = rankedCandidates.filter(c => c.ranking !== undefined);
  candidatesWithRankings.sort((a, b) => a.ranking.rank - b.ranking.rank);

  // Return object with both: allRanked (complete hierarchy for frontend) and topCandidates (survivors for next iteration)
  return {
    allRanked: candidatesWithRankings,
    topCandidates: candidatesWithRankings.slice(0, keepTop)
  };
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
  const { metadataTracker, tokenTracker, iteration, candidateId, dimension, parentId, onStepProgress } = options;
  const candidateId_str = `i${iteration}c${candidateId}`;

  // Progress: Combine start
  if (onStepProgress) {
    onStepProgress({
      stage: 'combine',
      status: 'starting',
      candidateId: candidateId_str,
      message: `🔄 ${candidateId_str}: Combining 'what' + 'how' prompts...`
    });
  }

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

  // Progress: Combine complete, image generation starting
  if (onStepProgress) {
    onStepProgress({
      stage: 'combine',
      status: 'complete',
      candidateId: candidateId_str,
      message: `✓ ${candidateId_str}: Prompts combined, submitting to image generation...`
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

  // Progress: Image generation starting
  if (onStepProgress) {
    onStepProgress({
      stage: 'imageGen',
      status: 'starting',
      candidateId: candidateId_str,
      message: `⬆️  ${candidateId_str}: Generating image...`
    });
  }

  // Stage 2: Generate image with automatic safety retry
  const image = await generateImageWithSafetyRetry(
    combined,
    imageGenProvider,
    llmProvider,
    {
      ...options,
      onStepProgress,
      // Don't override candidateId with string - keep numeric for image saving
      // The string version is only used for progress messages
      candidateIdStr: candidateId_str
    }
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
        iteration: options.iteration,
        candidateId: options.candidateId,
        operation: 'generate'
      }
    });
  }

  // Progress: Image generation complete
  if (onStepProgress) {
    // Prefer local API URL (persistent, no CORS issues) over temporary OpenAI URL (1hr expiration)
    const imageUrl = image.localPath
      ? `/api/images/${options.sessionId}/${image.localPath.split(/[\\/]/).pop()}`
      : image.url; // Fallback to OpenAI URL if local save failed

    const filename = image.localPath ? image.localPath.split(/[\\/]/).pop() : 'unknown';
    console.log(`[ProcessCandidate] Generated image for ${candidateId_str}: localPath=${image.localPath}, filename=${filename}, imageUrl=${imageUrl}`);

    onStepProgress({
      stage: 'imageGen',
      status: 'complete',
      candidateId: candidateId_str,
      imageUrl,
      message: `✓ ${candidateId_str}: Image generated (ready for evaluation)`
    });
  }

  // Stage 3: Evaluate image (skip if using comparative ranking)
  // When skipVisionAnalysis is true, ranking step will provide feedback
  let evaluation = null;
  let totalScore = null;

  if (!options.skipVisionAnalysis && visionProvider) {
    // Progress: Vision analysis starting
    if (onStepProgress) {
      onStepProgress({
        stage: 'vision',
        status: 'starting',
        candidateId: candidateId_str,
        message: `🔍 ${candidateId_str}: Analyzing image with vision model...`
      });
    }

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

    // Progress: Vision analysis complete
    if (onStepProgress) {
      onStepProgress({
        stage: 'vision',
        status: 'complete',
        candidateId: candidateId_str,
        alignment: evaluation.alignmentScore,
        aesthetic: evaluation.aestheticScore,
        totalScore,
        message: `✅ ${candidateId_str}: Evaluation complete - alignment: ${Math.round(evaluation.alignmentScore)}/100, aesthetic: ${evaluation.aestheticScore.toFixed(1)}/10`
      });
    }
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
 * @param {Function} [config.onCandidateProcessed] - Callback invoked as each candidate completes
 * @returns {Promise<Array>} Array of N candidates
 */
async function initialExpansion(
  userPrompt,
  llmProvider,
  imageGenProvider,
  visionProvider,
  config
) {
  const { beamWidth: N, temperature = 0.7, alpha = 0.7, metadataTracker, tokenTracker, onCandidateProcessed, onStepProgress, abortSignal } = config;

  // Rate limiters are initialized at module load time
  // They are reused across all jobs to maintain consistent metrics

  // Check if already aborted
  if (abortSignal?.aborted) {
    throw new Error('Job cancelled');
  }

  console.log(`[initialExpansion] Starting with N=${N}, onCandidateProcessed=${!!onCandidateProcessed}, onStepProgress=${!!onStepProgress}`);

  // Generate N WHAT+HOW pairs in parallel with stochastic variation and rate limiting
  const whatHowPairs = await Promise.all(
    Array(N).fill().map(async (_, i) => {
      const candidateId_str = `i0c${i}`;

      // Progress: Prompt expansion starting
      if (onStepProgress) {
        onStepProgress({
          stage: 'expand',
          status: 'starting',
          candidateId: candidateId_str,
          message: `📝 ${candidateId_str}: Expanding 'what' and 'how' prompts...`
        });
      }

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

      // Progress: Prompt expansion complete
      if (onStepProgress) {
        onStepProgress({
          stage: 'expand',
          status: 'complete',
          candidateId: candidateId_str,
          message: `✓ ${candidateId_str}: Prompts expanded (what and how generated)`
        });
      }

      return {
        what: what.refinedPrompt,
        how: how.refinedPrompt
      };
    })
  );

  // Check if aborted while generating prompts
  if (abortSignal?.aborted) {
    throw new Error('Job cancelled');
  }

  // Stream all N candidates through the pipeline with rate limiting
  const candidates = await Promise.all(
    whatHowPairs.map(async ({ what, how }, i) => {
      // Create wrapper that applies rate limiting for image gen and vision
      const limitedProcessCandidateStream = async () => {
        // Check if aborted before starting
        if (abortSignal?.aborted) {
          throw new Error('Job cancelled');
        }

        const candidateId_str = `i0c${i}`;

        // Progress: Combine start
        if (onStepProgress) {
          onStepProgress({
            stage: 'combine',
            status: 'starting',
            candidateId: candidateId_str,
            message: `🔄 ${candidateId_str}: Combining 'what' + 'how' prompts...`
          });
        }

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

        // Progress: Combine complete, image generation starting
        if (onStepProgress) {
          onStepProgress({
            stage: 'combine',
            status: 'complete',
            candidateId: candidateId_str,
            message: `✓ ${candidateId_str}: Prompts combined, submitting to image generation...`
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

        // Progress: Image generation starting
        if (onStepProgress) {
          onStepProgress({
            stage: 'imageGen',
            status: 'starting',
            candidateId: candidateId_str,
            message: `⬆️  ${candidateId_str}: Generating image...`
          });
        }

        // Generate image with automatic safety retry
        const image = await generateImageWithSafetyRetry(
          combined,
          imageGenProvider,
          llmProvider,
          {
            iteration: 0,
            candidateId: i,
            dimension: 'what',
            alpha,
            sessionId: config.sessionId,
            onStepProgress,
            candidateIdStr: candidateId_str
          }
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

        // Progress: Image generation complete
        if (onStepProgress) {
          // Prefer local API URL (persistent, no CORS issues) over temporary OpenAI URL (1hr expiration)
          const imageUrl = image.localPath
            ? `/api/images/${config.sessionId}/${image.localPath.split(/[\\/]/).pop()}`
            : image.url; // Fallback to OpenAI URL if local save failed

          const filename = image.localPath ? image.localPath.split(/[\\/]/).pop() : 'unknown';
          console.log(`[InitialExpansion] Generated image for ${candidateId_str}: localPath=${image.localPath}, filename=${filename}, imageUrl=${imageUrl}`);

          onStepProgress({
            stage: 'imageGen',
            status: 'complete',
            candidateId: candidateId_str,
            imageUrl,
            message: `✓ ${candidateId_str}: Image generated (ready for evaluation)`
          });
        }

        // Evaluate image with rate limiting (skip if using comparative ranking)
        let evaluation = null;
        let totalScore = null;

        if (!config.skipVisionAnalysis && visionProvider) {
          // Progress: Vision analysis starting
          if (onStepProgress) {
            onStepProgress({
              stage: 'vision',
              status: 'starting',
              candidateId: candidateId_str,
              message: `🔍 ${candidateId_str}: Analyzing image with vision model...`
            });
          }

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

          // Progress: Vision analysis complete
          if (onStepProgress) {
            onStepProgress({
              stage: 'vision',
              status: 'complete',
              candidateId: candidateId_str,
              alignment: evaluation.alignmentScore,
              aesthetic: evaluation.aestheticScore,
              totalScore,
              message: `✅ ${candidateId_str}: Evaluation complete - alignment: ${Math.round(evaluation.alignmentScore)}/100, aesthetic: ${evaluation.aestheticScore.toFixed(1)}/10`
            });
          }
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

        // Create complete candidate object
        const candidate = {
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

        // Invoke callback immediately as candidate completes
        // This enables real-time progress updates instead of waiting for all candidates
        if (onCandidateProcessed) {
          console.log(`[initialExpansion] Invoking callback for candidate ${i}`);
          onCandidateProcessed(candidate);
        } else {
          console.log(`[initialExpansion] No callback for candidate ${i}`);
        }

        return candidate;
      };

      // Wrap in try-catch for graceful error recovery
      try {
        return await limitedProcessCandidateStream();
      } catch (error) {
        // Log the error but don't crash the entire job
        const candidateId_str = `i0c${i}`;
        console.error(`[initialExpansion] Candidate ${candidateId_str} failed: ${error.message}`);

        // Emit error message so user sees what happened
        if (onStepProgress) {
          onStepProgress({
            stage: 'error',
            status: 'failed',
            candidateId: candidateId_str,
            message: `⚠️ ${candidateId_str}: Failed - ${error.message}`
          });
        }

        // Return null to indicate this candidate failed (will be filtered out)
        return null;
      }
    })
  );

  // Filter out failed candidates (nulls)
  const successfulCandidates = candidates.filter(c => c !== null);

  // Check if we have enough candidates to continue
  if (successfulCandidates.length === 0) {
    throw new Error('All candidates failed during initial expansion. Check prompts for safety violations.');
  }

  console.log(`[initialExpansion] ${successfulCandidates.length}/${N} candidates succeeded`);
  return successfulCandidates;
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
 * @param {Function} [config.onCandidateProcessed] - Callback invoked as each candidate completes
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
  iteration,
  userPrompt
) {
  const { beamWidth: N, keepTop: M, alpha = 0.7, metadataTracker, tokenTracker, skipVisionAnalysis, onCandidateProcessed, onStepProgress, abortSignal } = config;
  const expansionRatio = Math.floor(N / M);

  // Check if already aborted
  if (abortSignal?.aborted) {
    throw new Error('Job cancelled');
  }

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
        userPrompt,
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
        const candidateId_str = `i${iteration}c${candidateId}`;

        // Wrap in try-catch for graceful error recovery
        try {
          // Check if aborted before processing this child
          if (abortSignal?.aborted) {
            throw new Error('Job cancelled');
          }

          // Refine the selected dimension using critique
          const refinedResult = await llmProvider.refinePrompt(
            dimension === 'what' ? parent.whatPrompt : parent.howPrompt,
            {
              operation: 'refine',
              dimension,
              critique: parent.critique,
              userPrompt
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
          const candidate = await processCandidateStream(
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
              skipVisionAnalysis,
              onStepProgress,
              sessionId: config.sessionId
            }
          );

          // Invoke callback immediately as candidate completes
          // This enables real-time progress updates instead of waiting for all candidates
          if (onCandidateProcessed) {
            onCandidateProcessed(candidate);
          }

          return candidate;
        } catch (error) {
          // Don't catch cancellation errors - let them propagate
          if (error.message === 'Job cancelled') {
            throw error;
          }

          // Log the error but don't crash the entire job
          console.error(`[refinementIteration] Candidate ${candidateId_str} failed: ${error.message}`);

          // Emit error message so user sees what happened
          if (onStepProgress) {
            onStepProgress({
              stage: 'error',
              status: 'failed',
              candidateId: candidateId_str,
              message: `⚠️ ${candidateId_str}: Failed - ${error.message}`
            });
          }

          // Return null to indicate this candidate failed (will be filtered out)
          return null;
        }
      })
    )
  );

  // Filter out failed candidates (nulls)
  const successfulChildren = allChildren.filter(c => c !== null);

  // Check if we have enough candidates to continue
  if (successfulChildren.length === 0) {
    throw new Error(`All candidates failed during refinement iteration ${iteration}. Check prompts for safety violations.`);
  }

  console.log(`[refinementIteration] Iteration ${iteration}: ${successfulChildren.length}/${allChildren.length} candidates succeeded`);
  return successfulChildren;
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
 * @param {Function} [config.onRankingComplete] - Optional callback with all ranked candidates after ranking
 * @returns {Promise<Object>} Best candidate after all iterations
 */
async function beamSearch(userPrompt, providers, config) {
  const { llm, imageGen, vision, critiqueGen, imageRanker } = providers;
  const { maxIterations, keepTop, metadataTracker, tokenTracker, onIterationComplete, onRankingComplete, onStepProgress, ensembleSize, beamWidth } = config;

  // Determine ranking strategy: Use comparative ranking if imageRanker provided
  const useComparativeRanking = imageRanker !== undefined;

  // Build config with skipVisionAnalysis when using ranking
  const pipelineConfig = {
    ...config,
    skipVisionAnalysis: useComparativeRanking
  };

  // Global ranking state
  // Floor rank = beamWidth (worst rank from iteration 0, where all eliminated candidates live)
  const floorRank = beamWidth || config.beamWidth || 4;
  // Accumulate all candidates with global ranks across iterations
  let allGlobalRanked = [];

  // Iteration 0: Initial expansion
  // Note: onCandidateProcessed is called inside initialExpansion as each candidate completes
  let candidates = await initialExpansion(
    userPrompt,
    llm,
    imageGen,
    vision,
    pipelineConfig
  );

  // Rank and select top M candidates
  // Use comparative ranking if imageRanker provided, otherwise use score-based ranking
  let topCandidates;
  let rankingResults = null; // Store ranking results for emission in worker

  if (useComparativeRanking) {
    rankingResults = await rankAndSelectComparative(candidates, keepTop, imageRanker, userPrompt, { ensembleSize, tokenTracker, onStepProgress });
    topCandidates = rankingResults.topCandidates;
    // Update candidates array to include ranking data for metadata tracking
    candidates = rankingResults.allRanked;

    // Compute global ranks for iteration 0
    const globalRanked = computeGlobalRanks(rankingResults.allRanked, [], floorRank, 0);
    allGlobalRanked = globalRanked;

    // Emit ranking data with global ranks
    if (onRankingComplete) {
      onRankingComplete({
        iteration: 0,
        rankedCandidates: globalRanked,
        allGlobalRanked: globalRanked
      });
    }
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
    // Note: onCandidateProcessed is called inside refinementIteration as each candidate completes
    candidates = await refinementIteration(
      topCandidates,
      llm,
      imageGen,
      vision,
      critiqueGen,
      pipelineConfig,
      iteration,
      userPrompt
    );

    // Rank and select top M for next iteration
    // Include both parents and children to ensure best from ANY iteration survives
    const allCandidates = [...topCandidates, ...candidates];

    // Use comparative ranking if imageRanker provided, otherwise use score-based ranking
    if (useComparativeRanking) {
      // Pass previous top candidates to avoid re-comparing known pairs
      const previousTop = topCandidates;
      const iterationRankingResults = await rankAndSelectComparative(allCandidates, keepTop, imageRanker, userPrompt, { previousTopCandidates: previousTop, ensembleSize, tokenTracker, onStepProgress });
      topCandidates = iterationRankingResults.topCandidates;
      rankingResults = iterationRankingResults; // Store for emission

      // Compute global ranks for this iteration
      // Parents are the previous top candidates (from before this iteration)
      const globalRanked = computeGlobalRanks(iterationRankingResults.allRanked, previousTop, floorRank, iteration);

      // Merge with previous global rankings:
      // - Keep eliminated candidates from previous iterations (they're not in this ranking)
      // - Replace candidates that appear in this iteration with their updated global ranks
      const currentIds = new Set(
        globalRanked.map(c => `i${c.metadata.iteration}c${c.metadata.candidateId}`)
      );
      const previousEliminated = allGlobalRanked.filter(c => {
        const id = `i${c.metadata.iteration}c${c.metadata.candidateId}`;
        return !currentIds.has(id);
      });
      allGlobalRanked = [...globalRanked, ...previousEliminated];

      // Emit ranking data with global ranks
      if (onRankingComplete) {
        onRankingComplete({
          iteration,
          rankedCandidates: globalRanked,
          allGlobalRanked: allGlobalRanked
        });
      }
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

  // Sort all global ranked candidates by their global rank for final display
  allGlobalRanked.sort((a, b) => a.globalRank - b.globalRank);

  // Return best candidate with all finalists and complete global ranking
  // Attach finalists to winner for backward compatibility
  winner.finalists = topCandidates;
  winner.allGlobalRanked = allGlobalRanked;
  return winner;
}

module.exports = {
  rankAndSelect,
  rankAndSelectComparative,
  calculateTotalScore,
  computeGlobalRanks,
  processCandidateStream,
  initialExpansion,
  refinementIteration,
  beamSearch
};
