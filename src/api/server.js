/**
 * @file Express API Server
 * Minimal server implementation for beam search web interface
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { readFile, readdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { startBeamSearchJob, getJobStatus, getJobMetadata, cancelBeamSearchJob } from './beam-search-worker.js';
import demoRouter from './demo-routes.js';

const require = createRequire(import.meta.url);
const rateLimitConfig = require('../config/rate-limits.js');
const { getMetrics: getRateLimiterMetrics } = require('../utils/rate-limiter-registry.js');
const { getDateString } = require('../utils/timezone.js');
const providerConfig = require('../config/provider-config.js');

// Store WebSocket connections by jobId
let jobSubscriptions = new Map();
// Queue messages for jobs that haven't been subscribed to yet
let jobMessageQueues = new Map();
let wss = null;

/**
 * Reset WebSocket state (useful for testing)
 * @private
 */
export function _resetWebSocketState() {
  jobSubscriptions.clear();
  jobMessageQueues.clear();
  if (wss) {
    wss.clients.forEach(client => client.close());
    wss.close();
    wss = null;
  }
}

/**
 * Create and configure Express application
 * @returns {express.Application} Configured Express app
 */
export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.static('public'));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Available models endpoint - exposes configurable model options to frontend
  app.get('/api/available-models', (req, res) => {
    res.status(200).json({
      llm: {
        default: providerConfig.llm.model,
        options: ['gpt-5-nano', 'gpt-5-mini', 'gpt-4-turbo'],
        operations: {
          expand: providerConfig.llm.models.expand,
          refine: providerConfig.llm.models.refine,
          combine: providerConfig.llm.models.combine
        }
      },
      imageGen: {
        default: providerConfig.image.model,
        options: ['gpt-5-image-mini', 'gpt-image-1-mini', 'gpt-image-1']
      },
      vision: {
        default: providerConfig.vision.model,
        options: ['gpt-5-nano', 'gpt-5-mini']
      }
    });
  });

  // Beam search endpoint
  app.post('/api/beam-search', (req, res) => {
    const { prompt, n, m, iterations, alpha, temperature, models } = req.body;
    const userApiKey = req.headers['x-openai-api-key'];

    // Validate API key is present
    if (!userApiKey || !userApiKey.trim()) {
      return res.status(401).json({
        error: 'Missing API key. Provide X-OpenAI-API-Key header with your OpenAI API key.'
      });
    }

    // Validate API key format
    if (!userApiKey.startsWith('sk-')) {
      return res.status(400).json({
        error: 'Invalid API key format. Should start with sk-'
      });
    }

    // Validate required parameters
    if (!prompt) {
      return res.status(400).json({
        error: 'Missing required parameter: prompt'
      });
    }

    // Generate unique job ID
    const jobId = randomUUID();

    // Start beam search job in background (non-blocking)
    // Pass user-provided API key - no server fallback
    startBeamSearchJob(jobId, {
      prompt,
      n,
      m,
      iterations,
      alpha,
      temperature,
      models // Pass user-selected models (if provided)
    }, userApiKey).catch(error => {
      console.error(`Error in beam search job ${jobId}:`, error);
    });

    // Return immediately with job ID
    res.status(200).json({
      jobId,
      status: 'started',
      params: { prompt, n, m, iterations, alpha, temperature, models }
    });
  });

  // Job status endpoint
  app.get('/api/job/:jobId', (req, res) => {
    const { jobId } = req.params;
    const status = getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        error: 'Job not found'
      });
    }

    res.status(200).json(status);
  });

  // Job metadata endpoint for chain visualization
  app.get('/api/jobs/:jobId/metadata', async (req, res) => {
    const { jobId } = req.params;

    try {
      const metadata = await getJobMetadata(jobId);

      if (!metadata) {
        return res.status(404).json({
          error: 'Job not found'
        });
      }

      res.status(200).json(metadata);
    } catch (error) {
      console.error(`Error fetching metadata for job ${jobId}:`, error);
      res.status(500).json({
        error: 'Failed to fetch metadata'
      });
    }
  });

  // Cancel job endpoint
  app.post('/api/jobs/:jobId/cancel', (req, res) => {
    const { jobId } = req.params;
    const status = getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        error: 'Job not found'
      });
    }

    // Request cancellation (aborts all pending operations)
    const cancelled = cancelBeamSearchJob(jobId);

    if (!cancelled) {
      return res.status(400).json({
        error: 'Job is no longer running or has already completed'
      });
    }

    // Send cancellation signal to all subscribed WebSocket clients
    if (jobSubscriptions.has(jobId)) {
      const clients = jobSubscriptions.get(jobId);
      const cancelMessage = JSON.stringify({
        type: 'cancelled',
        jobId,
        timestamp: new Date().toISOString(),
        message: 'Job was cancelled by user'
      });

      clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(cancelMessage);
        }
      });
    }

    res.status(200).json({
      jobId,
      status: 'cancelling',
      message: 'Job cancellation in progress'
    });
  });

  // List available sessions/jobs endpoint
  app.get('/api/jobs', async (req, res) => {
    try {
      const outputDir = join(process.cwd(), 'output');
      const sessions = [];

      // Scan output directory for date subdirectories (YYYY-MM-DD format)
      let dates = [];
      try {
        dates = await readdir(outputDir);
      } catch (error) {
        // Output directory may not exist yet
        if (error.code === 'ENOENT') {
          return res.status(200).json({ sessions: [] });
        }
        throw error;
      }

      // Filter for date directories and scan for sessions
      for (const dateDir of dates) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateDir)) continue;

        const datePath = join(outputDir, dateDir);
        let sessionDirs = [];

        try {
          sessionDirs = await readdir(datePath);
        } catch (error) {
          console.warn(`[Jobs API] Error reading date directory ${datePath}:`, error.message);
          continue;
        }

        // Filter for session directories and read metadata
        for (const sessionDir of sessionDirs) {
          const sessionRegex = /^ses-\d{6}$/;
          if (!sessionRegex.test(sessionDir)) continue;

          const metadataPath = join(datePath, sessionDir, 'metadata.json');

          try {
            const metadataJson = await readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(metadataJson);

            sessions.push({
              sessionId: sessionDir,
              date: dateDir,
              timestamp: metadata.timestamp,
              userPrompt: metadata.userPrompt,
              config: metadata.config,
              finalWinner: metadata.finalWinner,
              iterationCount: metadata.iterations ? metadata.iterations.length : 0
            });
          } catch (error) {
            // Only log non-ENOENT errors (file not found is expected for incomplete jobs)
            if (error.code !== 'ENOENT') {
              console.warn(`[Jobs API] Error reading metadata for ${sessionDir}:`, error.message);
            }
            // Continue scanning other sessions even if one fails
          }
        }
      }

      // Sort by timestamp, newest first
      sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      res.status(200).json({ sessions });
    } catch (error) {
      console.error('[Jobs API] Error listing jobs:', error);
      res.status(500).json({
        error: 'Failed to list jobs'
      });
    }
  });

  // Get session metadata endpoint
  app.get('/api/jobs/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    // Validate sessionId format (ses-HHMMSS)
    const sessionRegex = /^ses-\d{6}$/;
    if (!sessionRegex.test(sessionId)) {
      return res.status(400).json({
        error: 'Invalid session ID format'
      });
    }

    try {
      const outputDir = join(process.cwd(), 'output');

      // Try to find the session in any date directory (scan recent dates first)
      let dates = [];
      try {
        dates = await readdir(outputDir);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({
            error: 'Session not found'
          });
        }
        throw error;
      }

      // Sort dates in descending order to check recent dates first
      dates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();

      for (const dateDir of dates) {
        const metadataPath = join(outputDir, dateDir, sessionId, 'metadata.json');

        try {
          const metadataJson = await readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataJson);

          return res.status(200).json({
            sessionId,
            date: dateDir,
            metadata
          });
        } catch (error) {
          // File doesn't exist in this date directory, continue to next
          if (error.code !== 'ENOENT') {
            console.warn(`[Jobs API] Error reading metadata for ${sessionId}:`, error.message);
          }
        }
      }

      // Session not found in any date directory
      res.status(404).json({
        error: 'Session not found'
      });
    } catch (error) {
      console.error(`[Jobs API] Error retrieving session ${sessionId}:`, error);
      res.status(500).json({
        error: 'Failed to retrieve session'
      });
    }
  });

  // Image serving endpoint: /api/images/:sessionId/:filename
  // Serves images from output/YYYY-MM-DD/:sessionId/:filename
  app.get('/api/images/:sessionId/:filename', async (req, res) => {
    const { sessionId, filename } = req.params;

    // Validate sessionId (format: ses-HHMMSS)
    const sessionIdRegex = /^ses-\d{6}$/;
    if (!sessionIdRegex.test(sessionId)) {
      console.warn(`[Image API] Invalid session ID: ${sessionId}`);
      return res.status(400).json({
        error: 'Invalid session ID'
      });
    }

    // Validate filename (prevent path traversal)
    const filenameNormalized = normalize(filename);
    if (filenameNormalized.includes('..') || filenameNormalized.includes('/') || filenameNormalized.includes('\\')) {
      console.warn(`[Image API] Invalid filename: ${filename}`);
      return res.status(400).json({
        error: 'Invalid filename'
      });
    }

    // Ensure filename ends with .png
    if (!filename.endsWith('.png')) {
      console.warn(`[Image API] Non-PNG file requested: ${filename}`);
      return res.status(400).json({
        error: 'Only PNG files are allowed'
      });
    }

    // Get current date in configured timezone (images are stored in output/YYYY-MM-DD/)
    // IMPORTANT: Use timezone-aware date to match how images were saved
    // If we use UTC date and the local timezone differs, paths will mismatch at midnight
    const dateStr = getDateString();

    // Construct safe image path: output/YYYY-MM-DD/ses-HHMMSS/iter0-cand0.png
    const imagePath = join(process.cwd(), 'output', dateStr, sessionId, filename);

    try {
      // Read the image file
      console.log(`[Image API] Serving image: ${imagePath}`);
      const imageBuffer = await readFile(imagePath);

      // Set appropriate headers and send image
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.status(200).send(imageBuffer);
    } catch (error) {
      // Handle file not found or read errors
      if (error.code === 'ENOENT') {
        console.warn(`[Image API] File not found: ${imagePath}`);
        return res.status(404).json({
          error: 'Image not found'
        });
      }

      // Handle other errors
      console.error(`[Image API] Error serving image: ${imagePath}`, error.message);
      return res.status(500).json({
        error: 'Failed to serve image'
      });
    }
  });

  // Demo endpoints for rate limiting visualization
  app.get('/api/demo/config', (req, res) => {
    res.status(200).json({
      rateLimits: rateLimitConfig.defaults,
      envVars: [
        'BEAM_SEARCH_RATE_LIMIT_LLM',
        'BEAM_SEARCH_RATE_LIMIT_IMAGE_GEN',
        'BEAM_SEARCH_RATE_LIMIT_VISION'
      ]
    });
  });

  app.get('/api/demo/rate-limits/status', (req, res) => {
    const metrics = getRateLimiterMetrics();
    res.status(200).json(metrics);
  });

  // Demo endpoints are handled by demoRouter below

  app.get('/demo', async (req, res) => {
    try {
      const demoPath = join(process.cwd(), 'public', 'demo.html');
      const html = await readFile(demoPath, 'utf-8');
      res.status(200).send(html);
    } catch (error) {
      console.error('Error serving demo page:', error);
      res.status(500).json({ error: 'Failed to serve demo page' });
    }
  });

  // Register demo routes
  app.use('/api/demo', demoRouter);

  return app;
}

