/**
 * @file Evaluation Routes
 * Express routes for Human-in-the-Loop (HITL) evaluation
 * Supports pairwise comparison of beam search candidates
 *
 * PRIVACY: Session selection happens client-side via localStorage.
 * Users can only evaluate their own sessions (stored in browser).
 * These routes only handle the evaluation process itself (comparisons, progress, export).
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EvaluationTracker = require('../services/evaluation-tracker.js');

const router = express.Router();

// Get output directory from environment
const OUTPUT_DIR = process.env.SESSION_HISTORY_DIR ||
                   process.env.IMAGES_DIR ||
                   path.join(process.cwd(), 'session-history');

/**
 * Helper: Find all session directories across all dates
 * @returns {Promise<Array<Object>>} Array of {date, sessionId, path}
 */
async function findAllSessions() {
  const sessions = [];

  try {
    // Read all date directories (YYYY-MM-DD)
    const dates = await fsPromises.readdir(OUTPUT_DIR);

    for (const date of dates) {
      const datePath = path.join(OUTPUT_DIR, date);
      const stat = await fsPromises.stat(datePath);

      if (stat.isDirectory()) {
        // Read session directories within this date
        const sessionDirs = await fsPromises.readdir(datePath);

        for (const sessionId of sessionDirs) {
          const sessionPath = path.join(datePath, sessionId);
          const sessionStat = await fsPromises.stat(sessionPath);

          if (sessionStat.isDirectory()) {
            sessions.push({ date, sessionId, path: sessionPath });
          }
        }
      }
    }
  } catch (error) {
    console.error('[EvalRoutes] Error finding sessions:', error);
  }

  return sessions;
}

/**
 * Helper: Load metadata for a session
 * @param {string} sessionPath - Path to session directory
 * @returns {Promise<Object|null>} Metadata object or null if not found
 */
async function loadSessionMetadata(sessionPath) {
  try {
    const metadataPath = path.join(sessionPath, 'metadata.json');
    const json = await fsPromises.readFile(metadataPath, 'utf8');
    return JSON.parse(json);
  } catch (error) {
    console.error(`[EvalRoutes] Error loading metadata from ${sessionPath}:`, error);
    return null;
  }
}

/**
 * GET /api/evaluation/sessions
 * DISABLED: Privacy issue - this endpoint listed all users' sessions
 * Sessions are now loaded client-side from localStorage instead
 */
router.get('/sessions', async (req, res) => {
  res.status(410).json({
    error: 'Endpoint deprecated',
    message: 'Sessions are now loaded from browser localStorage for privacy. Use the evaluation UI at /evaluation'
  });
});

/**
 * POST /api/evaluation/start
 * Start a new evaluation session for a completed beam search
 *
 * Body: { sessionId: string, evaluatorId?: string }
 */
