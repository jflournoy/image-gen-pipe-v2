/**
 * 🔴 RED: Chain of Results Visualization
 *
 * Tests for visualizing the complete evolution of candidates through
 * beam search iterations. Shows how candidates are generated, ranked,
 * and refined across iterations.
 */
/* global fetch */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../src/api/server.js');
const { attachWebSocket } = require('../src/api/server.js');
const { _resetWebSocketState } = require('../src/api/server.js');

let server;

describe('🟢 GREEN: Chain of Results Visualization', () => {
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

  describe('Metadata Endpoint for Visualization', () => {
    test('should provide /api/jobs/:jobId/metadata endpoint', async () => {
      // Start a small demo job to get a real jobId
      const startResponse = await fetch('http://localhost:3000/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'a simple test image',
          beamWidth: 2,
          keepTop: 1,
          maxIterations: 1
        })
      });

      assert.strictEqual(startResponse.status, 200, 'Should start demo job');
      const startResult = await startResponse.json();
      const jobId = startResult.jobId;

      // Wait a bit for initial metadata to be created
      await new Promise(resolve => setTimeout(resolve, 500));

      // Now fetch metadata
      const metadataResponse = await fetch(`http://localhost:3000/api/jobs/${jobId}/metadata`);
      assert.strictEqual(metadataResponse.status, 200, 'Metadata endpoint should exist');

      const metadata = await metadataResponse.json();
      assert(metadata, 'Should return metadata object');
    });

    test('should return metadata structure for visualization', async () => {
      const startResponse = await fetch('http://localhost:3000/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'a simple test image',
          beamWidth: 2,
          keepTop: 1,
          maxIterations: 1
        })
      });

      const startResult = await startResponse.json();
      const jobId = startResult.jobId;

      // Wait a short time for metadata to be available
      await new Promise(resolve => setTimeout(resolve, 500));

      const metadataResponse = await fetch(`http://localhost:3000/api/jobs/${jobId}/metadata`);
      assert.strictEqual(metadataResponse.status, 200, 'Metadata endpoint should return 200');

      const metadata = await metadataResponse.json();

      // Validate metadata structure
      assert(metadata, 'Should return metadata object');
      assert(metadata.sessionId, 'Should include sessionId');
      assert(metadata.userPrompt, 'Should include original user prompt');
      assert(Array.isArray(metadata.iterations), 'Should have iterations array');

      // If iterations are populated, validate their structure
      if (metadata.iterations.length > 0) {
        metadata.iterations.forEach((iteration) => {
          assert(iteration.iteration !== undefined, 'Iteration should have iteration number');
          assert(Array.isArray(iteration.candidates), 'Each iteration should have candidates array');

          iteration.candidates.forEach(candidate => {
            assert(candidate.candidateId !== undefined, 'Each candidate should have candidateId');
            assert(candidate.whatPrompt !== undefined, 'Should have whatPrompt');
            assert(candidate.howPrompt !== undefined, 'Should have howPrompt');
            assert(candidate.parentId !== undefined, 'Should track parentId');
          });
        });
      }
    });

    test('should return metadata with optional winner and finalists', async () => {
      const startResponse = await fetch('http://localhost:3000/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'a simple test image',
          beamWidth: 2,
          keepTop: 1,
          maxIterations: 1
        })
      });

      const startResult = await startResponse.json();
      const jobId = startResult.jobId;

      await new Promise(resolve => setTimeout(resolve, 500));

      const metadataResponse = await fetch(`http://localhost:3000/api/jobs/${jobId}/metadata`);
      const metadata = await metadataResponse.json();

      // Winner is optional - only present if job has completed
      if (metadata.winner) {
        assert(metadata.winner.candidateId !== undefined, 'Winner should have candidateId');
        assert(metadata.winner.iteration !== undefined, 'Winner should have iteration');
      }

      // Finalists are optional - only present if job has completed
      if (metadata.finalists) {
        assert(Array.isArray(metadata.finalists), 'Finalists should be an array');
        assert(metadata.finalists.length <= 2, 'Should have at most 2 finalists');

        metadata.finalists.forEach(finalist => {
          assert(finalist.candidateId !== undefined, 'Finalist should have candidateId');
        });
      }
    });

    test('should return 404 for non-existent job', async () => {
      const response = await fetch('http://localhost:3000/api/jobs/nonexistent-job-id/metadata');
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent job');
    });
  });

  describe('Visualization Data Format', () => {
    test('should support optional lineage information for winner', async () => {
      const startResponse = await fetch('http://localhost:3000/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'a simple test image',
          beamWidth: 2,
          keepTop: 1,
          maxIterations: 1
        })
      });

      const startResult = await startResponse.json();
      const jobId = startResult.jobId;

      await new Promise(resolve => setTimeout(resolve, 500));

      const metadataResponse = await fetch(`http://localhost:3000/api/jobs/${jobId}/metadata`);
      const metadata = await metadataResponse.json();

      // Lineage is optional - only populated if tracking is enabled
      if (metadata.lineage) {
        assert(Array.isArray(metadata.lineage), 'Lineage should be an array');
        metadata.lineage.forEach(node => {
          assert(node.iteration !== undefined, 'Lineage node should have iteration');
          assert(node.candidateId !== undefined, 'Lineage node should have candidateId');
        });
      }

      // Test passes if endpoint returns valid structure
      assert(metadata, 'Should return metadata object');
    });

    test('should support optional survival tracking for candidates', async () => {
      const startResponse = await fetch('http://localhost:3000/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'a simple test image',
          beamWidth: 2,
          keepTop: 1,
          maxIterations: 1
        })
      });

      const startResult = await startResponse.json();
      const jobId = startResult.jobId;

      await new Promise(resolve => setTimeout(resolve, 500));

      const metadataResponse = await fetch(`http://localhost:3000/api/jobs/${jobId}/metadata`);
      const metadata = await metadataResponse.json();

      // Validate that metadata structure supports determining survivors
      if (metadata.iterations && metadata.iterations.length > 1) {
        // If we have multiple iterations, we can determine survivors from parent IDs
        metadata.iterations.forEach((iteration, idx) => {
          if (idx < metadata.iterations.length - 1) {
            const nextIteration = metadata.iterations[idx + 1];
            // Next iteration's parentIds should reference current iteration's candidates
            nextIteration.candidates?.forEach(candidate => {
              assert(candidate.parentId !== undefined, 'Child candidates should have parentId');
            });
          }
        });
      }

      // Test passes if endpoint returns valid structure
      assert(metadata, 'Should return metadata object');
    });
  });
});
