/**
 * @file Beam Search Worker
 * Runs beam search jobs in the background with WebSocket progress updates
 */

import { emitProgress } from './server.js';
import { getRuntimeProviders } from './provider-routes.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { beamSearch, configureRateLimitsForProviders } = require('../orchestrator/beam-search.js');
const MetadataTracker = require('../services/metadata-tracker.js');
const TokenTracker = require('../utils/token-tracker.js');
const { MODEL_PRICING } = require('../config/model-pricing.js');
const { getDateString } = require('../utils/timezone.js');
const providerConfig = require('../config/provider-config.js');
const path = require('path');

// Read output directory from environment (set in .env on production)
// Falls back to session-history/ for local development
const OUTPUT_DIR = process.env.SESSION_HISTORY_DIR ||
                   process.env.IMAGES_DIR ||
                   path.join(process.cwd(), 'session-history');

// Store active jobs
const activeJobs = new Map();
// Map jobId to sessionId/metadata info
const jobMetadataMap = new Map();
// Map jobId to AbortController for cancellation
const jobAbortControllers = new Map();

/**
 * Start a beam search job in the background
 * @param {string} jobId - Unique job identifier
 * @param {Object} params - Job parameters
 * @param {string} params.prompt - User prompt
 * @param {number} [params.n=4] - Beam width (number of candidates per iteration)
 * @param {number} [params.m=2] - Keep top M candidates
 * @param {number} [params.iterations=2] - Maximum iterations
 * @param {number} [params.alpha=0.7] - Scoring weight for alignment
 * @param {number} [params.temperature=0.7] - Temperature for variation
 * @param {string} userApiKey - User-provided OpenAI API key (required, no fallback)
 * @returns {Promise<void>}
 */