router.post('/start', async (req, res) => {
  try {
    const { sessionId, evaluatorId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Missing sessionId',
        message: 'Provide sessionId of beam search to evaluate'
      });
    }

    // Find the session
    const sessions = await findAllSessions();
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No beam search session found with ID: ${sessionId}`
      });
    }

    // Load metadata
    const metadata = await loadSessionMetadata(session.path);

    if (!metadata) {
      return res.status(404).json({
        error: 'Metadata not found',
        message: 'Could not load beam search metadata'
      });
    }

    if (!metadata.finalWinner) {
      return res.status(400).json({
        error: 'Session incomplete',
        message: 'Can only evaluate completed beam search sessions'
      });
    }

    // Create new evaluation
    const evaluationId = `eval-${Date.now()}-${uuidv4().substring(0, 8)}`;

    const tracker = new EvaluationTracker({
      outputDir: OUTPUT_DIR,
      evaluationId,
      sessionId,
      evaluatorId: evaluatorId || 'anonymous'
    });

    await tracker.initialize(metadata);

    res.json({
      success: true,
      evaluationId,
      sessionId,
      totalPairs: tracker.evaluation.progress.totalPairs,
      candidateCount: tracker.evaluation.candidates.length
    });
  } catch (error) {
    console.error('[EvalRoutes] Error starting evaluation:', error);
    res.status(500).json({
      error: 'Failed to start evaluation',
      message: error.message
    });
  }
});

/**
 * GET /api/evaluation/:evaluationId/next
 * Get next pairwise comparison task
 */
router.get('/:evaluationId/next', async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Missing sessionId',
        message: 'Provide sessionId query parameter'
      });
    }

    // Load evaluation
    const tracker = await EvaluationTracker.load(OUTPUT_DIR, sessionId, evaluationId);

    // Get next comparison
    const nextComparison = await tracker.getNextComparison();

    if (!nextComparison) {
      return res.json({
        success: true,
        completed: true,
        message: 'All comparisons completed'
      });
    }

    res.json({
      success: true,
      completed: false,
      comparison: nextComparison
    });
  } catch (error) {
    console.error('[EvalRoutes] Error getting next comparison:', error);
    res.status(500).json({
      error: 'Failed to get next comparison',
      message: error.message
    });
  }
});

/**
 * POST /api/evaluation/:evaluationId/compare
 * Submit a comparison result
 *
 * Body: {
 *   sessionId: string,
 *   comparisonId: string,
 *   candidateA: number,
 *   candidateB: number,
 *   winner: 'A' | 'B' | 'tie',
 *   responseTimeMs: number
 * }
 */
router.post('/:evaluationId/compare', async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { sessionId, comparisonId, candidateA, candidateB, winner, responseTimeMs } = req.body;

    // Validate required fields
    if (!sessionId || !comparisonId || candidateA === undefined || candidateB === undefined || !winner) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Provide sessionId, comparisonId, candidateA, candidateB, and winner'
      });
    }

    // Validate winner
    if (!['A', 'B', 'tie'].includes(winner)) {
      return res.status(400).json({
        error: 'Invalid winner',
        message: 'Winner must be "A", "B", or "tie"'
      });
    }

    // Load evaluation
    const tracker = await EvaluationTracker.load(OUTPUT_DIR, sessionId, evaluationId);

    // Record comparison
    await tracker.recordComparison({
      comparisonId,
      candidateA,
      candidateB,
      winner,
      responseTimeMs: responseTimeMs || 0
    });

    res.json({
      success: true,
      progress: tracker.evaluation.progress,
      completed: tracker.evaluation.status === 'completed'
    });
  } catch (error) {
    console.error('[EvalRoutes] Error recording comparison:', error);
    res.status(500).json({
      error: 'Failed to record comparison',
      message: error.message
    });
  }
});

/**
 * GET /api/evaluation/:evaluationId/status
 * Get evaluation progress and status
 */
router.get('/:evaluationId/status', async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Missing sessionId',
        message: 'Provide sessionId query parameter'
      });
    }

    // Load evaluation
    const tracker = await EvaluationTracker.load(OUTPUT_DIR, sessionId, evaluationId);
    const evaluation = await tracker.getEvaluation();

    res.json({
      success: true,
      evaluation: {
        evaluationId: evaluation.evaluationId,
        sessionId: evaluation.sessionId,
        status: evaluation.status,
        createdAt: evaluation.createdAt,
        completedAt: evaluation.completedAt,
        progress: evaluation.progress,
        userPrompt: evaluation.userPrompt
      }
    });
  } catch (error) {
    console.error('[EvalRoutes] Error getting status:', error);
    res.status(500).json({
      error: 'Failed to get status',
      message: error.message
    });
  }
});

/**
 * GET /api/evaluation/:evaluationId/export
 * Export evaluation data for analysis (CSV format)
 */
router.get('/:evaluationId/export', async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Missing sessionId',
        message: 'Provide sessionId query parameter'
      });
    }

    // Load evaluation
    const tracker = await EvaluationTracker.load(OUTPUT_DIR, sessionId, evaluationId);
    const exportData = await tracker.exportForAnalysis();

    res.json({
      success: true,
      data: exportData
    });
  } catch (error) {
    console.error('[EvalRoutes] Error exporting data:', error);
    res.status(500).json({
      error: 'Failed to export data',
      message: error.message
    });
  }
});

export default router;
