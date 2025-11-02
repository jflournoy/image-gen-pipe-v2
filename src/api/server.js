/**
 * @file Express API Server
 * Minimal server implementation for beam search web interface
 */

import express from 'express';

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

  return app;
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
