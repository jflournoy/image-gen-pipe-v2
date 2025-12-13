/**
 * @file Demo Routes
 * Express routes for the interactive demo
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { startBeamSearchJob, getJobStatus } from './beam-search-worker.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      ensembleSize = 3
    } = req.body;

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

      iterationsValidated = validateParam(maxIterations, 1, 5, 'Max iterations');
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

    // Start beam search job in background (don't await - let it run)
    startBeamSearchJob(jobId, {
      prompt: prompt.trim(),
      n: nValidated,
      m: mValidated,
      iterations: iterationsValidated,
      alpha: alphaValidated,
      temperature: tempValidated,
      ensembleSize: ensembleValidated  // Pass ensemble size to beam search for custom voting
    }).catch(err => {
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
        ensembleSize: ensembleValidated
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
    if (!/^[a-zA-Z0-9_\-\.]+\.png$/.test(filename)) {
      return res.status(400).json({
        error: 'Invalid filename format',
        filename,
        message: 'Only PNG files are allowed'
      });
    }

    // Construct full path to image
    // Get today's date in YYYY-MM-DD format
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateDir = `${year}-${month}-${day}`;

    // Full path: output/YYYY-MM-DD/ses-HHMMSS/filename.png
    const imagePath = path.join(
      process.cwd(),
      'output',
      dateDir,
      sessionId,
      filename
    );

    // Verify file exists
    try {
      await fsPromises.access(imagePath);
    } catch {
      return res.status(404).json({
        error: 'Image not found',
        sessionId,
        filename,
        path: imagePath
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
