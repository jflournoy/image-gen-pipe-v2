/**
 * @file Express API Server
 * Minimal server implementation for beam search web interface
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { startBeamSearchJob, getJobStatus } from './beam-search-worker.js';

const require = createRequire(import.meta.url);
const rateLimitConfig = require('../config/rate-limits.js');

// Store WebSocket connections by jobId
let jobSubscriptions = new Map();
let wss = null;

/**
 * Reset WebSocket state (useful for testing)
 * @private
 */
export function _resetWebSocketState() {
  jobSubscriptions.clear();
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

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Beam search endpoint
  app.post('/api/beam-search', (req, res) => {
    const { prompt, n, m, iterations, alpha, temperature } = req.body;

    // Validate required parameters
    if (!prompt) {
      return res.status(400).json({
        error: 'Missing required parameter: prompt'
      });
    }

    // Generate unique job ID
    const jobId = randomUUID();

    // Start beam search job in background (non-blocking)
    startBeamSearchJob(jobId, {
      prompt,
      n,
      m,
      iterations,
      alpha,
      temperature
    }).catch(error => {
      console.error(`Error in beam search job ${jobId}:`, error);
    });

    // Return immediately with job ID
    res.status(200).json({
      jobId,
      status: 'started',
      params: { prompt, n, m, iterations, alpha, temperature }
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

  // Image serving endpoint
  app.get('/api/images/:imageId', async (req, res) => {
    const { imageId } = req.params;

    // Validate imageId to prevent path traversal attacks
    const normalizedId = normalize(imageId);
    if (normalizedId.includes('..') || normalizedId.includes('/') || normalizedId.includes('\\')) {
      return res.status(400).json({
        error: 'Invalid image ID'
      });
    }

    // Construct safe image path
    const imagePath = join(process.cwd(), 'output', 'test', `${imageId}.png`);

    try {
      // Read the image file
      const imageBuffer = await readFile(imagePath);

      // Set appropriate headers and send image
      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(imageBuffer);
    } catch (error) {
      // Handle file not found or read errors
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Image not found'
        });
      }

      // Handle other errors
      console.error('Error serving image:', error);
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
    // Minimal implementation - return zero state
    res.status(200).json({
      llm: { active: 0, queued: 0, limit: rateLimitConfig.defaults.llm },
      imageGen: { active: 0, queued: 0, limit: rateLimitConfig.defaults.imageGen },
      vision: { active: 0, queued: 0, limit: rateLimitConfig.defaults.vision }
    });
  });

  app.post('/api/demo/start', (req, res) => {
    const { prompt, beamWidth, keepTop, maxIterations } = req.body;
    const jobId = randomUUID();

    // Start beam search with demo config
    startBeamSearchJob(jobId, {
      prompt,
      n: beamWidth,
      m: keepTop,
      iterations: maxIterations
    }).catch(error => {
      console.error(`Error in demo job ${jobId}:`, error);
    });

    res.status(200).json({
      jobId,
      config: {
        rateLimits: rateLimitConfig.defaults
      }
    });
  });

  app.get('/api/demo/progress/:jobId', (req, res) => {
    const { jobId } = req.params;
    const status = getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.status(200).json({
      ...status,
      rateLimitStatus: {
        llm: { active: 0, queued: 0, limit: rateLimitConfig.defaults.llm },
        imageGen: { active: 0, queued: 0, limit: rateLimitConfig.defaults.imageGen },
        vision: { active: 0, queued: 0, limit: rateLimitConfig.defaults.vision }
      }
    });
  });

  app.get('/demo', (req, res) => {
    res.status(200).send(`
<!DOCTYPE html>
<html>
<head>
  <title>Beam Search Rate Limiting Demo</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .rate-limit-status { display: flex; gap: 20px; margin: 20px 0; }
    .rate-limit-box { border: 1px solid #ccc; padding: 15px; border-radius: 5px; flex: 1; }
    h1, h2 { color: #333; }
  </style>
</head>
<body>
  <h1>Beam Search with Rate Limiting Demo</h1>
  <p>This demo shows how rate limiting prevents OpenAI API errors (429).</p>

  <h2>Rate Limiting Configuration</h2>
  <div class="rate-limit-status" id="rateLimitStatus">
    <div class="rate-limit-box">
      <h3>LLM (GPT-4)</h3>
      <p>Limit: <span id="llm-limit">3</span> concurrent</p>
      <p>Active: <span id="llm-active">0</span></p>
      <p>Queued: <span id="llm-queued">0</span></p>
    </div>
    <div class="rate-limit-box">
      <h3>Image Gen (DALL-E 3)</h3>
      <p>Limit: <span id="imageGen-limit">2</span> concurrent</p>
      <p>Active: <span id="imageGen-active">0</span></p>
      <p>Queued: <span id="imageGen-queued">0</span></p>
    </div>
    <div class="rate-limit-box">
      <h3>Vision (GPT-4V)</h3>
      <p>Limit: <span id="vision-limit">3</span> concurrent</p>
      <p>Active: <span id="vision-active">0</span></p>
      <p>Queued: <span id="vision-queued">0</span></p>
    </div>
  </div>

  <script>
    // Load rate limit config on page load
    fetch('/api/demo/config')
      .then(r => r.json())
      .then(config => {
        document.getElementById('llm-limit').textContent = config.rateLimits.llm;
        document.getElementById('imageGen-limit').textContent = config.rateLimits.imageGen;
        document.getElementById('vision-limit').textContent = config.rateLimits.vision;
      });
  </script>
</body>
</html>
    `);
  });

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

          // Add this connection to the job's subscription list
          if (!jobSubscriptions.has(currentJobId)) {
            jobSubscriptions.set(currentJobId, new Set());
          }
          jobSubscriptions.get(currentJobId).add(ws);

          // Send confirmation
          ws.send(JSON.stringify({
            type: 'subscribed',
            jobId: currentJobId
          }));
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
  if (!jobSubscriptions.has(jobId)) {
    return; // No subscribers for this job
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