export async function startBeamSearchJob(jobId, params, userApiKey) {
  const {
    prompt,
    n = 4,
    m = 2,
    iterations = 2,
    alpha = 0.7,
    temperature = 0.7,
    models,
    fluxOptions,
    bflOptions,
    modalOptions,
    loraOptions,
    rankingMode = 'vlm'  // 'vlm' (LocalVLMProvider tournament) or 'scoring' (CLIP/aesthetic only)
  } = params;

  // Log BFL options if provided
  if (bflOptions) {
    console.log(`[Beam Search Worker] Received bflOptions: model=${bflOptions.model || 'default'}, safety_tolerance=${bflOptions.safety_tolerance}, width=${bflOptions.width}, height=${bflOptions.height}, steps=${bflOptions.steps || 'default'}, guidance=${bflOptions.guidance || 'default'}`);
  }

  // Log Modal options if provided
  if (modalOptions) {
    console.log(`[Beam Search Worker] Received modalOptions: model=${modalOptions.model || 'default'}, steps=${modalOptions.steps || 'default'}, guidance=${modalOptions.guidance || 'default'}, gpu=${modalOptions.gpu || 'default'}`);
  }

  // Log LoRA options if provided
  if (loraOptions) {
    console.log(`[Beam Search Worker] Received loraOptions: path=${loraOptions.path}, scale=${loraOptions.scale}`);
  }

  // Get runtime provider selections early to check if OpenAI is needed
  const runtimeProviders = getRuntimeProviders();

  // Check if any OpenAI-based providers are being used
  const needsOpenAI = runtimeProviders.llm === 'openai' ||
                      runtimeProviders.image === 'openai' ||
                      runtimeProviders.image === 'dalle' ||
                      runtimeProviders.vision === 'openai' ||
                      runtimeProviders.vision === 'gpt-vision';

  // Only require API key if using OpenAI providers AND not in mock mode
  const isMockMode = providerConfig.mode === 'mock';
  if (needsOpenAI && !isMockMode) {
    if (!userApiKey || typeof userApiKey !== 'string' || userApiKey.trim() === '') {
      throw new Error('OpenAI API key is required when using OpenAI providers. Switch to local providers or provide an API key.');
    }
  }

  // Generate session ID in ses-HHMMSS format
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const sessionId = `ses-${hours}${minutes}${seconds}`;

  // Initialize metadata tracker
  const metadataTracker = new MetadataTracker({
    outputDir: OUTPUT_DIR,
    sessionId,
    userPrompt: prompt,
    config: { beamWidth: n, keepTop: m, maxIterations: iterations, alpha, temperature }
  });
  await metadataTracker.initialize();

  // Initialize token tracker for cost tracking
  const tokenTracker = new TokenTracker({
    sessionId,
    pricing: MODEL_PRICING
  });

  // Create abort controller for this job (enables cancellation)
  const abortController = new AbortController();
  jobAbortControllers.set(jobId, abortController);

  // Map jobId to sessionId and trackers for later retrieval
  jobMetadataMap.set(jobId, { sessionId, metadataTracker, tokenTracker });

  // Mark job as running
  activeJobs.set(jobId, { status: 'running', startTime: Date.now(), sessionId, tokenTracker });

  try {
    // Create providers using factory (CommonJS module)
    const {
      createLLMProvider,
      createImageProvider,
      createVisionProvider,
      createCritiqueGenerator,
      createImageRanker,
      createVLMProvider
    } = require('../factory/provider-factory.js');

    // Create LLM provider first so it can be passed to image provider for rephrasing
    const llmProvider = createLLMProvider({
      mode: 'real',
      provider: runtimeProviders.llm,
      apiKey: userApiKey,
      ...(models?.llm && { model: models.llm })
    });

    const providers = {
      llm: llmProvider,
      imageGen: createImageProvider({
        mode: 'real',
        provider: runtimeProviders.image,
        apiKey: userApiKey,
        llmProvider: llmProvider,  // Pass LLM for content moderation rephrasing (BFL)
        ...(models?.imageGen && { model: models.imageGen })
      }),
      vision: createVisionProvider({
        mode: 'real',
        provider: runtimeProviders.vision,
        apiKey: userApiKey,
        ...(models?.vision && { model: models.vision })
      }),
      // CritiqueGen requires OpenAI - use real if available, otherwise use mock
      critiqueGen: needsOpenAI ? createCritiqueGenerator({
        mode: 'real',
        apiKey: userApiKey,
        ...(models?.llm && { model: models.llm })
      }) : createCritiqueGenerator({
        mode: 'mock'
      }),
      // ImageRanker depends on rankingMode:
      // - 'vlm': Use LocalVLMProvider for pairwise tournament ranking
      // - 'scoring': No pairwise ranking, fall back to CLIP/aesthetic scoring
      imageRanker: rankingMode === 'vlm' ? createVLMProvider({
        mode: 'real'
      }) : (rankingMode === 'scoring' ? null : (needsOpenAI ? createImageRanker({
        mode: 'real',
        apiKey: userApiKey,
        ...(models?.vision && { model: models.vision })
      }) : null))
    };

    // Configure rate limiters based on provider types
    // Local providers process sequentially, so use concurrency=1
    const isLocalLLM = runtimeProviders.llm === 'local-llm' || runtimeProviders.llm === 'ollama';
    const isLocalImage = runtimeProviders.image === 'flux' || runtimeProviders.image === 'local';
    const isLocalVision = runtimeProviders.vision === 'local';
    configureRateLimitsForProviders({
      llmIsLocal: isLocalLLM,
      imageIsLocal: isLocalImage,
      visionIsLocal: isLocalVision
    });

    // Emit start event with provider info
    emitProgress(jobId, {
      type: 'started',
      timestamp: new Date().toISOString(),
      params: { prompt, n, m, iterations, alpha, temperature },
      providers: runtimeProviders
    });

    // Warn user if using expensive fallback image model
    const imageModel = providers.imageGen.model;
    const orgRegistered = process.env.OPENAI_ORG_REGISTERED_FOR_GPT5_IMAGE === 'true';
    if (imageModel === 'gpt-image-1' && !orgRegistered && !models?.imageGen) {
      emitProgress(jobId, {
        type: 'warning',
        timestamp: new Date().toISOString(),
        message: '⚠️ Using gpt-image-1 (higher cost). To use gpt-5-image-mini, set OPENAI_ORG_REGISTERED_FOR_GPT5_IMAGE=true or specify model explicitly.',
        details: {
          currentModel: 'gpt-image-1',
          suggestedModel: 'gpt-5-image-mini',
          reason: 'Organization not registered for gpt-5-image-mini access'
        }
      });
    }

    // Configure beam search with progress callbacks
    const config = {
      beamWidth: n,
      keepTop: m,
      maxIterations: iterations,
      alpha,
      temperature,
      ...(fluxOptions && { fluxOptions }), // Pass Flux generation options (steps, guidance)
      ...(bflOptions && { bflOptions }),   // Pass BFL generation options (safety_tolerance, width, height, model, steps, guidance, seed, output_format)
      ...(modalOptions && { modalOptions }), // Pass Modal generation options (model, steps, guidance, gpu, seed)
      ...(loraOptions && { loraOptions }), // Pass LoRA options (path, scale) for Flux provider
      sessionId,       // Pass session ID for image URL construction
      metadataTracker, // Pass metadata tracker to beam search
      tokenTracker,    // Pass token tracker for cost tracking
      abortSignal: abortController.signal, // Pass abort signal for cancellation
      // Step-level progress callback - called during candidate processing
      onStepProgress: (stepData) => {
        const { stage, status, candidateId, message, imageUrl, alignment, aesthetic, totalScore } = stepData;

        // Emit progress message for this step
        emitProgress(jobId, {
          type: 'step',
          stage,
          status,
          candidateId,
          message,
          imageUrl,
          alignment: alignment !== undefined ? Math.round(alignment) : null,
          aesthetic: aesthetic !== undefined ? aesthetic.toFixed(1) : null,
          totalScore: totalScore !== undefined ? totalScore.toFixed(2) : null,
          timestamp: new Date().toISOString()
        });

        // When image generation completes, also emit a candidate message so image appears in gallery immediately
        if (stage === 'imageGen' && status === 'complete' && imageUrl) {
          const [iteration, candidateNum] = candidateId.match(/i(\d+)c(\d+)/).slice(1).map(Number);
          emitProgress(jobId, {
            type: 'candidate',
            iteration,
            candidateId: candidateNum,
            imageUrl,
            timestamp: new Date().toISOString()
          });
        }
      },
      // Progress callback - called after each iteration
      onIterationComplete: (iterationData) => {
        // Get current token usage for cost tracking
        const stats = tokenTracker.getStats();
        const cost = tokenTracker.getEstimatedCost();
        emitProgress(jobId, {
          type: 'iteration',
          iteration: iterationData.iteration,
          totalIterations: iterations,
          candidatesCount: iterationData.candidates.length,
          bestScore: iterationData.topCandidates[0]?.totalScore || 0,
          tokenUsage: {
            total: stats.totalTokens,
            llm: stats.llmTokens,
            vision: stats.visionTokens,
            critique: stats.critiqueTokens,
            imageGen: stats.imageGenTokens
          },
          estimatedCost: {
            total: cost.total,
            llm: cost.llm,
            vision: cost.vision,
            critique: cost.critique,
            imageGen: cost.imageGen
          },
          timestamp: new Date().toISOString()
        });
      },
      // Candidate progress callback - called for each candidate generated
      onCandidateProcessed: (candidate) => {
        // Determine operation type based on iteration
        const operationType = candidate.metadata.iteration === 0 ? 'expansion' : 'refinement';
        const candidateId = `i${candidate.metadata.iteration}c${candidate.metadata.candidateId}`;

        console.log(`[Beam Search] Candidate processed: ${candidateId} (${operationType})`);

        // Emit progress message to show this candidate is being processed/completed
        emitProgress(jobId, {
          type: 'operation',
          operation: operationType,
          candidateId,
          status: 'completed',
          message: `✓ ${candidateId}: Image generated, evaluating...`,
          timestamp: new Date().toISOString()
        });

        // Emit step message with current token counts
        const currentStats = tokenTracker.getStats();
        const currentCost = tokenTracker.getEstimatedCost();
        emitProgress(jobId, {
          type: 'step',
          candidateId,
          operation: operationType,
          message: `Processed ${candidateId}: ${currentStats.llmTokens || 0} LLM tokens, ${currentStats.visionTokens || 0} vision tokens`,
          tokenUsage: {
            total: currentStats.totalTokens,
            llm: currentStats.llmTokens,
            vision: currentStats.visionTokens,
            critique: currentStats.critiqueTokens,
            imageGen: currentStats.imageGenTokens
          },
          estimatedCost: {
            total: currentCost.total,
            llm: currentCost.llm,
            vision: currentCost.vision,
            critique: currentCost.critique,
            imageGen: currentCost.imageGen
          },
          timestamp: new Date().toISOString()
        });

        // Emit operation start message (once per candidate)
        emitProgress(jobId, {
          type: 'operation',
          operation: operationType,
          candidateId,
          status: 'processing',
          message: `Running ${operationType} for ${candidateId}`,
          timestamp: new Date().toISOString()
        });

        // Build image URL - prefer local path to avoid OpenAI URL expiration
        let imageUrl = null;
        if (candidate.image?.localPath) {
          // Extract filename from path (e.g., "iter0-cand0.png")
          const filename = candidate.image.localPath.split(/[\\/]/).pop();
          // Use API endpoint to serve from disk: /api/images/ses-HHMMSS/iter0-cand0.png
          imageUrl = `/api/images/${sessionId}/${filename}`;
          console.log(`[Beam Search] Image URL: ${imageUrl} (local)`);
        } else if (candidate.image?.url) {
          // Fallback to OpenAI URL (will expire after ~1 hour)
          imageUrl = candidate.image.url;
          console.log(`[Beam Search] Image URL: ${imageUrl} (OpenAI - will expire)`);
        }

        // Emit candidate message with complete data including lineage
        emitProgress(jobId, {
          type: 'candidate',
          iteration: candidate.metadata.iteration,
          candidateId: candidate.metadata.candidateId,
          parentId: candidate.metadata.parentId || null,  // Include lineage information
          // Support both modes
          score: candidate.totalScore,              // Legacy: numeric score (or null)
          ranking: candidate.ranking,               // Modern: rank object with reason
          imageUrl,                                 // Use local path if available
          whatPrompt: candidate.whatPrompt,
          howPrompt: candidate.howPrompt,
          combined: candidate.combined,
          timestamp: new Date().toISOString()
        });
      },
      // Ranking callback - called after ranking phase completes with all ranked candidates
      onRankingComplete: (rankingData) => {
        const { iteration, rankedCandidates, allGlobalRanked } = rankingData;
        // Emit ranking updates for all ranked candidates (includes global rank)
        rankedCandidates.forEach(candidate => {
          if (candidate.ranking) {
            emitProgress(jobId, {
              type: 'ranked',
              iteration: candidate.metadata.iteration,
              candidateId: candidate.metadata.candidateId,
              rank: candidate.ranking.rank,
              globalRank: candidate.globalRank,
              globalRankNote: candidate.globalRankNote,
              reason: candidate.ranking.reason,
              strengths: candidate.ranking.strengths,
              weaknesses: candidate.ranking.weaknesses,
              timestamp: new Date().toISOString()
            });
          }
        });

        // Emit complete global ranking list for final display
        if (allGlobalRanked && allGlobalRanked.length > 0) {
          emitProgress(jobId, {
            type: 'globalRanking',
            iteration,
            candidates: allGlobalRanked.map(c => ({
              iteration: c.metadata.iteration,
              candidateId: c.metadata.candidateId,
              globalRank: c.globalRank,
              globalRankNote: c.globalRankNote,
              imageUrl: c.image?.localPath
                ? `/api/images/${sessionId}/${c.image.localPath.split(/[\\/]/).pop()}`
                : c.image?.url
            })),
            timestamp: new Date().toISOString()
          });
        }
      }
    };

    // Run beam search with auto-rephrase on safety violations
    let result;
    let currentPrompt = prompt;
    let rephraseAttempted = false;

    console.log(`[Beam Search] Starting job ${jobId} with config:`, {
      beamWidth: n,
      keepTop: m,
      maxIterations: iterations,
      hasOnCandidateProcessed: !!config.onCandidateProcessed,
      hasOnIterationComplete: !!config.onIterationComplete,
      hasOnRankingComplete: !!config.onRankingComplete
    });

    // Emit expansion phase start message - users see this immediately
    emitProgress(jobId, {
      type: 'operation',
      operation: 'expansion',
      status: 'starting',
      message: `🚀 Expansion phase starting: generating ${n} candidates...`,
      timestamp: new Date().toISOString()
    });

    try {
      result = await beamSearch(currentPrompt, providers, config);
    } catch (error) {
      // Check if this is a safety violation error
      const isSafetyViolation = error.message?.includes('safety') || error.message?.includes('safety_violations');

      if (isSafetyViolation && !rephraseAttempted) {
        // Emit rephrase attempt message
        emitProgress(jobId, {
          type: 'operation',
          message: 'Safety check triggered - attempting to rephrase prompt...',
          status: 'rephrasing',
          timestamp: new Date().toISOString()
        });

        try {
          // Use LLM to suggest a safer rephrase of the original prompt
          const rephrasePrompt = `The following image generation prompt was flagged by a content safety system.
Please rephrase it to be more appropriate while maintaining the user's original intent:

Original prompt: "${prompt}"

Provide ONLY the rephrased prompt, nothing else.`;

          const rephrased = await providers.llm.generateText(rephrasePrompt, {
            maxTokens: 150,
            temperature: 0.7
          });

          currentPrompt = rephrased.trim();
          rephraseAttempted = true;

          // Emit rephrase success message
          emitProgress(jobId, {
            type: 'operation',
            message: '✓ Prompt rephrased - retrying with safer version',
            status: 'processing',
            timestamp: new Date().toISOString()
          });

          // Retry beam search with rephrased prompt
          result = await beamSearch(currentPrompt, providers, config);

          // Emit note that rephrasing helped
          emitProgress(jobId, {
            type: 'operation',
            message: '✓ Rephrased prompt accepted - proceeding with beam search',
            status: 'success',
            timestamp: new Date().toISOString()
          });
        } catch (_e) { // eslint-disable-line no-unused-vars
          // If rephrase attempt fails, throw the original error
          throw error;
        }
      } else {
        // Not a safety violation, or already attempted rephrase, re-throw
        throw error;
      }
    }

    // Mark final winner in metadata and get full metadata with lineage
    if (metadataTracker) {
      metadataTracker.markFinalWinner({
        iteration: result.metadata?.iteration,
        candidateId: result.metadata?.candidateId
      });
    }

    // Get full metadata including lineage for emission
    const fullMetadata = metadataTracker ? await metadataTracker.getMetadata() : null;

    // Emit completion event with date for image URL construction
    // Include allGlobalRanked for final ranking display
    const allGlobalRanked = result.allGlobalRanked || [];
    // Extract date from metadata timestamp (when session was created)
    const sessionDate = fullMetadata?.timestamp
      ? fullMetadata.timestamp.split('T')[0]  // Extract YYYY-MM-DD from ISO timestamp
      : getDateString();  // Fallback to today if no timestamp
    emitProgress(jobId, {
      type: 'complete',
      timestamp: new Date().toISOString(),
      result: {
        bestCandidate: {
          what: result.whatPrompt,
          how: result.howPrompt,
          combined: result.combined,
          totalScore: result.totalScore,
          imageUrl: result.image.url
        }
      },
      metadata: fullMetadata ? {
        lineage: fullMetadata.lineage,
        sessionId: fullMetadata.sessionId,
        userPrompt: fullMetadata.userPrompt, // Include user prompt for job history
        finalWinner: fullMetadata.finalWinner,
        date: sessionDate, // Use session's actual creation date, not today
        allGlobalRanked: allGlobalRanked.map(c => ({
          iteration: c.metadata.iteration,
          candidateId: c.metadata.candidateId,
          globalRank: c.globalRank,
          globalRankNote: c.globalRankNote,
          imageUrl: c.image?.localPath
            ? `/api/images/${sessionId}/${c.image.localPath.split(/[\\/]/).pop()}`
            : c.image?.url
        }))
      } : null
    });

    // Update job status
    activeJobs.set(jobId, {
      status: 'completed',
      startTime: activeJobs.get(jobId).startTime,
      endTime: Date.now(),
      result
    });

  } catch (error) {
    // Check if this is a cancellation (AbortError)
    const isCancelled = error.name === 'AbortError' || error.message === 'Job cancelled';

    // Emit appropriate event
    if (isCancelled) {
      emitProgress(jobId, {
        type: 'cancelled',
        timestamp: new Date().toISOString(),
        message: 'Job was cancelled by user'
      });

      // Update job status
      activeJobs.set(jobId, {
        status: 'cancelled',
        startTime: activeJobs.get(jobId).startTime,
        endTime: Date.now()
      });
    } else {
      // Regular error
      emitProgress(jobId, {
        type: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      });

      // Update job status
      activeJobs.set(jobId, {
        status: 'failed',
        startTime: activeJobs.get(jobId).startTime,
        endTime: Date.now(),
        error: error.message
      });
    }
  } finally {
    // Clean up abort controller
    jobAbortControllers.delete(jobId);
  }
}

