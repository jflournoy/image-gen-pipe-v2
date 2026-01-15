/**
 * @file Demo Routes
 * Express routes for the interactive demo
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { startBeamSearchJob, getJobStatus } from './beam-search-worker.js';
import { getRuntimeProviders } from './provider-routes.js';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';

const router = express.Router();

/**
 * POST /api/demo/start
 * Start a new demo beam search job
 */
router.post('/start', async (req, res) => {
  try {
    const {
      prompt,
      n = 4,
      m = 2,
      maxIterations = 3,
      alpha = 0.7,
      temperature = 0.8,
      ensembleSize = 3,
      rankingMode = 'vlm'  // 'vlm' (tournament pairwise) or 'scoring' (CLIP/aesthetic)
    } = req.body;

    // Extract user API key from headers
    const userApiKey = req.headers['x-openai-api-key'];

    // Check if OpenAI providers are being used
    const runtimeProviders = getRuntimeProviders();
    const needsOpenAI = runtimeProviders.llm === 'openai' ||
                        runtimeProviders.image === 'openai' ||
                        runtimeProviders.image === 'dalle' ||
                        runtimeProviders.vision === 'openai' ||
                        runtimeProviders.vision === 'gpt-vision';

    // Only validate API key if OpenAI providers are being used
    if (needsOpenAI) {
      if (!userApiKey || !userApiKey.trim()) {
        return res.status(401).json({
          error: 'Missing API key',
          message: 'OpenAI providers are active - provide X-OpenAI-API-Key header or switch to local providers.'
        });
      }

      // Validate API key format
      if (!userApiKey.startsWith('sk-')) {
        return res.status(400).json({
          error: 'Invalid API key format',
          message: 'API key should start with sk-'
        });
      }
    }

    // Validate required parameter
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid prompt',
        message: 'Prompt must be a non-empty string'
      });
    }

    // Validate numeric parameters
    const validateParam = (value, min, max, name) => {
      const num = Number(value);
      if (isNaN(num) || num < min || num > max) {
        throw new Error(`${name} must be between ${min} and ${max}`);
      }
      return num;
    };

    let nValidated, mValidated, iterationsValidated, alphaValidated, tempValidated, ensembleValidated;
    try {
      nValidated = validateParam(n, 2, 8, 'Beam width (n)');
      mValidated = validateParam(m, 1, Math.floor(nValidated / 2) || 1, 'Keep top (m)');

      // Ensure N is divisible by M for even expansion
      // Each of M parents generates N/M children per iteration
      if (nValidated % mValidated !== 0) {
        throw new Error(`Beam width (${nValidated}) must be divisible by keep top (${mValidated}). Try n=${mValidated * Math.floor(nValidated / mValidated)} or m=${nValidated / Math.ceil(nValidated / mValidated)}`);
      }

      iterationsValidated = validateParam(maxIterations, 1, 10, 'Max iterations');
      alphaValidated = validateParam(alpha, 0, 1, 'Alpha');
      tempValidated = validateParam(temperature, 0, 2, 'Temperature');
      ensembleValidated = validateParam(ensembleSize, 1, 5, 'Ensemble size');
    } catch (err) {
      return res.status(400).json({
        error: 'Invalid parameter',
        message: err.message
      });
    }

    // Generate unique job ID
    const jobId = uuidv4();

    // Validate ranking mode
    const validRankingModes = ['vlm', 'scoring'];
    const rankingModeValidated = validRankingModes.includes(rankingMode) ? rankingMode : 'vlm';

    // Start beam search job in background (don't await - let it run)
    // Pass user-provided API key (required - no server fallback)
    startBeamSearchJob(jobId, {
      prompt: prompt.trim(),
      n: nValidated,
      m: mValidated,
      iterations: iterationsValidated,
      alpha: alphaValidated,
      temperature: tempValidated,
      ensembleSize: ensembleValidated,  // Pass ensemble size to beam search for custom voting
      rankingMode: rankingModeValidated  // 'vlm' or 'scoring'
    }, userApiKey).catch(err => {
      console.error(`[Demo] Error running beam search for job ${jobId}:`, err);
    });

    // Return immediately with job ID
    res.json({
      jobId,
      status: 'running',
      message: 'Beam search job started',
      params: {
        prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
        n: nValidated,
        m: mValidated,
        maxIterations: iterationsValidated,
        alpha: alphaValidated,
        temperature: tempValidated,
        ensembleSize: ensembleValidated,
        rankingMode: rankingModeValidated
      }
    });
  } catch (err) {
    console.error('[Demo] Error starting demo:', err);
    res.status(500).json({
      error: 'Failed to start demo',
      message: err.message
    });
  }
});

