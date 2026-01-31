/**
 * @file Test utilities for all test files
 * Provides common functionality like dynamic port allocation
 */

import net from 'node:net';

/**
 * Find an available port for test servers
 * @param {number} [startPort=3000] - Starting port to check (default: 3000)
 * @param {number} [maxAttempts=100] - Maximum ports to try
 * @returns {Promise<number>} Available port number
 * @throws {Error} If no available port found after maxAttempts
 */
export async function findAvailablePort(startPort = 3000, maxAttempts = 100) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;

    try {
      // Try to listen on the port
      await new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once('error', (err) => {
          server.close();
          reject(err);
        });

        server.once('listening', () => {
          server.close();
          resolve();
        });

        server.listen(port, '127.0.0.1');
      });

      return port;
    } catch (err) {
      // Port in use, try next one
      if (err.code !== 'EADDRINUSE') {
        throw err;
      }
    }
  }

  throw new Error(`No available port found after checking ${maxAttempts} ports starting from ${startPort}`);
}

/**
 * Wait for a server to be ready by attempting to connect
 * @param {number} port - Port to check
 * @param {number} [timeoutMs=5000] - Maximum time to wait in milliseconds
 * @param {number} [retryDelayMs=50] - Delay between retry attempts
 * @returns {Promise<void>}
 * @throws {Error} If server doesn't become ready within timeout
 */
export async function waitForServer(port, timeoutMs = 5000, retryDelayMs = 50) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
      return; // Server is ready
    } catch {
      // Server not ready yet, wait and retry
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`);
}
