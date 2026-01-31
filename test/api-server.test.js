/**
 * @file API Server Tests (TDD RED → GREEN cycles)
 * Tests for the web interface backend API server
 */

import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { findAvailablePort } from './test-utils.js';

test('🔴 RED: Express server setup', async (t) => {
  await t.test('should create an Express app instance', async () => {
    // Arrange: Import the server module (this will fail - module doesn't exist yet!)
    const { createApp } = await import('../src/api/server.js');

    // Act: Create app instance
    const app = createApp();

    // Assert: Verify app exists and is an Express instance
    assert.ok(app, 'App should be created');
    assert.strictEqual(typeof app.listen, 'function', 'App should have listen method');
  });

  await t.test('should have health check endpoint', async () => {
    // This test will verify the server has a basic /health endpoint
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();

    // We need a way to test the endpoint - for now just check it exists
    assert.ok(app, 'App should exist to add routes');
  });
});

test('🔴 RED: Beam search POST endpoint', async (t) => {
  await t.test('should accept POST /api/beam-search requests', async () => {
    // Arrange: Start server with dynamic port
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);

    // Act: Make POST request to beam search endpoint
    const requestData = JSON.stringify({
      prompt: 'a serene mountain landscape',
      n: 4,
      m: 2,
      iterations: 2,
      alpha: 0.7
    });

    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/beam-search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.write(requestData);
      req.end();
    });

    // Assert: Should return 200 and job ID
    assert.strictEqual(response.statusCode, 200, 'Should return 200 OK');
    const body = JSON.parse(response.body);
    assert.ok(body.jobId, 'Response should include jobId');
    assert.strictEqual(body.status, 'started', 'Status should be "started"');

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('should validate required parameters', async () => {
    // Arrange: Start server with dynamic port
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);

    // Act: Make POST request with missing prompt
    const requestData = JSON.stringify({
      n: 4,
      m: 2
      // Missing prompt
    });

    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/beam-search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.write(requestData);
      req.end();
    });

    // Assert: Should return 400 for missing prompt
    assert.strictEqual(response.statusCode, 400, 'Should return 400 Bad Request');
    const body = JSON.parse(response.body);
    assert.ok(body.error, 'Response should include error message');

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
  });
});