/**
 * GET /api/demo/status/:jobId
 * Get current status of a demo job
 */
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;

  try {
    const status = getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        error: 'Job not found',
        jobId
      });
    }

    // Sanitize response to avoid circular references
    res.json({
      jobId,
      phase: status.phase || 'unknown',
      progress: status.progress || 0,
      iteration: status.iteration || 0,
      totalIterations: status.totalIterations || 0,
      candidatesGenerated: status.candidatesGenerated || 0,
      bestScore: status.bestScore || null,
      timestamp: status.timestamp || new Date().toISOString()
    });
  } catch (err) {
    console.error(`[Demo] Error getting status for job ${jobId}:`, err);
    res.status(500).json({
      error: 'Failed to get job status',
      message: err.message
    });
  }
});

/**
 * POST /api/demo/cancel/:jobId
 * Cancel a running beam search job
 */
router.post('/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;

  try {
    const { cancelBeamSearchJob } = require('../api/beam-search-worker.js');
    const cancelled = cancelBeamSearchJob(jobId);

    if (cancelled) {
      res.json({
        success: true,
        message: `Job ${jobId} cancellation requested`,
        jobId
      });
    } else {
      res.status(404).json({
        error: 'Job not found or already complete',
        jobId
      });
    }
  } catch (err) {
    console.error(`[Demo] Error cancelling job ${jobId}:`, err);
    res.status(500).json({
      error: 'Failed to cancel job',
      message: err.message
    });
  }
});

/**
 * GET /api/demo/images/:sessionId/:filename
 * Serve image file from demo session
 */
router.get('/images/:sessionId/:filename', async (req, res) => {
  try {
    const { sessionId, filename } = req.params;

    // Validate session ID format (ses-HHMMSS)
    if (!/^ses-\d{6}$/.test(sessionId)) {
      return res.status(400).json({
        error: 'Invalid session ID format',
        sessionId
      });
    }

    // Validate filename - only allow PNG files, no path traversal
    if (!/^[a-zA-Z0-9_.-]+\.png$/.test(filename)) {
      return res.status(400).json({
        error: 'Invalid filename format',
        filename,
        message: 'Only PNG files are allowed'
      });
    }

    // Search across all date directories to find the session
    // This allows serving images from sessions created on previous days
    const outputDir = path.join(process.cwd(), 'output');

    let dates = [];
    try {
      dates = await fsPromises.readdir(outputDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Image not found - output directory does not exist'
        });
      }
      throw error;
    }

    // Filter and sort dates (most recent first)
    dates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();

    // Try each date directory until we find the image
    for (const dateDir of dates) {
      const imagePath = path.join(
        outputDir,
        dateDir,
        sessionId,
        filename
      );

      try {
        await fsPromises.access(imagePath);
        // File exists - serve it
        console.log(`[Demo] Serving image: ${imagePath}`);

        // Set cache headers (1 hour)
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Content-Type', 'image/png');

        // Stream the file
        const fileStream = fs.createReadStream(imagePath);
        fileStream.pipe(res);

        fileStream.on('error', (err) => {
          console.error(`[Demo] Error streaming image ${imagePath}:`, err);
          if (!res.headersSent) {
            res.status(500).json({
              error: 'Failed to serve image',
              message: err.message
            });
          }
        });

        return; // Successfully found and started streaming
      } catch (error) {
        // File doesn't exist in this date directory, try next
        if (error.code !== 'ENOENT') {
          console.error(`[Demo] Error accessing ${imagePath}:`, error.message);
        }
      }
    }

    // Image not found in any date directory
    return res.status(404).json({
      error: 'Image not found in any date',
      sessionId,
      filename
    });
  } catch (err) {
    console.error('[Demo] Error serving demo image:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to serve image',
        message: err.message
      });
    }
  }
});

/**
 * GET /api/demo/jobs
 * List all historical beam search jobs
 */
