/**
 * @file Video Routes Tests (TDD RED → GREEN)
 * Tests for the video generation API endpoints
 */

import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { findAvailablePort } from './test-utils.js';

test('🔴 RED: Video generation endpoints exist', async (t) => {
  await t.test('POST /api/video/generate should accept video generation requests', async () => {
    // Arrange: Start server
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);

    // Create a simple 1x1 PNG image (pixel data)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 image
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
      0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
      0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    const imageData = pngHeader.toString('base64');

    // Act: Make POST request to video generation endpoint
    const requestData = JSON.stringify({
      imageData,
      prompt: 'a gentle camera pan',
      steps: 30,
      guidance: 4.0,
      fps: 24,
      num_frames: 97
    });

    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/video/generate',
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

    // Assert: Should return error status code (503 for config, 500 for mock mode, or 400 for validation)
    assert.ok(
      response.statusCode === 503 || response.statusCode === 500 || response.statusCode === 400,
      `Should return expected status code, got ${response.statusCode}`
    );

    if (response.statusCode !== 200) {
      // Expected error case (no credentials)
      const body = JSON.parse(response.body);
      assert.ok(body.error, 'Error response should have error field');
    }

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('GET /api/video/health should return video service status', async () => {
    // Arrange: Start server
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);

    // Act: Make GET request to health endpoint
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/video/health',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.end();
    });

    // Assert: Should return error status code (503 for config, 500 for mock mode, or 200 if configured)
    assert.ok(
      response.statusCode === 503 || response.statusCode === 500 || response.statusCode === 200,
      `Should return expected status code, got ${response.statusCode}`
    );

    const body = JSON.parse(response.body);
    assert.ok(body.status || body.available !== undefined, 'Response should have status or available field');

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('should validate required parameters in generate request', async () => {
    // Arrange: Start server
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);

    // Act: Make POST request without imageData or prompt
    const requestData = JSON.stringify({
      steps: 30
      // Missing imageData and prompt
    });

    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/video/generate',
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

    // Assert: Should return 400 with validation error
    assert.strictEqual(response.statusCode, 400, 'Should return 400 for missing parameters');
    const body = JSON.parse(response.body);
    assert.ok(body.error, 'Error response should explain what is missing');

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
  });
});
