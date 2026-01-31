/**
 * 🔴 RED: Provider Model Download Tests
 *
 * Tests for the model download functionality via the provider API.
 * Tests both the Node.js proxy and the integration with the LLM service.
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// Helper to make HTTP requests
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Provider Model Download API', () => {
  let serverAvailable = false;

  before(async () => {
    // Check if Node.js server is running
    try {
      const res = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: '/health',
        method: 'GET'
      });
      serverAvailable = res.status === 200;
    } catch {
      serverAvailable = false;
    }
  });

  test('POST /api/providers/models/download should require type and model', async (t) => {
    if (!serverAvailable) {
      t.skip('Server not available');
      return;
    }

    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/providers/models/download',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({}));

    assert.strictEqual(response.status, 400, 'Should return 400 for missing params');
    const body = JSON.parse(response.data);
    assert(body.error, 'Should have error message');
  });

  test('POST /api/providers/models/download should return SSE stream', async (t) => {
    if (!serverAvailable) {
      t.skip('Server not available');
      return;
    }

    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/providers/models/download',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ type: 'local-llm', model: 'test-model' }));

    assert.strictEqual(response.headers['content-type'], 'text/event-stream',
      'Should return SSE content type');
  });

  test('POST /api/providers/models/download should stream progress events', async (t) => {
    if (!serverAvailable) {
      t.skip('Server not available');
      return;
    }

    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/providers/models/download',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ type: 'local-llm', model: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF' }));

    // Parse SSE events
    const events = response.data.split('\n\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.substring(6)));

    assert.ok(events.length > 0, 'Should have at least one event');
    assert.strictEqual(events[0].status, 'started', 'First event should be started');
  });
});

describe('LLM Service Download Endpoint (Direct)', () => {
  let llmServiceAvailable = false;

  before(async () => {
    try {
      const res = await makeRequest({
        hostname: 'localhost',
        port: 8003,
        path: '/health',
        method: 'GET'
      });
      llmServiceAvailable = res.status === 200;
    } catch {
      llmServiceAvailable = false;
    }
  });

  test('GET /download/status should return download status', async (t) => {
    if (!llmServiceAvailable) {
      t.skip('LLM service not available');
      return;
    }

    const response = await makeRequest({
      hostname: 'localhost',
      port: 8003,
      path: '/download/status',
      method: 'GET'
    });

    assert.strictEqual(response.status, 200, 'Should return 200');
    const body = JSON.parse(response.data);
    assert(['cached', 'not_downloaded', 'unknown', 'error'].includes(body.status),
      'Should have valid status');
  });

  test('POST /download should accept repo_id and filename', async (t) => {
    if (!llmServiceAvailable) {
      t.skip('LLM service not available');
      return;
    }

    // Use a timeout to not wait for full download
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await makeRequest({
        hostname: 'localhost',
        port: 8003,
        path: '/download',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, JSON.stringify({
        repo_id: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
        filename: '*Q4_K_M.gguf'
      }));

      // Should return SSE stream
      assert.ok(response.headers['content-type'].startsWith('text/event-stream'),
        'Should return SSE content type');

      // Parse first event
      const firstEvent = response.data.split('\n\n')[0];
      if (firstEvent.startsWith('data: ')) {
        const event = JSON.parse(firstEvent.substring(6));
        assert.strictEqual(event.status, 'started', 'First event should be started');
      }
    } finally {
      clearTimeout(timeout);
    }
  });

  test('POST /download should resolve glob patterns to actual filenames', async (t) => {
    if (!llmServiceAvailable) {
      t.skip('LLM service not available');
      return;
    }

    const response = await makeRequest({
      hostname: 'localhost',
      port: 8003,
      path: '/download',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({
      repo_id: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
      filename: '*Q4_K_M.gguf'
    }));

    // Parse events to find the "Found model" message
    const events = response.data.split('\n\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.substring(6)));

    const foundEvent = events.find(e => e.message && e.message.includes('Found model'));
    assert.ok(foundEvent, 'Should have a "Found model" event');
    assert.ok(foundEvent.message.includes('.gguf'), 'Should resolve to actual .gguf filename');
  });
});
