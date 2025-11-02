/**
 * @file Beam Search Worker
 * Runs beam search jobs in the background with WebSocket progress updates
 */

import { emitProgress } from './server.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { beamSearch } = require('../orchestrator/beam-search.js');

// Store active jobs
const activeJobs = new Map();

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

  // Mark job as running
  activeJobs.set(jobId, { status: 'running', startTime: Date.now() });

  try {
    // Create providers using factory (CommonJS module)
    const { createProviderFactory } = require('../factory/provider-factory.js');
    const factory = createProviderFactory();
    const providers = {
      llm: factory.createLLMProvider(),
      imageGen: factory.createImageProvider(),
      vision: factory.createVisionProvider(),
      critiqueGen: factory.createCritiqueGenerator()
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
      // Progress callback - called after each iteration
      onIterationComplete: (iterationData) => {
        emitProgress(jobId, {
          type: 'iteration',
          iteration: iterationData.iteration,
          totalIterations: iterations,
          candidatesCount: iterationData.candidates.length,
          bestScore: iterationData.topCandidates[0]?.totalScore || 0,
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
