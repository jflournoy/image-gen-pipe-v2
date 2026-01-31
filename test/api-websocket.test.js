/**
 * @file WebSocket API Tests (TDD RED Phase)
 * Tests for WebSocket real-time progress updates
 */

import { test } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { findAvailablePort } from './test-utils.js';

test('🔴 RED: WebSocket connection', async (t) => {
  await t.test('should establish WebSocket connection', async () => {
    // Arrange: Start server with WebSocket support
    const { createApp, attachWebSocket, _resetWebSocketState } = await import('../src/api/server.js');

    // Reset state from any previous tests
    _resetWebSocketState();

    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);

    // Wait for server to be ready
    await new Promise((resolve) => server.on('listening', resolve));

    // Attach WebSocket server
    attachWebSocket(server);

    // Act: Connect to WebSocket
    const ws = new WebSocket(`ws://localhost:${port}`);

    const connectionEstablished = await new Promise((resolve, reject) => {
      ws.on('open', () => resolve(true));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    // Assert: Connection should be established
    assert.ok(connectionEstablished, 'WebSocket connection should be established');
    assert.strictEqual(ws.readyState, WebSocket.OPEN, 'WebSocket should be open');

    // Cleanup
    ws.close();
    _resetWebSocketState();
    await new Promise((resolve) => server.close(resolve));
  });
});

test('🔴 RED: WebSocket progress updates', async (t) => {
  await t.test('should receive progress updates for beam search job', async () => {
    // Arrange: Start server with WebSocket
    const { createApp, attachWebSocket, _resetWebSocketState } = await import('../src/api/server.js');

    _resetWebSocketState();

    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);
    await new Promise((resolve) => server.on('listening', resolve));
    attachWebSocket(server);

    // Connect WebSocket
    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws.on('open', resolve));

    // Subscribe to job updates
    const jobId = 'test-job-123';
    ws.send(JSON.stringify({ type: 'subscribe', jobId }));

    // Act: Simulate progress update (this would normally come from beam search)
    const progressMessages = [];
    ws.on('message', (data) => {
      progressMessages.push(JSON.parse(data.toString()));
    });

    // Wait a bit for any initial messages
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: Should have subscription confirmation
    assert.ok(progressMessages.length > 0, 'Should receive messages');
    const firstMessage = progressMessages[0];
    assert.strictEqual(firstMessage.type, 'subscribed', 'Should confirm subscription');
    assert.strictEqual(firstMessage.jobId, jobId, 'Should confirm correct jobId');

    // Cleanup
    ws.close();
    _resetWebSocketState();
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('should receive iteration progress events', async () => {
    // Arrange: Start server
    const { createApp, attachWebSocket, emitProgress, _resetWebSocketState } = await import('../src/api/server.js');

    _resetWebSocketState();

    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);
    await new Promise((resolve) => server.on('listening', resolve));
    attachWebSocket(server);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws.on('open', resolve));

    const jobId = 'test-job-456';
    ws.send(JSON.stringify({ type: 'subscribe', jobId }));

    const progressMessages = [];
    ws.on('message', (data) => {
      progressMessages.push(JSON.parse(data.toString()));
    });

    // Wait for subscription
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Act: Emit progress from server side
    emitProgress(jobId, {
      type: 'iteration',
      iteration: 1,
      totalIterations: 3,
      candidatesCount: 4,
      bestScore: 85.5
    });

    // Wait for message
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: Should receive progress event
    const progressEvent = progressMessages.find(m => m.type === 'iteration');
    assert.ok(progressEvent, 'Should receive iteration progress event');
    assert.strictEqual(progressEvent.iteration, 1, 'Should have iteration number');
    assert.strictEqual(progressEvent.bestScore, 85.5, 'Should have best score');

    // Cleanup
    ws.close();
    _resetWebSocketState();
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('should receive completion event', async () => {
    // Arrange: Start server
    const { createApp, attachWebSocket, emitProgress, _resetWebSocketState } = await import('../src/api/server.js');

    _resetWebSocketState();

    const app = createApp();
    const port = await findAvailablePort();
    const server = app.listen(port);
    await new Promise((resolve) => server.on('listening', resolve));
    attachWebSocket(server);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws.on('open', resolve));

    const jobId = 'test-job-789';
    ws.send(JSON.stringify({ type: 'subscribe', jobId }));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Act: Emit completion
    emitProgress(jobId, {
      type: 'complete',
      result: {
        bestCandidate: {
          what: 'Serene mountain landscape',
          how: 'with misty peaks at sunrise',
          totalScore: 92.3
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: Should receive completion event
    const completeEvent = messages.find(m => m.type === 'complete');
    assert.ok(completeEvent, 'Should receive completion event');
    assert.ok(completeEvent.result, 'Should include result');
    assert.strictEqual(completeEvent.result.bestCandidate.totalScore, 92.3, 'Should have final score');

    // Cleanup
    ws.close();
    _resetWebSocketState();
    await new Promise((resolve) => server.close(resolve));
  });
});