/**
 * Attach WebSocket server to existing HTTP server
 * @param {import('http').Server} server - HTTP server instance
 * @returns {WebSocketServer} WebSocket server instance
 */
export function attachWebSocket(server) {
  // Close existing WebSocket server if any
  if (wss) {
    wss.clients.forEach(client => client.terminate());
    wss.close();
  }

  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let currentJobId = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'subscribe' && message.jobId) {
          currentJobId = message.jobId;

          // Validate that the job exists and is still running
          const jobStatus = getJobStatus(currentJobId);

          if (!jobStatus) {
            // Job not found - could be already completed or never existed
            console.log(`[WebSocket] Subscribe failed: Job ${currentJobId} not found`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Job not found or already completed. Please start a new job.',
              jobId: currentJobId
            }));
            ws.close(1000, 'Job not found');
            return;
          }

          if (jobStatus.status === 'completed') {
            // Job has already finished
            console.log(`[WebSocket] Subscribe failed: Job ${currentJobId} already completed`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'This job has already completed. Results are available in the job browser.',
              jobId: currentJobId
            }));
            ws.close(1000, 'Job completed');
            return;
          }

          if (jobStatus.status === 'cancelled') {
            // Job was cancelled
            console.log(`[WebSocket] Subscribe failed: Job ${currentJobId} was cancelled`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'This job was cancelled. Please start a new job.',
              jobId: currentJobId
            }));
            ws.close(1000, 'Job cancelled');
            return;
          }

          // Job is valid and running - add this connection to the job's subscription list
          if (!jobSubscriptions.has(currentJobId)) {
            jobSubscriptions.set(currentJobId, new Set());
          }
          jobSubscriptions.get(currentJobId).add(ws);

          // Send confirmation
          ws.send(JSON.stringify({
            type: 'subscribed',
            jobId: currentJobId
          }));

          // Send any queued messages for this job (buffered before subscription)
          if (jobMessageQueues.has(currentJobId)) {
            const queue = jobMessageQueues.get(currentJobId);
            console.log(`[WebSocket] Sending ${queue.length} queued messages for job ${currentJobId}`);
            queue.forEach(queuedMessage => {
              ws.send(JSON.stringify(queuedMessage));
            });
            // Clear the queue after sending
            jobMessageQueues.delete(currentJobId);
          }
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      // Clean up subscription when connection closes
      if (currentJobId && jobSubscriptions.has(currentJobId)) {
        jobSubscriptions.get(currentJobId).delete(ws);
        if (jobSubscriptions.get(currentJobId).size === 0) {
          jobSubscriptions.delete(currentJobId);
        }
      }
    });
  });

  return wss;
}

/**
 * Emit progress update to all subscribers of a job
 * @param {string} jobId - Job identifier
 * @param {object} progressData - Progress data to send
 */
export function emitProgress(jobId, progressData) {
  // If no subscribers yet, queue the message for when they subscribe
  if (!jobSubscriptions.has(jobId)) {
    if (!jobMessageQueues.has(jobId)) {
      jobMessageQueues.set(jobId, []);
    }
    jobMessageQueues.get(jobId).push(progressData);
    return;
  }

  const subscribers = jobSubscriptions.get(jobId);
  const message = JSON.stringify(progressData);

  subscribers.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
    }
  });
}

/**
 * Start the server on the specified port
 * @param {number} port - Port number to listen on
 * @returns {Promise<import('http').Server>} The running server instance
 */
export function startServer(port = 3000) {
  const app = createApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`🚀 Server running on http://localhost:${port}`);
        resolve(server);
      }
    });
  });
}
