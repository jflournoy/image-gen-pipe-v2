/**
 * @file Express API Server
 * Minimal server implementation for beam search web interface
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { startBeamSearchJob, getJobStatus } from './beam-search-worker.js';

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
