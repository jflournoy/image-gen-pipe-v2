/**
 * @file Beam Search Worker
 * Runs beam search jobs in the background with WebSocket progress updates
 */

import { emitProgress } from './server.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { beamSearch } = require('../orchestrator/beam-search.js');
const MetadataTracker = require('../services/metadata-tracker.js');
const TokenTracker = require('../utils/token-tracker.js');
const { MODEL_PRICING } = require('../config/model-pricing.js');

// Store active jobs
const activeJobs = new Map();
// Map jobId to sessionId/metadata info
const jobMetadataMap = new Map();

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
 * @returns {Promise<void>}
 */
export async function startBeamSearchJob(jobId, params) {
  const {
    prompt,
    n = 4,
    m = 2,
    iterations = 2,
    alpha = 0.7,
    temperature = 0.7
  } = params;

  // Generate session ID in ses-HHMMSS format
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const sessionId = `ses-${hours}${minutes}${seconds}`;

  // Initialize metadata tracker
  const metadataTracker = new MetadataTracker({
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
      createCritiqueGenerator
    } = require('../factory/provider-factory.js');

    const providers = {
      llm: createLLMProvider(),
      imageGen: createImageProvider(),
      vision: createVisionProvider(),
      critiqueGen: createCritiqueGenerator()
    };

    // Emit start event
    emitProgress(jobId, {
      type: 'started',
      timestamp: new Date().toISOString(),
      params: { prompt, n, m, iterations, alpha, temperature }
    });

    // Configure beam search with progress callbacks
    const config = {
      beamWidth: n,
      keepTop: m,
      maxIterations: iterations,
      alpha,
      temperature,
      metadataTracker, // Pass metadata tracker to beam search
      tokenTracker,    // Pass token tracker for cost tracking
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
        emitProgress(jobId, {
          type: 'candidate',
          iteration: candidate.metadata.iteration,
          candidateId: candidate.metadata.candidateId,
          score: candidate.totalScore,
          imageUrl: candidate.image?.url || null,
          whatPrompt: candidate.whatPrompt,
          howPrompt: candidate.howPrompt,
          combined: candidate.combined,
          timestamp: new Date().toISOString()
        });
      }
    };

    // Run beam search
    const result = await beamSearch(prompt, providers, config);

    // Emit completion event
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
      }
    });

    // Update job status
    activeJobs.set(jobId, {
      status: 'completed',
      startTime: activeJobs.get(jobId).startTime,
      endTime: Date.now(),
      result
    });

  } catch (error) {
    // Emit error event
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