router.get('/jobs', async (req, res) => {
  try {
    const outputDir = path.join(process.cwd(), 'output');

    // Get all date directories
    let dates = [];
    try {
      dates = await fsPromises.readdir(outputDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.json({ sessions: [] });
      }
      throw error;
    }

    // Filter valid date directories and sort descending (newest first)
    dates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();

    const sessions = [];

    for (const dateDir of dates) {
      const datePath = path.join(outputDir, dateDir);

      let sessionDirs = [];
      try {
        sessionDirs = await fsPromises.readdir(datePath);
      } catch {
        continue;
      }

      // Filter valid session directories
      sessionDirs = sessionDirs.filter(s => /^ses-\d{6}$/.test(s));

      for (const sessionId of sessionDirs) {
        const metadataPath = path.join(datePath, sessionId, 'metadata.json');

        try {
          const metadataJson = await fsPromises.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataJson);

          sessions.push({
            sessionId,
            date: dateDir,
            timestamp: metadata.timestamp,
            userPrompt: metadata.userPrompt,
            config: metadata.config,
            finalWinner: metadata.finalWinner,
            iterationCount: metadata.iterations?.length || 0
          });
        } catch {
          // Skip sessions without valid metadata
        }
      }
    }

    // Sort by timestamp descending
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ sessions });
  } catch (err) {
    console.error('[Demo] Error listing jobs:', err);
    res.status(500).json({
      error: 'Failed to list jobs',
      message: err.message
    });
  }
});

/**
 * GET /api/demo/jobs/:sessionId
 * Get detailed metadata for a specific job
 */
router.get('/jobs/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  // Validate sessionId format (ses-HHMMSS)
  if (!/^ses-\d{6}$/.test(sessionId)) {
    return res.status(400).json({
      error: 'Invalid session ID format',
      sessionId
    });
  }

  try {
    const outputDir = path.join(process.cwd(), 'output');

    // Get all date directories
    let dates = [];
    try {
      dates = await fsPromises.readdir(outputDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Session not found' });
      }
      throw error;
    }

    // Sort dates descending (most recent first)
    dates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();

    for (const dateDir of dates) {
      const metadataPath = path.join(outputDir, dateDir, sessionId, 'metadata.json');

      try {
        const metadataJson = await fsPromises.readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataJson);

        return res.json({
          sessionId,
          date: dateDir,
          ...metadata
        });
      } catch {
        // Not in this date directory
      }
    }

    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    console.error(`[Demo] Error getting job ${sessionId}:`, err);
    res.status(500).json({
      error: 'Failed to get job',
      message: err.message
    });
  }
});

/**
 * GET /api/demo/images/:date/:sessionId/:filename
 * Serve image file from any date (for viewing old jobs)
 */
router.get('/images/:date/:sessionId/:filename', async (req, res) => {
  try {
    const { date, sessionId, filename } = req.params;

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'Invalid date format',
        date,
        message: 'Date must be in YYYY-MM-DD format'
      });
    }

    // Validate session ID format (ses-HHMMSS)
    if (!/^ses-\d{6}$/.test(sessionId)) {
      return res.status(400).json({
        error: 'Invalid session ID format',
        sessionId
      });
    }

    // Validate filename - only allow PNG files, no path traversal
    if (!/^[a-zA-Z0-9_.-]+\.png$/.test(filename)) {
      return res.status(400).json({
        error: 'Invalid filename format',
        filename,
        message: 'Only PNG files are allowed'
      });
    }

    // Full path: output/YYYY-MM-DD/ses-HHMMSS/filename.png
    const imagePath = path.join(
      process.cwd(),
      'output',
      date,
      sessionId,
      filename
    );

    // Verify file exists
    try {
      await fsPromises.access(imagePath);
    } catch {
      return res.status(404).json({
        error: 'Image not found',
        date,
        sessionId,
        filename
      });
    }

    // Set cache headers (1 hour)
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Content-Type', 'image/png');

    // Stream the file
    const fileStream = fs.createReadStream(imagePath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
      console.error(`[Demo] Error streaming image ${imagePath}:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to serve image',
          message: err.message
        });
      }
    });
  } catch (err) {
    console.error('[Demo] Error serving demo image:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to serve image',
        message: err.message
      });
    }
  }
});

export default router;
