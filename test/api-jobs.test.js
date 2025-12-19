/**
 * @file Jobs API Tests (TDD RED Phase)
 * Tests for browsing historical beam search jobs
 *
 * NOTE: These tests require a server to be running on port 3000
 * Start the server with: npm run demo
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../src/api/server.js');
const { _resetWebSocketState } = require('../src/api/server.js');

let server;
const PORT = 3055; // Use unique port to avoid conflicts

// Start server before all tests
before(async () => {
  server = await startServer(PORT);
});

// Stop server after all tests
after(() => {
  return new Promise((resolve) => {
    _resetWebSocketState();
    server.close(resolve);
  });
});

describe('Jobs API - Browse Historical Jobs (TDD RED)', () => {
  test('GET /api/jobs should return array of historical sessions', async () => {
    // Act
    const response = await fetch(`http://localhost:${PORT}/api/jobs`);

    // Assert
    assert.strictEqual(response.status, 200, 'Should return 200 OK');
    const body = await response.json();
    assert.ok(Array.isArray(body.sessions), 'Response should have sessions array');

    // Each session should have required fields
    if (body.sessions.length > 0) {
      const session = body.sessions[0];
      assert.ok(session.sessionId, 'Session should have sessionId');
      assert.ok(session.date, 'Session should have date');
      assert.ok(session.timestamp, 'Session should have timestamp');
      assert.ok(session.userPrompt, 'Session should have userPrompt');
      assert.ok(session.config, 'Session should have config');
    }
  });

  test('GET /api/jobs/:sessionId should return detailed metadata', async () => {
    // First get list of jobs
    const listResponse = await fetch(`http://localhost:${PORT}/api/jobs`);
    const listBody = await listResponse.json();

    // Skip if no jobs exist
    if (listBody.sessions.length === 0) {
      console.log('No historical jobs found, skipping detail test');
      return;
    }

    const sessionId = listBody.sessions[0].sessionId;

    // Act: Get detailed metadata
    const response = await fetch(`http://localhost:${PORT}/api/jobs/${sessionId}`);

    // Assert
    assert.strictEqual(response.status, 200, 'Should return 200 OK');
    const body = await response.json();
    assert.ok(body.sessionId, 'Should have sessionId');
    assert.ok(body.date, 'Should have date');
    assert.ok(body.metadata, 'Should have metadata');
    assert.ok(body.metadata.iterations, 'Should have metadata.iterations array');
    assert.ok(Array.isArray(body.metadata.iterations), 'iterations should be array');
  });

  test('GET /api/jobs/:sessionId with invalid ID should return 404', async () => {
    // Act
    const response = await fetch(`http://localhost:${PORT}/api/jobs/ses-999999`);

    // Assert
    assert.strictEqual(response.status, 404, 'Should return 404 for non-existent session');
  });
});

describe('Demo Routes - Jobs Integration (TDD RED)', () => {
  // These tests will FAIL until we implement the new endpoints in demo-routes.js

  test('GET /api/demo/jobs should return job list for demo UI', async () => {
    // Act: This endpoint should be added to demo-routes.js
    const response = await fetch(`http://localhost:${PORT}/api/demo/jobs`);

    // Assert: Should return 200 with sessions (WILL FAIL - endpoint doesn't exist)
    assert.strictEqual(response.status, 200, 'Should return 200 OK');
    const body = await response.json();
    assert.ok(Array.isArray(body.sessions), 'Response should have sessions array');
  });

  test('GET /api/demo/images/:date/:sessionId/:filename should serve old images', async () => {
    // First, find a real session that has image files
    const listResponse = await fetch(`http://localhost:${PORT}/api/jobs`);
    const listBody = await listResponse.json();

    if (listBody.sessions.length === 0) {
      console.log('No historical jobs found, skipping old image test');
      return;
    }

    // Try each session until we find one with image files
    for (const session of listBody.sessions) {
      const date = session.date;
      const sessionId = session.sessionId;

      // Try to get iter0-cand0.png
      const response = await fetch(`http://localhost:${PORT}/api/demo/images/${date}/${sessionId}/iter0-cand0.png`);

      if (response.status === 200) {
        // Found a session with image files - test passes
        const contentType = response.headers.get('content-type');
        assert.strictEqual(contentType, 'image/png', 'Should return PNG content type');
        return;
      }
    }

    // No sessions with image files found - skip test
    console.log('No sessions with image files found, skipping old image test');
  });

  test('GET /api/demo/jobs/:sessionId should return full job metadata', async () => {
    // First get list of jobs using demo endpoint
    const listResponse = await fetch(`http://localhost:${PORT}/api/demo/jobs`);
    const listBody = await listResponse.json();

    if (listBody.sessions.length === 0) {
      console.log('No historical jobs found, skipping detail test');
      return;
    }

    const sessionId = listBody.sessions[0].sessionId;

    // Act: Get detailed metadata via demo route
    const response = await fetch(`http://localhost:${PORT}/api/demo/jobs/${sessionId}`);

    // Assert
    assert.strictEqual(response.status, 200, 'Should return 200 OK');
    const body = await response.json();
    assert.ok(body.sessionId, 'Should have sessionId');
    assert.ok(body.date, 'Should have date');
    assert.ok(body.userPrompt, 'Should have userPrompt');
    assert.ok(body.iterations, 'Should have iterations');
    assert.ok(Array.isArray(body.iterations), 'iterations should be array');
  });
});
