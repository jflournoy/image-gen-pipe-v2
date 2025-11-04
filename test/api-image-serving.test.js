/**
 * @file Image Serving Endpoint Tests (TDD RED → GREEN)
 * Tests for serving generated images via HTTP
 */

import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

test('🔴 RED: Image serving endpoint', async (t) => {
  await t.test('should serve image by ID', async () => {
    // Arrange: Create a test image file
    const testImageId = 'test-image-123';
    const testImagePath = path.join(process.cwd(), 'output', 'test', `${testImageId}.png`);
    await fs.mkdir(path.dirname(testImagePath), { recursive: true });

    // Create a minimal 1x1 PNG file (valid PNG header + IEND)
    const minimalPng = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
      0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
      0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
      0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB4,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
      0xAE, 0x42, 0x60, 0x82
    ]);

    await fs.writeFile(testImagePath, minimalPng);

    // Import server and start it
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = 3010;
    const server = app.listen(port);

    // Act: Request the image
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: `/api/images/${testImageId}`,
        method: 'GET'
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        }));
      });

      req.on('error', reject);
      req.end();
    });

    // Assert: Should return 200 with image data
    assert.strictEqual(response.statusCode, 200, 'Should return 200 OK');
    assert.strictEqual(response.headers['content-type'], 'image/png', 'Should have correct content type');
    assert.ok(response.body.length > 0, 'Should return image data');
    assert.deepStrictEqual(response.body, minimalPng, 'Should return exact image bytes');

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
    await fs.unlink(testImagePath);
    await fs.rmdir(path.dirname(testImagePath));
  });

  await t.test('should return 404 for non-existent image', async () => {
    // Arrange: Start server
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = 3011;
    const server = app.listen(port);

    // Act: Request non-existent image
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/images/nonexistent-image-999',
        method: 'GET'
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({
          statusCode: res.statusCode,
          body: data
        }));
      });

      req.on('error', reject);
      req.end();
    });

    // Assert: Should return 404
    assert.strictEqual(response.statusCode, 404, 'Should return 404 Not Found');
    const body = JSON.parse(response.body);
    assert.ok(body.error, 'Should include error message');

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('should prevent path traversal attacks', async () => {
    // Arrange: Start server
    const { createApp } = await import('../src/api/server.js');
    const app = createApp();
    const port = 3012;
    const server = app.listen(port);

    // Act: Attempt path traversal
    const maliciousIds = [
      '../../../etc/passwd',
      '..%2F..%2F..%2Fetc%2Fpasswd',
      'test/../../../etc/passwd'
    ];

    for (const imageId of maliciousIds) {
      const response = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: port,
          path: `/api/images/${encodeURIComponent(imageId)}`,
          method: 'GET'
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve({
            statusCode: res.statusCode,
            body: data
          }));
        });

        req.on('error', reject);
        req.end();
      });

      // Assert: Should return 400 or 404, never 200
      assert.ok(
        response.statusCode === 400 || response.statusCode === 404,
        `Should reject path traversal attempt: ${imageId}`
      );
    }

    // Cleanup
    await new Promise((resolve) => server.close(resolve));
  });
});
