/**
 * 🔴 RED: Web Interface Demo with Rate Limiting Visualization
 *
 * Tests for a web-based demo that shows rate limiting in action.
 * This demo should help users understand how rate limits work.
 */
/* global fetch */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../src/api/server.js');
const { attachWebSocket } = require('../src/api/server.js');
const { _resetWebSocketState } = require('../src/api/server.js');

let server;

describe.skip('🔴 RED: Web Demo - Rate Limiting Visualization', () => {
  before(async () => {
    server = await startServer(3000);
    attachWebSocket(server);
  });

  after(() => {
    return new Promise((resolve) => {
      _resetWebSocketState();
      server.close(resolve);
    });
  });
  describe('Demo Configuration Endpoint', () => {
    test('should have /api/demo/config endpoint', async () => {
      // This endpoint should return current rate limiting configuration
      // Users can see what limits are active
      const response = await fetch('http://localhost:3000/api/demo/config');

      assert.strictEqual(response.status, 200, 'Config endpoint should exist');

      const config = await response.json();
      assert(config.rateLimits, 'Should include rate limits in config');
      assert(config.rateLimits.llm, 'Should show LLM rate limit');
      assert(config.rateLimits.imageGen, 'Should show image gen rate limit');
      assert(config.rateLimits.vision, 'Should show vision rate limit');
    });

    test('should show environment variable names for configuration', async () => {
      const response = await fetch('http://localhost:3000/api/demo/config');
      const config = await response.json();

      assert(config.envVars, 'Should document environment variables');
      assert(
        config.envVars.includes('BEAM_SEARCH_RATE_LIMIT_LLM'),
        'Should document LLM env var'
      );
    });
  });

  describe('Demo Rate Limiting Status', () => {
    test('should provide real-time rate limit status', async () => {
      // This endpoint shows current queue status for each provider
      const response = await fetch('http://localhost:3000/api/demo/rate-limits/status');

      assert.strictEqual(response.status, 200, 'Status endpoint should exist');

      const status = await response.json();
      assert(status.llm, 'Should show LLM rate limit status');
      assert(status.imageGen, 'Should show image gen rate limit status');
      assert(status.vision, 'Should show vision rate limit status');

      // Each status should show active and queued requests
      assert.strictEqual(typeof status.llm.active, 'number', 'Should show active LLM requests');
      assert.strictEqual(typeof status.llm.queued, 'number', 'Should show queued LLM requests');
      assert.strictEqual(typeof status.llm.limit, 'number', 'Should show LLM concurrency limit');
    });
  });

  describe('Demo Job with Rate Limiting Visualization', () => {
    test('should start demo job with small beam width', async () => {
      // Start a small demo job (beamWidth=2) to show rate limiting
      const response = await fetch('http://localhost:3000/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'a simple test image',
          beamWidth: 2,
          keepTop: 1,
          maxIterations: 1
        })
      });

      assert.strictEqual(response.status, 200, 'Should start demo job');

      const result = await response.json();
      assert(result.jobId, 'Should return job ID');
      assert(result.config, 'Should return job config including rate limits');
      assert(result.config.rateLimits, 'Should show rate limits for this job');
    });

    test('should provide progress updates showing rate limiting', async () => {
      // The progress updates should include rate limiting information
      // This is typically done via WebSocket, but we can test the data structure
      const response = await fetch('http://localhost:3000/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'test',
          beamWidth: 2,
          keepTop: 1,
          maxIterations: 1
        })
      });

      const { jobId } = await response.json();

      // Get progress for this job
      const progressResponse = await fetch(`http://localhost:3000/api/demo/progress/${jobId}`);
      assert.strictEqual(progressResponse.status, 200, 'Should get progress');

      const progress = await progressResponse.json();
      assert(progress.rateLimitStatus, 'Progress should include rate limit status');
    });
  });

  describe('Demo Static Files', () => {
    test('should serve demo HTML page', async () => {
      const response = await fetch('http://localhost:3000/demo');

      assert.strictEqual(response.status, 200, 'Demo page should exist');

      const html = await response.text();
      assert(html.includes('Rate Limiting'), 'Demo page should mention rate limiting');
      assert(html.includes('Beam Search'), 'Demo page should explain beam search');
    });

    test('should include rate limiting visualization', async () => {
      const response = await fetch('http://localhost:3000/demo');
      const html = await response.text();

      // Should have UI elements for showing rate limits
      assert(
        html.includes('rate-limit') || html.includes('rateLimitStatus'),
        'Demo should have rate limit visualization elements'
      );
    });
  });
});