/**
 * Get job status
 * @param {string} jobId - Job identifier
 * @returns {Object|null} Job status or null if not found
 */
export function getJobStatus(jobId) {
  return activeJobs.get(jobId) || null;
}

/**
 * Get all active jobs
 * @returns {Map} Map of active jobs
 */
export function getActiveJobs() {
  return activeJobs;
}

/**
 * Get metadata for a job by jobId
 * @param {string} jobId - Job identifier
 * @returns {Promise<Object|null>} Metadata object or null if not found
 */
export async function getJobMetadata(jobId) {
  const metadataInfo = jobMetadataMap.get(jobId);
  if (!metadataInfo) {
    return null;
  }

  const { metadataTracker } = metadataInfo;
  const metadata = await metadataTracker.getMetadata();

  // Enrich metadata with job result if job is completed
  const jobStatus = activeJobs.get(jobId);
  if (jobStatus && jobStatus.status === 'completed' && jobStatus.result) {
    const result = jobStatus.result;

    // Add winner information
    if (result) {
      metadata.winner = {
        candidateId: result.metadata?.candidateId || 0,
        iteration: result.metadata?.iteration || 0,
        whatPrompt: result.whatPrompt || '',
        howPrompt: result.howPrompt || '',
        combined: result.combined || '',
        totalScore: result.totalScore || 0
      };

      // Add finalists (winner + runner-up if available)
      if (result.finalists && result.finalists.length > 0) {
        metadata.finalists = result.finalists.map(finalist => ({
          candidateId: finalist.metadata?.candidateId || 0,
          iteration: finalist.metadata?.iteration || 0,
          whatPrompt: finalist.whatPrompt || '',
          howPrompt: finalist.howPrompt || '',
          combined: finalist.combined || '',
          totalScore: finalist.totalScore || 0,
          ranking: finalist.ranking
        }));
      }
    }
  }

  return metadata;
}

/**
 * Cancel a running beam search job
 * @param {string} jobId - Job identifier
 * @returns {boolean} True if job was cancelled, false if not found or already complete
 */
export function cancelBeamSearchJob(jobId) {
  const abortController = jobAbortControllers.get(jobId);

  if (!abortController) {
    // Job not found or already completed
    return false;
  }

  // Abort all pending operations
  abortController.abort();

  console.log(`[Beam Search] Job ${jobId} cancellation requested`);
  return true;
}
