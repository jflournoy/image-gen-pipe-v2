/**
 * TDD GREEN Phase: Beam Search Orchestrator
 *
 * Implements streaming parallel beam search for image generation.
 * Reference: docs/streaming-parallel-architecture.md
 */

const { RateLimiter } = require('../utils/rate-limiter.js');
const rateLimitConfig = require('../config/rate-limits.js');
const { registerLimiter } = require('../utils/rate-limiter-registry.js');
const modelCoordinator = require('../utils/model-coordinator.js');

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
 * Configure rate limiters based on provider types
 * Call this before starting a beam search job to set appropriate concurrency
 *
 * @param {Object} providerTypes - Object indicating which providers are local
 * @param {boolean} providerTypes.llmIsLocal - True if using local LLM
 * @param {boolean} providerTypes.imageIsLocal - True if using local image gen
 * @param {boolean} providerTypes.visionIsLocal - True if using local vision
 */
function configureRateLimitsForProviders(providerTypes = {}) {
  const { llmIsLocal = false, imageIsLocal = false, visionIsLocal = false } = providerTypes;

  const llmLimit = rateLimitConfig.getLimitForType('llm', llmIsLocal);
  const imageLimit = rateLimitConfig.getLimitForType('imageGen', imageIsLocal);
  const visionLimit = rateLimitConfig.getLimitForType('vision', visionIsLocal);

  llmLimiter.setConcurrencyLimit(llmLimit);
  imageGenLimiter.setConcurrencyLimit(imageLimit);
  visionLimiter.setConcurrencyLimit(visionLimit);

  console.log(`[BeamSearch] Rate limits configured: LLM=${llmLimit} (local=${llmIsLocal}), Image=${imageLimit} (local=${imageIsLocal}), Vision=${visionLimit} (local=${visionIsLocal})`);
}

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

  // Helper to generate image with periodic progress updates
  async function generateWithProgress(promptToUse, isRetry = false) {
    const startTime = Date.now();
    let progressInterval = null;
    let elapsedSeconds = 0;

    // Send periodic progress messages to prevent timeout warnings
    if (onStepProgress) {
      progressInterval = setInterval(() => {
        elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        const retryNote = isRetry ? ' (retry)' : '';
        onStepProgress({
          stage: 'imageGen',
          status: 'generating',
          candidateId: candidateIdStr,
          message: `🎨 ${candidateIdStr}: Generating image${retryNote}... ${elapsedSeconds}s`
        });
      }, 10000); // Update every 10 seconds
    }

    try {
      const result = await imageGenLimiter.execute(() =>
        imageGenProvider.generateImage(promptToUse, genOptions)
      );
      return result;
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    }
  }

  try {
    // Unload LLM before image generation to free GPU memory
    await modelCoordinator.prepareForImageGen();

    // First attempt - generate with original prompt
    return await generateWithProgress(prompt, false);
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

      // Second attempt - generate with rephrased prompt (with progress updates)
      const result = await generateWithProgress(rephrasedPrompt, true);

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
  // Include both url and localPath - VLM uses localPath, OpenAI uses url
  const images = candidates.map(candidate => ({
    candidateId: `i${candidate.metadata.iteration}c${candidate.metadata.candidateId}`,
    iteration: candidate.metadata.iteration,
    localId: candidate.metadata.candidateId,
    url: candidate.image.url,
    localPath: candidate.image.localPath  // For VLM local file access
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
        const { completed, total, candidateA, candidateB, inferred, error, errorMessage } = progressData;
        const failSuffix = error ? ` (failed${errorMessage ? ': ' + errorMessage : ''})` : '';
        onStepProgress({
          stage: 'ranking',
          status: 'progress',
          message: `🔄 Ranking: Comparing ${candidateA} vs ${candidateB} (${completed}/${total})${inferred ? ' (inferred)' : ''}${failSuffix}`,
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

    // Circuit breaker: If too many comparisons failed, stop the beam search
    // Default: Fail if >50% of comparisons failed (services are truly broken)
    const failureThreshold = parseFloat(process.env.RANKING_FAILURE_THRESHOLD || '0.5');
    const totalComparisons = images.length * (images.length - 1) / 2; // n choose 2
    const failureRate = rankingMetadata.errors.length / totalComparisons;

    if (failureRate > failureThreshold) {
      const errorSummary = rankingMetadata.errors
        .slice(0, 3)
        .map(e => e.message)
        .join('; ');
      throw new Error(
        `Ranking failure rate too high: ${Math.round(failureRate * 100)}% ` +
        `(${rankingMetadata.errors.length}/${totalComparisons} comparisons failed). ` +
        `Services appear to be broken. First errors: ${errorSummary}`
      );
    }
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
  const { metadataTracker, tokenTracker, iteration, candidateId, dimension, parentId, onStepProgress, descriptiveness, varyDescriptivenessRandomly, promptStyle } = options;
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

  // Get effective descriptiveness (random 1-3 or fixed value)
  const effectiveDescriptiveness = varyDescriptivenessRandomly
    ? Math.floor(Math.random() * 3) + 1
    : descriptiveness;

  // Stage 1: Combine prompts with descriptiveness level
  const descriptiveLabels = ['', 'concise', 'balanced', 'descriptive'];
  const combineResult = await llmProvider.combinePrompts(whatPrompt, howPrompt, { descriptiveness: effectiveDescriptiveness, promptStyle, top_p, top_k });
  const combined = combineResult.combinedPrompt;

  console.log(`[${candidateId_str}] Combined prompt (${descriptiveLabels[effectiveDescriptiveness]}, level ${effectiveDescriptiveness}): ${combined.length} chars`);

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
      promptLength: combined.length,
      descriptiveness: effectiveDescriptiveness,
      message: `✓ ${candidateId_str}: Prompts combined (${combined.length} chars, ${descriptiveLabels[effectiveDescriptiveness]}), submitting to image generation...`
    });
  }

  // Stage 1.5: Generate negative prompt for SDXL models (if enabled)
  let negativePrompt = options.negativePrompt || null;  // Manual override takes precedence
  let negativePromptMetadata = null;

  if (!negativePrompt && options.autoGenerateNegativePrompts) {
    // Check if this is an SDXL model (supports negative prompts)
    const modelType = imageGenProvider.modelType || 'unknown';
    const isSDXL = modelType === 'sdxl' || modelType === 'modal';
    console.log(`[${candidateId_str}] Negative prompt check: modelType=${modelType}, isSDXL=${isSDXL}, autoGenerate=${options.autoGenerateNegativePrompts}`);

    if (isSDXL) {
      // Progress: Negative prompt generation starting
      if (onStepProgress) {
        onStepProgress({
          stage: 'negativePrompt',
          status: 'starting',
          candidateId: candidateId_str,
          message: `🔍 ${candidateId_str}: Generating negative prompt...`
        });
      }

      try {
        // Use negativePromptGenerator if provided, otherwise use LLM provider method
        const generator = options.negativePromptGenerator || llmProvider;
        const negativeResult = await generator.generateNegativePrompt(combined, {
          enabled: true,
          fallback: options.negativePromptFallback,
          promptStyle
        });

        negativePrompt = negativeResult.negativePrompt;
        negativePromptMetadata = negativeResult.metadata || {};
        console.log(`[${candidateId_str}] Generated negative prompt: ${negativePrompt.substring(0, 80)}...`);

        // Track negative prompt generation tokens
        if (tokenTracker && negativeResult.metadata?.tokensUsed) {
          tokenTracker.recordUsage({
            provider: 'llm',
            operation: 'negativePrompt',
            tokens: negativeResult.metadata.tokensUsed,
            metadata: {
              model: negativeResult.metadata.model,
              iteration,
              candidateId,
              operation: 'negativePrompt'
            }
          });
        }

        // Progress: Negative prompt generation complete
        if (onStepProgress) {
          onStepProgress({
            stage: 'negativePrompt',
            status: 'complete',
            candidateId: candidateId_str,
            negativePrompt: negativePrompt.substring(0, 80) + '...',
            message: `✓ ${candidateId_str}: Negative prompt generated`
          });
        }
      } catch (error) {
        console.warn(`[${candidateId_str}] Failed to generate negative prompt: ${error.message}, using fallback`);
        negativePrompt = options.negativePromptFallback || 'blurry, low quality, distorted, deformed, artifacts';
        negativePromptMetadata = {
          autoGenerated: false,
          usedFallback: true,
          error: error.message
        };

        if (onStepProgress) {
          onStepProgress({
            stage: 'negativePrompt',
            status: 'fallback',
            candidateId: candidateId_str,
            message: `⚠️ ${candidateId_str}: Using fallback negative prompt`
          });
        }
      }
    } else {
      console.log(`[${candidateId_str}] Skipping negative prompt: model type "${modelType}" is not SDXL/modal`);
    }
  } else if (negativePrompt) {
    console.log(`[${candidateId_str}] Using manual negative prompt: "${negativePrompt.substring(0, 80)}..."`);
  } else {
    console.log(`[${candidateId_str}] Negative prompt disabled (autoGenerate=${options.autoGenerateNegativePrompts})`);
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
  // Log BFL options if present
  if (options.bflOptions) {
    console.log(`[Beam Search] Passing bflOptions to image generator: model=${options.bflOptions.model || 'default'}, safety_tolerance=${options.bflOptions.safety_tolerance}, steps=${options.bflOptions.steps || 'default'}, guidance=${options.bflOptions.guidance || 'default'}`);
  }
  // Log Modal options if present
  if (options.modalOptions) {
    console.log(`[Beam Search] Passing modalOptions to image generator: model=${options.modalOptions.model || 'default'}, steps=${options.modalOptions.steps || 'default'}, guidance=${options.modalOptions.guidance || 'default'}, gpu=${options.modalOptions.gpu || 'default'}`);
  }
  // Log LoRA options if present
  if (options.loraOptions) {
    console.log(`[Beam Search] Passing loraOptions to Flux: path=${options.loraOptions.path}, scale=${options.loraOptions.scale}`);
  }

  const image = await generateImageWithSafetyRetry(
    combined,
    imageGenProvider,
    llmProvider,
    {
      ...options,
      negativePrompt,  // Pass negative prompt to image generation
      // Face fixing parameters
      ...(options.fixFaces && {
        fix_faces: true,
        restoration_strength: options.restorationStrength ?? 0.5,
        face_upscale: options.faceUpscale ?? 1
      }),
      // Return base image before face fixing for debugging
      ...(options.return_intermediate_images && { return_intermediate_images: true }),
      // Flatten fluxOptions so they're available as top-level properties for the image generator
      ...(options.fluxOptions && {
        steps: options.fluxOptions.steps,
        guidance: options.fluxOptions.guidance,
        scheduler: options.fluxOptions.scheduler,
        width: options.fluxOptions.width,
        height: options.fluxOptions.height,
        loraScale: options.fluxOptions.loraScale
      }),
      // Flatten bflOptions so they're available as top-level properties for BFL provider
      ...(options.bflOptions && {
        safety_tolerance: options.bflOptions.safety_tolerance,
        width: options.bflOptions.width,
        height: options.bflOptions.height,
        model: options.bflOptions.model,
        steps: options.bflOptions.steps,
        guidance: options.bflOptions.guidance,
        seed: options.bflOptions.seed,
        output_format: options.bflOptions.output_format
      }),
      // Flatten modalOptions so they're available as top-level properties for Modal provider
      ...(options.modalOptions && {
        model: options.modalOptions.model,
        width: options.modalOptions.width,
        height: options.modalOptions.height,
        steps: options.modalOptions.steps,
        guidance: options.modalOptions.guidance,
        seed: options.modalOptions.seed,
        gpu: options.modalOptions.gpu
      }),
      // Flatten loraOptions so they're available for the Flux provider
      ...(options.loraOptions && {
        loras: [options.loraOptions.path],
        loraScale: options.loraOptions.scale
      }),
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

    // Use url for cloud providers, localPath for local providers (Flux, etc.)
    const imageReference = image.url || image.localPath;
    evaluation = await visionProvider.analyzeImage(imageReference, combined);

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
      negativePrompt,
      negativePromptMetadata,
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
    negativePrompt,
    negativePromptMetadata,
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
  const { beamWidth: N, temperature = 0.7, top_p = 0.8, top_k = 20, alpha = 0.7, descriptiveness = 2, varyDescriptivenessRandomly = false, promptStyle = 'natural', metadataTracker, tokenTracker, onCandidateProcessed, onStepProgress, abortSignal } = config;

  // Helper to get effective descriptiveness (random 1-3 or fixed value)
  const getEffectiveDescriptiveness = () => {
    if (varyDescriptivenessRandomly) {
      return Math.floor(Math.random() * 3) + 1; // 1, 2, or 3
    }
    return descriptiveness;
  };

  // Rate limiters are initialized at module load time
  // They are reused across all jobs to maintain consistent metrics

  // Check if already aborted
  if (abortSignal?.aborted) {
    throw new Error('Job cancelled');
  }

  console.log(`[initialExpansion] Starting with N=${N}, onCandidateProcessed=${!!onCandidateProcessed}, onStepProgress=${!!onStepProgress}`);
  if (config.fixFaces) {
    console.log(`[initialExpansion] Face fixing enabled: fixFaces=${config.fixFaces}, restorationStrength=${config.restorationStrength ?? 0.5}, upscale=${config.faceUpscale}`);
  } else {
    console.log(`[initialExpansion] Face fixing disabled (config.fixFaces=${config.fixFaces})`);
  }

  // Unload Flux before LLM operations to free GPU memory
  await modelCoordinator.prepareForLLM();

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
          temperature, top_p, top_k,
          promptStyle
        })),
        llmLimiter.execute(() => llmProvider.refinePrompt(userPrompt, {
          dimension: 'how',
          operation: 'expand',
          temperature, top_p, top_k,
          promptStyle
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

  // Determine if batch image generation is available (duck-type check)
  const useBatch = typeof imageGenProvider.generateImages === 'function';

  let candidates;

  if (useBatch) {
    // === BATCH PATH: Phased execution for batch-capable providers ===
    // Phase 1: Combine all prompts in parallel
    // Phase 2: Batch generate all images in a single request
    // Phase 3: Evaluate all images in parallel
    console.log(`[initialExpansion] Using BATCH image generation for ${N} candidates`);

    // Phase 1: Combine all prompts and generate negative prompts (parallel)
    const combineResults = await Promise.all(
      whatHowPairs.map(async ({ what, how }, i) => {
        const candidateId_str = `i0c${i}`;

        try {
          if (abortSignal?.aborted) throw new Error('Job cancelled');

          if (onStepProgress) {
            onStepProgress({ stage: 'combine', status: 'starting', candidateId: candidateId_str,
              message: `🔄 ${candidateId_str}: Combining 'what' + 'how' prompts...` });
          }

          const effectiveDescriptiveness = getEffectiveDescriptiveness();
          const descriptiveLabels = ['', 'concise', 'balanced', 'descriptive'];
          const combineResult = await llmProvider.combinePrompts(what, how, { descriptiveness: effectiveDescriptiveness, promptStyle, top_p, top_k });
          const combined = combineResult.combinedPrompt;

          console.log(`[${candidateId_str}] Combined prompt (${descriptiveLabels[effectiveDescriptiveness]}, level ${effectiveDescriptiveness}): ${combined.length} chars`);

          if (tokenTracker && combineResult.metadata) {
            tokenTracker.recordUsage({ provider: 'llm', operation: 'combine', tokens: combineResult.metadata.tokensUsed,
              metadata: { model: combineResult.metadata.model, iteration: 0, candidateId: i, operation: 'combine' } });
          }

          if (onStepProgress) {
            onStepProgress({ stage: 'combine', status: 'complete', candidateId: candidateId_str,
              message: `✓ ${candidateId_str}: Prompts combined` });
          }

          // Generate negative prompt if needed
          let negativePrompt = config.negativePrompt || null;
          if (!negativePrompt && config.autoGenerateNegativePrompts) {
            const modelType = imageGenProvider.modelType || 'unknown';
            const isSDXL = modelType === 'sdxl' || modelType === 'modal';
            console.log(`[${candidateId_str}] Negative prompt check: modelType=${modelType}, isSDXL=${isSDXL}, autoGenerate=${config.autoGenerateNegativePrompts}`);
            if (isSDXL) {
              try {
                const generator = config.negativePromptGenerator || llmProvider;
                const negativeResult = await generator.generateNegativePrompt(combined, { enabled: true, fallback: config.negativePromptFallback, promptStyle });
                negativePrompt = negativeResult.negativePrompt;
                console.log(`[${candidateId_str}] Negative prompt generated: "${negativePrompt?.substring(0, 80)}..."`);
              } catch (err) {
                negativePrompt = config.negativePromptFallback || 'blurry, low quality, distorted, deformed, artifacts';
                console.warn(`[${candidateId_str}] Negative prompt generation failed, using fallback: ${err.message}`);
              }
            } else {
              console.log(`[${candidateId_str}] Skipping negative prompt: model type "${modelType}" is not SDXL/modal`);
            }
          } else if (negativePrompt) {
            console.log(`[${candidateId_str}] Using manual negative prompt: "${negativePrompt.substring(0, 80)}..."`);
          } else {
            console.log(`[${candidateId_str}] Negative prompt disabled (autoGenerate=${config.autoGenerateNegativePrompts})`);
          }

          // Record attempt before image gen
          if (metadataTracker) {
            await metadataTracker.recordAttempt({ whatPrompt: what, howPrompt: how,
              metadata: { iteration: 0, candidateId: i, dimension: 'what', parentId: null } });
          }

          return { what, how, combined, negativePrompt, candidateId: i, failed: false };
        } catch (error) {
          console.error(`[initialExpansion] Candidate ${candidateId_str} combine failed: ${error.message}`);
          if (onStepProgress) {
            onStepProgress({ stage: 'error', status: 'failed', candidateId: candidateId_str,
              message: `⚠️ ${candidateId_str}: Failed - ${error.message}` });
          }
          return { candidateId: i, failed: true };
        }
      })
    );

    if (abortSignal?.aborted) throw new Error('Job cancelled');

    // Filter to successful combines only
    const successfulCombines = combineResults.filter(r => !r.failed);
    if (successfulCombines.length === 0) {
      throw new Error('All candidates failed during prompt combination.');
    }

    // Phase 2: Batch generate all images in a single request
    // Build gen options shared across all requests
    const sharedGenOptions = {
      sessionId: config.sessionId,
      ...(config.fixFaces && { fix_faces: true, restoration_strength: config.restorationStrength ?? 0.5, face_upscale: config.faceUpscale ?? 1 }),
      ...(config.return_intermediate_images && { return_intermediate_images: true }),
      ...(config.fluxOptions && { steps: config.fluxOptions.steps, guidance: config.fluxOptions.guidance, scheduler: config.fluxOptions.scheduler, width: config.fluxOptions.width, height: config.fluxOptions.height, loraScale: config.fluxOptions.loraScale }),
      ...(config.bflOptions && { safety_tolerance: config.bflOptions.safety_tolerance, width: config.bflOptions.width, height: config.bflOptions.height }),
      ...(config.modalOptions && { model: config.modalOptions.model, width: config.modalOptions.width, height: config.modalOptions.height, steps: config.modalOptions.steps, guidance: config.modalOptions.guidance })
    };

    const batchRequests = successfulCombines.map(r => ({
      prompt: r.combined,
      options: { ...sharedGenOptions, iteration: 0, candidateId: r.candidateId, negativePrompt: r.negativePrompt }
    }));

    // Emit progress: batch image generation starting
    for (const r of successfulCombines) {
      if (onStepProgress) {
        onStepProgress({ stage: 'imageGen', status: 'starting', candidateId: `i0c${r.candidateId}`,
          message: `⬆️  i0c${r.candidateId}: Generating image (batch)...` });
      }
    }

    // Unload LLM before image generation to free GPU memory
    await modelCoordinator.prepareForImageGen();

    const batchImages = await imageGenProvider.generateImages(batchRequests);

    // Phase 3: Evaluate all images and build candidates (parallel)
    candidates = await Promise.all(
      successfulCombines.map(async (r, batchIdx) => {
        const candidateId_str = `i0c${r.candidateId}`;
        const image = batchImages[batchIdx];

        try {
          // Track image generation
          if (tokenTracker && image.metadata) {
            tokenTracker.recordUsage({ provider: 'image', operation: 'generate', tokens: 1,
              metadata: { model: image.metadata.model, iteration: 0, candidateId: r.candidateId, dimension: 'what', operation: 'generate' } });
          }

          // Progress: Image generation complete
          if (onStepProgress) {
            const imageUrl = image.localPath
              ? `/api/images/${config.sessionId}/${image.localPath.split(/[\\/]/).pop()}`
              : image.url;
            onStepProgress({ stage: 'imageGen', status: 'complete', candidateId: candidateId_str, imageUrl,
              message: `✓ ${candidateId_str}: Image generated (ready for evaluation)` });
          }

          // Evaluate image
          let evaluation = null;
          let totalScore = null;

          if (!config.skipVisionAnalysis && visionProvider) {
            if (onStepProgress) {
              onStepProgress({ stage: 'vision', status: 'starting', candidateId: candidateId_str,
                message: `🔍 ${candidateId_str}: Analyzing image with vision model...` });
            }

            const imageReference = image.url || image.localPath;
            evaluation = await visionLimiter.execute(() => visionProvider.analyzeImage(imageReference, r.combined));

            if (tokenTracker && evaluation.metadata?.tokensUsed) {
              tokenTracker.recordUsage({ provider: 'vision', operation: 'analyze', tokens: evaluation.metadata.tokensUsed,
                metadata: { model: evaluation.metadata.model, iteration: 0, candidateId: r.candidateId, operation: 'analyze' } });
            }

            totalScore = calculateTotalScore(evaluation.alignmentScore, evaluation.aestheticScore, alpha);

            if (onStepProgress) {
              onStepProgress({ stage: 'vision', status: 'complete', candidateId: candidateId_str,
                alignment: evaluation.alignmentScore, aesthetic: evaluation.aestheticScore, totalScore,
                message: `✅ ${candidateId_str}: Evaluation complete - alignment: ${Math.round(evaluation.alignmentScore)}/100, aesthetic: ${evaluation.aestheticScore.toFixed(1)}/10` });
            }
          }

          if (metadataTracker) {
            await metadataTracker.updateAttemptWithResults(0, r.candidateId, {
              combined: r.combined, negativePrompt: r.negativePrompt, negativePromptMetadata: null,
              image, evaluation, totalScore
            });
          }

          const candidate = {
            whatPrompt: r.what, howPrompt: r.how, combined: r.combined,
            negativePrompt: r.negativePrompt,
            image, evaluation, totalScore,
            metadata: { iteration: 0, candidateId: r.candidateId, dimension: 'what' }
          };

          if (onCandidateProcessed) onCandidateProcessed(candidate);
          return candidate;
        } catch (error) {
          console.error(`[initialExpansion] Candidate ${candidateId_str} evaluation failed: ${error.message}`);
          if (onStepProgress) {
            onStepProgress({ stage: 'error', status: 'failed', candidateId: candidateId_str,
              message: `⚠️ ${candidateId_str}: Failed - ${error.message}` });
          }
          return null;
        }
      })
    );

  } else {
    // === STREAMING PATH: Individual calls for non-batch providers ===
    console.log(`[initialExpansion] Using STREAMING image generation for ${N} candidates`);

    candidates = await Promise.all(
      whatHowPairs.map(async ({ what, how }, i) => {
        const limitedProcessCandidateStream = async () => {
          if (abortSignal?.aborted) throw new Error('Job cancelled');

          const candidateId_str = `i0c${i}`;

          if (onStepProgress) {
            onStepProgress({ stage: 'combine', status: 'starting', candidateId: candidateId_str,
              message: `🔄 ${candidateId_str}: Combining 'what' + 'how' prompts...` });
          }

          const effectiveDescriptiveness = getEffectiveDescriptiveness();
          const descriptiveLabels = ['', 'concise', 'balanced', 'descriptive'];
          const combineResult = await llmProvider.combinePrompts(what, how, { descriptiveness: effectiveDescriptiveness, promptStyle, top_p, top_k });
          const combined = combineResult.combinedPrompt;

          console.log(`[${candidateId_str}] Combined prompt (${descriptiveLabels[effectiveDescriptiveness]}, level ${effectiveDescriptiveness}): ${combined.length} chars`);

          if (tokenTracker && combineResult.metadata) {
            tokenTracker.recordUsage({ provider: 'llm', operation: 'combine', tokens: combineResult.metadata.tokensUsed,
              metadata: { model: combineResult.metadata.model, iteration: 0, candidateId: i, operation: 'combine' } });
          }

          if (onStepProgress) {
            onStepProgress({ stage: 'combine', status: 'complete', candidateId: candidateId_str,
              message: `✓ ${candidateId_str}: Prompts combined, submitting to image generation...` });
          }

          // Generate negative prompt for SDXL models (if enabled)
          let negativePrompt = config.negativePrompt || null;
          if (!negativePrompt && config.autoGenerateNegativePrompts) {
            const modelType = imageGenProvider.modelType || 'unknown';
            const isSDXL = modelType === 'sdxl' || modelType === 'modal';
            console.log(`[${candidateId_str}] Negative prompt check: modelType=${modelType}, isSDXL=${isSDXL}, autoGenerate=${config.autoGenerateNegativePrompts}`);
            if (isSDXL) {
              if (onStepProgress) {
                onStepProgress({ stage: 'negativePrompt', status: 'starting', candidateId: candidateId_str,
                  message: `🔍 ${candidateId_str}: Generating negative prompt...` });
              }
              try {
                const generator = config.negativePromptGenerator || llmProvider;
                const negativeResult = await generator.generateNegativePrompt(combined, { enabled: true, fallback: config.negativePromptFallback, promptStyle });
                negativePrompt = negativeResult.negativePrompt;
                console.log(`[${candidateId_str}] Negative prompt generated: "${negativePrompt?.substring(0, 80)}..."`);
                if (tokenTracker && negativeResult.metadata?.tokensUsed) {
                  tokenTracker.recordUsage({ provider: 'llm', operation: 'negativePrompt', tokens: negativeResult.metadata.tokensUsed,
                    metadata: { model: negativeResult.metadata.model, iteration: 0, candidateId: i, operation: 'negativePrompt' } });
                }
                if (onStepProgress) {
                  onStepProgress({ stage: 'negativePrompt', status: 'complete', candidateId: candidateId_str,
                    negativePrompt: negativePrompt && negativePrompt.length > 80 ? negativePrompt.substring(0, 80) + '...' : negativePrompt,
                    message: `✓ ${candidateId_str}: Negative prompt generated` });
                }
              } catch (error) {
                console.warn(`[${candidateId_str}] Failed to generate negative prompt: ${error.message}, using fallback`);
                negativePrompt = config.negativePromptFallback || 'blurry, low quality, distorted, deformed, artifacts';
                if (onStepProgress) {
                  onStepProgress({ stage: 'negativePrompt', status: 'fallback', candidateId: candidateId_str,
                    message: `⚠️ ${candidateId_str}: Using fallback negative prompt` });
                }
              }
            } else {
              console.log(`[${candidateId_str}] Skipping negative prompt: model type "${modelType}" is not SDXL/modal`);
            }
          }

          if (metadataTracker) {
            await metadataTracker.recordAttempt({ whatPrompt: what, howPrompt: how,
              metadata: { iteration: 0, candidateId: i, dimension: 'what', parentId: null } });
          }

          if (onStepProgress) {
            onStepProgress({ stage: 'imageGen', status: 'starting', candidateId: candidateId_str,
              message: `⬆️  ${candidateId_str}: Generating image...` });
          }

          const image = await generateImageWithSafetyRetry(combined, imageGenProvider, llmProvider, {
            iteration: 0, candidateId: i, dimension: 'what', alpha, sessionId: config.sessionId, negativePrompt,
            ...(config.fixFaces && { fix_faces: true, restoration_strength: config.restorationStrength ?? 0.5, face_upscale: config.faceUpscale ?? 1 }),
            ...(config.return_intermediate_images && { return_intermediate_images: true }),
            ...(config.fluxOptions && { steps: config.fluxOptions.steps, guidance: config.fluxOptions.guidance, scheduler: config.fluxOptions.scheduler, width: config.fluxOptions.width, height: config.fluxOptions.height, loraScale: config.fluxOptions.loraScale }),
            ...(config.bflOptions && { safety_tolerance: config.bflOptions.safety_tolerance, width: config.bflOptions.width, height: config.bflOptions.height }),
            ...(config.modalOptions && { model: config.modalOptions.model, width: config.modalOptions.width, height: config.modalOptions.height, steps: config.modalOptions.steps, guidance: config.modalOptions.guidance }),
            onStepProgress, candidateIdStr: candidateId_str
          });

          if (tokenTracker && image.metadata) {
            tokenTracker.recordUsage({ provider: 'image', operation: 'generate', tokens: 1,
              metadata: { model: image.metadata.model, size: image.metadata.size, quality: image.metadata.quality, iteration: 0, candidateId: i, dimension: 'what', operation: 'generate' } });
          }

          if (onStepProgress) {
            const imageUrl = image.localPath ? `/api/images/${config.sessionId}/${image.localPath.split(/[\\/]/).pop()}` : image.url;
            const filename = image.localPath ? image.localPath.split(/[\\/]/).pop() : 'unknown';
            console.log(`[InitialExpansion] Generated image for ${candidateId_str}: localPath=${image.localPath}, filename=${filename}, imageUrl=${imageUrl}`);
            onStepProgress({ stage: 'imageGen', status: 'complete', candidateId: candidateId_str, imageUrl,
              message: `✓ ${candidateId_str}: Image generated (ready for evaluation)` });
          }

          let evaluation = null;
          let totalScore = null;

          if (!config.skipVisionAnalysis && visionProvider) {
            if (onStepProgress) {
              onStepProgress({ stage: 'vision', status: 'starting', candidateId: candidateId_str,
                message: `🔍 ${candidateId_str}: Analyzing image with vision model...` });
            }

            const imageReference = image.url || image.localPath;
            evaluation = await visionLimiter.execute(() => visionProvider.analyzeImage(imageReference, combined));

            if (tokenTracker && evaluation.metadata?.tokensUsed) {
              tokenTracker.recordUsage({ provider: 'vision', operation: 'analyze', tokens: evaluation.metadata.tokensUsed,
                metadata: { model: evaluation.metadata.model, iteration: 0, candidateId: i, operation: 'analyze' } });
            }

            totalScore = calculateTotalScore(evaluation.alignmentScore, evaluation.aestheticScore, alpha);

            if (onStepProgress) {
              onStepProgress({ stage: 'vision', status: 'complete', candidateId: candidateId_str,
                alignment: evaluation.alignmentScore, aesthetic: evaluation.aestheticScore, totalScore,
                message: `✅ ${candidateId_str}: Evaluation complete - alignment: ${Math.round(evaluation.alignmentScore)}/100, aesthetic: ${evaluation.aestheticScore.toFixed(1)}/10` });
            }
          }

          if (metadataTracker) {
            await metadataTracker.updateAttemptWithResults(0, i, { combined, negativePrompt, negativePromptMetadata: null, image, evaluation, totalScore });
          }

          const candidate = {
            whatPrompt: what, howPrompt: how, combined, image, evaluation, totalScore,
            metadata: { iteration: 0, candidateId: i, dimension: 'what' }
          };

          if (onCandidateProcessed) {
            console.log(`[initialExpansion] Invoking callback for candidate ${i}`);
            onCandidateProcessed(candidate);
          } else {
            console.log(`[initialExpansion] No callback for candidate ${i}`);
          }

          return candidate;
        };

        try {
          return await limitedProcessCandidateStream();
        } catch (error) {
          const candidateId_str = `i0c${i}`;
          console.error(`[initialExpansion] Candidate ${candidateId_str} failed: ${error.message}`);
          if (onStepProgress) {
            onStepProgress({ stage: 'error', status: 'failed', candidateId: candidateId_str,
              message: `⚠️ ${candidateId_str}: Failed - ${error.message}` });
          }
          return null;
        }
      })
    );
  }

  // Filter out failed candidates (nulls)
  const successfulCandidates = candidates.filter(c => c !== null);

  // Check if we have enough candidates to continue
  if (successfulCandidates.length === 0) {
    throw new Error('All candidates failed during initial expansion. Check service logs for details.');
  }

  // Circuit breaker: If too many candidates failed, services are likely broken
  // Default: Fail if >50% of candidates failed
  const failureThreshold = parseFloat(process.env.CANDIDATE_FAILURE_THRESHOLD || '0.5');
  const failedCount = N - successfulCandidates.length;
  const failureRate = failedCount / N;

  if (failureRate > failureThreshold) {
    throw new Error(
      `Candidate failure rate too high during initial expansion: ${Math.round(failureRate * 100)}% ` +
      `(${failedCount}/${N} candidates failed). ` +
      'Services appear to be broken. Stopping beam search to prevent wasting resources.'
    );
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

  // Determine if batch image generation is available (duck-type check)
  const useBatch = typeof imageGenProvider.generateImages === 'function';

  // Helper to get effective descriptiveness
  const getEffectiveDescriptiveness = () => {
    if (config.varyDescriptivenessRandomly) {
      return Math.floor(Math.random() * 3) + 1;
    }
    return config.descriptiveness || 2;
  };

  let allChildren;

  if (useBatch) {
    // === BATCH PATH: Phased execution for batch-capable providers ===
    console.log(`[refinementIteration] Using BATCH image generation for iteration ${iteration}`);

    // Phase 1: Refine + combine all prompts (parallel)
    const refineResults = await Promise.all(
      parentsWithCritiques.flatMap((parent, parentIdx) =>
        Array(expansionRatio).fill().map(async (_, childIdx) => {
          const candidateId = parentIdx * expansionRatio + childIdx;
          const candidateId_str = `i${iteration}c${candidateId}`;

          try {
            if (abortSignal?.aborted) throw new Error('Job cancelled');

            // Refine the selected dimension using critique
            const refinedResult = await llmProvider.refinePrompt(
              dimension === 'what' ? parent.whatPrompt : parent.howPrompt,
              { operation: 'refine', dimension, critique: parent.critique, userPrompt, promptStyle: config.promptStyle, top_p: config.top_p, top_k: config.top_k }
            );

            if (tokenTracker && refinedResult.metadata?.tokensUsed) {
              tokenTracker.recordUsage({ provider: 'llm', operation: 'refine', tokens: refinedResult.metadata.tokensUsed,
                metadata: { model: refinedResult.metadata.model, iteration, candidateId, dimension, operation: 'refine' } });
            }

            const whatPrompt = dimension === 'what' ? refinedResult.refinedPrompt : parent.whatPrompt;
            const howPrompt = dimension === 'how' ? refinedResult.refinedPrompt : parent.howPrompt;

            // Combine prompts
            if (onStepProgress) {
              onStepProgress({ stage: 'combine', status: 'starting', candidateId: candidateId_str,
                message: `🔄 ${candidateId_str}: Combining 'what' + 'how' prompts...` });
            }

            const effectiveDescriptiveness = getEffectiveDescriptiveness();
            const combineResult = await llmProvider.combinePrompts(whatPrompt, howPrompt, { descriptiveness: effectiveDescriptiveness, promptStyle: config.promptStyle, top_p: config.top_p, top_k: config.top_k });
            const combined = combineResult.combinedPrompt;

            if (tokenTracker && combineResult.metadata) {
              tokenTracker.recordUsage({ provider: 'llm', operation: 'combine', tokens: combineResult.metadata.tokensUsed,
                metadata: { model: combineResult.metadata.model, iteration, candidateId, operation: 'combine' } });
            }

            if (onStepProgress) {
              onStepProgress({ stage: 'combine', status: 'complete', candidateId: candidateId_str,
                message: `✓ ${candidateId_str}: Prompts combined` });
            }

            // Generate negative prompt if needed
            let negativePrompt = config.negativePrompt || null;
            if (!negativePrompt && config.autoGenerateNegativePrompts) {
              const modelType = imageGenProvider.modelType || 'unknown';
              const isSDXL = modelType === 'sdxl' || modelType === 'modal';
              console.log(`[${candidateId_str}] Negative prompt check: modelType=${modelType}, isSDXL=${isSDXL}, autoGenerate=${config.autoGenerateNegativePrompts}`);
              if (isSDXL) {
                try {
                  const generator = config.negativePromptGenerator || llmProvider;
                  const negativeResult = await generator.generateNegativePrompt(combined, { enabled: true, fallback: config.negativePromptFallback, promptStyle: config.promptStyle });
                  negativePrompt = negativeResult.negativePrompt;
                  console.log(`[${candidateId_str}] Negative prompt generated: "${negativePrompt?.substring(0, 80)}..."`);
                } catch (err) {
                  negativePrompt = config.negativePromptFallback || 'blurry, low quality, distorted, deformed, artifacts';
                  console.warn(`[${candidateId_str}] Negative prompt generation failed, using fallback: ${err.message}`);
                }
              } else {
                console.log(`[${candidateId_str}] Skipping negative prompt: model type "${modelType}" is not SDXL/modal`);
              }
            } else if (negativePrompt) {
              console.log(`[${candidateId_str}] Using manual negative prompt override`);
            }

            // Record attempt before image gen
            if (metadataTracker) {
              await metadataTracker.recordAttempt({ whatPrompt, howPrompt,
                metadata: { iteration, candidateId, dimension, parentId: parent.metadata.candidateId } });
            }

            return { whatPrompt, howPrompt, combined, negativePrompt, candidateId, parentId: parent.metadata.candidateId, failed: false };
          } catch (error) {
            if (error.message === 'Job cancelled') throw error;
            console.error(`[refinementIteration] Candidate ${candidateId_str} refine/combine failed: ${error.message}`);
            if (onStepProgress) {
              onStepProgress({ stage: 'error', status: 'failed', candidateId: candidateId_str,
                message: `⚠️ ${candidateId_str}: Failed - ${error.message}` });
            }
            return { candidateId, failed: true };
          }
        })
      )
    );

    if (abortSignal?.aborted) throw new Error('Job cancelled');

    const successfulRefines = refineResults.filter(r => !r.failed);
    if (successfulRefines.length === 0) {
      throw new Error(`All candidates failed during refinement iteration ${iteration} prompt phase.`);
    }

    // Phase 2: Batch generate all images
    const sharedGenOptions = {
      sessionId: config.sessionId,
      ...(config.fixFaces && { fix_faces: true, restoration_strength: config.restorationStrength ?? 0.5, face_upscale: config.faceUpscale ?? 1 }),
      ...(config.return_intermediate_images && { return_intermediate_images: true }),
      ...(config.fluxOptions && { steps: config.fluxOptions.steps, guidance: config.fluxOptions.guidance, scheduler: config.fluxOptions.scheduler, width: config.fluxOptions.width, height: config.fluxOptions.height, loraScale: config.fluxOptions.loraScale }),
      ...(config.bflOptions && { safety_tolerance: config.bflOptions.safety_tolerance, width: config.bflOptions.width, height: config.bflOptions.height }),
      ...(config.modalOptions && { model: config.modalOptions.model, width: config.modalOptions.width, height: config.modalOptions.height, steps: config.modalOptions.steps, guidance: config.modalOptions.guidance })
    };

    const batchRequests = successfulRefines.map(r => ({
      prompt: r.combined,
      options: { ...sharedGenOptions, iteration, candidateId: r.candidateId, negativePrompt: r.negativePrompt }
    }));

    for (const r of successfulRefines) {
      if (onStepProgress) {
        onStepProgress({ stage: 'imageGen', status: 'starting', candidateId: `i${iteration}c${r.candidateId}`,
          message: `⬆️  i${iteration}c${r.candidateId}: Generating image (batch)...` });
      }
    }

    await modelCoordinator.prepareForImageGen();
    const batchImages = await imageGenProvider.generateImages(batchRequests);

    // Phase 3: Evaluate all images and build candidates (parallel)
    allChildren = await Promise.all(
      successfulRefines.map(async (r, batchIdx) => {
        const candidateId_str = `i${iteration}c${r.candidateId}`;
        const image = batchImages[batchIdx];

        try {
          if (tokenTracker && image.metadata) {
            tokenTracker.recordUsage({ provider: 'image', operation: 'generate', tokens: 1,
              metadata: { model: image.metadata.model, iteration, candidateId: r.candidateId, dimension, operation: 'generate' } });
          }

          if (onStepProgress) {
            const imageUrl = image.localPath
              ? `/api/images/${config.sessionId}/${image.localPath.split(/[\\/]/).pop()}`
              : image.url;
            onStepProgress({ stage: 'imageGen', status: 'complete', candidateId: candidateId_str, imageUrl,
              message: `✓ ${candidateId_str}: Image generated (ready for evaluation)` });
          }

          let evaluation = null;
          let totalScore = null;

          if (!skipVisionAnalysis && visionProvider) {
            if (onStepProgress) {
              onStepProgress({ stage: 'vision', status: 'starting', candidateId: candidateId_str,
                message: `🔍 ${candidateId_str}: Analyzing image with vision model...` });
            }

            const imageReference = image.url || image.localPath;
            evaluation = await visionLimiter.execute(() => visionProvider.analyzeImage(imageReference, r.combined));

            if (tokenTracker && evaluation.metadata?.tokensUsed) {
              tokenTracker.recordUsage({ provider: 'vision', operation: 'analyze', tokens: evaluation.metadata.tokensUsed,
                metadata: { model: evaluation.metadata.model, iteration, candidateId: r.candidateId, operation: 'analyze' } });
            }

            totalScore = calculateTotalScore(evaluation.alignmentScore, evaluation.aestheticScore, alpha);

            if (onStepProgress) {
              onStepProgress({ stage: 'vision', status: 'complete', candidateId: candidateId_str,
                alignment: evaluation.alignmentScore, aesthetic: evaluation.aestheticScore, totalScore,
                message: `✅ ${candidateId_str}: Evaluation complete - alignment: ${Math.round(evaluation.alignmentScore)}/100, aesthetic: ${evaluation.aestheticScore.toFixed(1)}/10` });
            }
          }

          if (metadataTracker) {
            await metadataTracker.updateAttemptWithResults(iteration, r.candidateId, {
              combined: r.combined, negativePrompt: r.negativePrompt, negativePromptMetadata: null,
              image, evaluation, totalScore
            });
          }

          const candidate = {
            whatPrompt: r.whatPrompt, howPrompt: r.howPrompt, combined: r.combined,
            negativePrompt: r.negativePrompt,
            image, evaluation, totalScore,
            metadata: { iteration, candidateId: r.candidateId, dimension, parentId: r.parentId }
          };

          if (onCandidateProcessed) onCandidateProcessed(candidate);
          return candidate;
        } catch (error) {
          if (error.message === 'Job cancelled') throw error;
          console.error(`[refinementIteration] Candidate ${candidateId_str} evaluation failed: ${error.message}`);
          if (onStepProgress) {
            onStepProgress({ stage: 'error', status: 'failed', candidateId: candidateId_str,
              message: `⚠️ ${candidateId_str}: Failed - ${error.message}` });
          }
          return null;
        }
      })
    );

  } else {
    // === STREAMING PATH: Individual calls for non-batch providers ===
    console.log(`[refinementIteration] Using STREAMING image generation for iteration ${iteration}`);

    allChildren = await Promise.all(
      parentsWithCritiques.flatMap((parent, parentIdx) =>
        Array(expansionRatio).fill().map(async (_, childIdx) => {
          const candidateId = parentIdx * expansionRatio + childIdx;
          const candidateId_str = `i${iteration}c${candidateId}`;

          try {
            if (abortSignal?.aborted) throw new Error('Job cancelled');

            const refinedResult = await llmProvider.refinePrompt(
              dimension === 'what' ? parent.whatPrompt : parent.howPrompt,
              { operation: 'refine', dimension, critique: parent.critique, userPrompt, promptStyle: config.promptStyle, top_p: config.top_p, top_k: config.top_k }
            );

            if (tokenTracker && refinedResult.metadata?.tokensUsed) {
              tokenTracker.recordUsage({ provider: 'llm', operation: 'refine', tokens: refinedResult.metadata.tokensUsed,
                metadata: { model: refinedResult.metadata.model, iteration, candidateId, dimension, operation: 'refine' } });
            }

            const whatPrompt = dimension === 'what' ? refinedResult.refinedPrompt : parent.whatPrompt;
            const howPrompt = dimension === 'how' ? refinedResult.refinedPrompt : parent.howPrompt;

            const candidate = await processCandidateStream(
              whatPrompt, howPrompt, llmProvider, imageGenProvider, visionProvider,
              {
                iteration, candidateId, dimension,
                parentId: parent.metadata.candidateId,
                alpha, metadataTracker, tokenTracker, skipVisionAnalysis, onStepProgress,
                descriptiveness: config.descriptiveness,
                varyDescriptivenessRandomly: config.varyDescriptivenessRandomly,
                promptStyle: config.promptStyle,
                sessionId: config.sessionId,
                autoGenerateNegativePrompts: config.autoGenerateNegativePrompts,
                negativePrompt: config.negativePrompt,
                negativePromptFallback: config.negativePromptFallback,
                ...(config.fixFaces && { fixFaces: config.fixFaces, restorationStrength: config.restorationStrength, faceUpscale: config.faceUpscale }),
                ...(config.fluxOptions && { fluxOptions: config.fluxOptions }),
                ...(config.bflOptions && { bflOptions: config.bflOptions }),
                ...(config.modalOptions && { modalOptions: config.modalOptions })
              }
            );

            if (onCandidateProcessed) onCandidateProcessed(candidate);
            return candidate;
          } catch (error) {
            if (error.message === 'Job cancelled') throw error;
            console.error(`[refinementIteration] Candidate ${candidateId_str} failed: ${error.message}`);
            if (onStepProgress) {
              onStepProgress({ stage: 'error', status: 'failed', candidateId: candidateId_str,
                message: `⚠️ ${candidateId_str}: Failed - ${error.message}` });
            }
            return null;
          }
        })
      )
    );
  }

  // Filter out failed candidates (nulls)
  const successfulChildren = allChildren.filter(c => c !== null);

  // Check if we have enough candidates to continue
  if (successfulChildren.length === 0) {
    throw new Error(`All candidates failed during refinement iteration ${iteration}. Check service logs for details.`);
  }

  // Circuit breaker: If too many candidates failed, services are likely broken
  // Default: Fail if >50% of candidates failed
  const failureThreshold = parseFloat(process.env.CANDIDATE_FAILURE_THRESHOLD || '0.5');
  const failedCount = allChildren.length - successfulChildren.length;
  const failureRate = failedCount / allChildren.length;

  if (failureRate > failureThreshold) {
    throw new Error(
      `Candidate failure rate too high in iteration ${iteration}: ${Math.round(failureRate * 100)}% ` +
      `(${failedCount}/${allChildren.length} candidates failed). ` +
      'Services appear to be broken. Stopping beam search to prevent wasting resources.'
    );
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
  // Note: Check for both null and undefined (null !== undefined is true!)
  const useComparativeRanking = imageRanker != null;

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
    // Hold GPU lock during entire VLM ranking to prevent model switching mid-operation
    rankingResults = await modelCoordinator.withVLMOperation(async () => {
      return await rankAndSelectComparative(candidates, keepTop, imageRanker, userPrompt, { ensembleSize, tokenTracker, onStepProgress });
    });
    topCandidates = rankingResults.topCandidates;
    // Update candidates array to include ranking data for metadata tracking
    candidates = rankingResults.allRanked;

    // Compute global ranks for iteration 0
    const globalRanked = computeGlobalRanks(rankingResults.allRanked, [], floorRank, 0);
    allGlobalRanked = globalRanked;

    // Persist AI ranking data
    if (metadataTracker && imageRanker?.getComparisonGraph) {
      await metadataTracker.recordIterationRanking(0, {
        rankings: rankingResults.allRanked.map(c => ({
          candidateId: `i${c.metadata.iteration}c${c.metadata.candidateId}`,
          rank: c.ranking?.rank,
          wins: c.ranking?.aggregateStats?.wins || 0,
          losses: c.ranking?.aggregateStats?.losses || 0
        })),
        comparisons: imageRanker.getComparisonGraph().toJSON(),
        globalRanked: globalRanked.map(c => ({
          candidateId: `i${c.metadata.iteration}c${c.metadata.candidateId}`,
          globalRank: c.globalRank
        }))
      });
    }

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
          negativePrompt: candidate.negativePrompt,
          negativePromptMetadata: candidate.negativePromptMetadata,
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
  // Track early termination reason if we need to stop gracefully
  let earlyTerminationReason = null;

  for (let iteration = 1; iteration < maxIterations; iteration++) {
    // Unload VLM (from previous ranking) before LLM operations
    await modelCoordinator.prepareForLLM();

    // Generate N children from M parents
    // Note: onCandidateProcessed is called inside refinementIteration as each candidate completes
    try {
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
    } catch (error) {
      // Check if this is a failure-related error we should handle gracefully
      const isHighFailureRate = error.message && error.message.includes('failure rate too high');
      const isAllCandidatesFailed = error.message && error.message.includes('All candidates failed');

      if (isHighFailureRate || isAllCandidatesFailed) {
        console.log(`[beamSearch] ⚠️ Early termination: ${error.message}`);
        console.log(`[beamSearch] Returning best results from iteration ${iteration - 1}`);
        earlyTerminationReason = error.message;
        break; // Exit loop gracefully with current topCandidates
      }
      // Re-throw other errors
      throw error;
    }

    // Rank and select top M for next iteration
    // Include both parents and children to ensure best from ANY iteration survives
    const allCandidates = [...topCandidates, ...candidates];

    // Use comparative ranking if imageRanker provided, otherwise use score-based ranking
    if (useComparativeRanking) {
      // Hold GPU lock during entire VLM ranking to prevent model switching mid-operation
      const previousTop = topCandidates;
      const iterationRankingResults = await modelCoordinator.withVLMOperation(async () => {
        return await rankAndSelectComparative(allCandidates, keepTop, imageRanker, userPrompt, { previousTopCandidates: previousTop, ensembleSize, tokenTracker, onStepProgress });
      });
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

      // Persist AI ranking data for this iteration
      if (metadataTracker && imageRanker?.getComparisonGraph) {
        await metadataTracker.recordIterationRanking(iteration, {
          rankings: iterationRankingResults.allRanked.map(c => ({
            candidateId: `i${c.metadata.iteration}c${c.metadata.candidateId}`,
            rank: c.ranking?.rank,
            wins: c.ranking?.aggregateStats?.wins || 0,
            losses: c.ranking?.aggregateStats?.losses || 0
          })),
          comparisons: imageRanker.getComparisonGraph().toJSON(),
          globalRanked: globalRanked.map(c => ({
            candidateId: `i${c.metadata.iteration}c${c.metadata.candidateId}`,
            globalRank: c.globalRank
          }))
        });
      }

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
            negativePrompt: candidate.negativePrompt,
            negativePromptMetadata: candidate.negativePromptMetadata,
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

    // Persist final global ranking
    if (useComparativeRanking) {
      await metadataTracker.recordFinalGlobalRanking(
        allGlobalRanked.map(c => ({
          candidateId: `i${c.metadata.iteration}c${c.metadata.candidateId}`,
          globalRank: c.globalRank,
          iteration: c.metadata.iteration,
          localId: c.metadata.candidateId
        }))
      );
    }
  }

  // Sort all global ranked candidates by their global rank for final display
  allGlobalRanked.sort((a, b) => a.globalRank - b.globalRank);

  // Return best candidate with all finalists and complete global ranking
  // Attach finalists to winner for backward compatibility
  winner.finalists = topCandidates;
  winner.allGlobalRanked = allGlobalRanked;

  // Include early termination info if we stopped due to high failure rate
  if (earlyTerminationReason) {
    winner.earlyTermination = {
      reason: earlyTerminationReason,
      stoppedAtIteration: winner.metadata.iteration
    };
  }

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
  beamSearch,
  configureRateLimitsForProviders
};
