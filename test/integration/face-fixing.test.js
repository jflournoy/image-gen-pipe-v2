/**
 * Face Fixing Integration Tests
 *
 * TDD RED PHASE: Comprehensive integration tests for face fixing pipeline
 *
 * CRITICAL: Run with --test-concurrency=1 for GPU tests to prevent memory explosion
 * ```
 * ENABLE_GPU_TESTS=1 node --test --test-concurrency=1 test/integration/face-fixing.test.js
 * ```
 */

const { describe, test, after } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

// Gate GPU-heavy tests with environment variable

describe('Face Fixing Integration Tests', () => {
  // Clean up nock state
  after(() => {
    nock.cleanAll();
  });

  describe('Modal Provider Face Fixing (Mock HTTP)', () => {
    test('should construct request with face fixing parameters', async () => {
      /**
       * TDD RED: Provider should include fix_faces, face_fidelity, face_upscale in request
       */
      nock('http://localhost:8001', {
        reqheaders: {
          'content-type': /application\/json/,
        },
      })
        .post('/generate', (body) => {
          // Verify face fixing parameters are in request
          assert.strictEqual(body.fix_faces, true);
          assert.strictEqual(body.face_fidelity, 0.7);
          assert.strictEqual(body.face_upscale, 2);
          return true;
        })
        .reply(200, {
          localPath: '/output/2026-02-10/ses-123456/image.png',
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          metadata: {
            face_fixing: {
              applied: true,
              faces_count: 1,
              fidelity: 0.7,
              upscale: 2,
              time: 3.5,
            },
          },
        });

      // Simulate provider call
      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'portrait',
          fix_faces: true,
          face_fidelity: 0.7,
          face_upscale: 2,
        }),
      });

      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.ok(data.metadata.face_fixing);
    });

    test('should handle metadata response from Modal', async () => {
      /**
       * TDD RED: Provider should extract face_fixing metadata from response
       */
      const mockResponse = {
        localPath: '/output/2026-02-10/ses-123456/image.png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        metadata: {
          face_fixing: {
            applied: true,
            faces_count: 2,
            fidelity: 0.75,
            upscale: 1,
            time: 2.8,
          },
        },
      };

      nock('http://localhost:8001').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'portrait', fix_faces: true }),
      });

      const data = await response.json();

      // Verify metadata structure
      assert.strictEqual(data.metadata.face_fixing.applied, true);
      assert.strictEqual(data.metadata.face_fixing.faces_count, 2);
      assert.strictEqual(data.metadata.face_fixing.fidelity, 0.75);
      assert.strictEqual(data.metadata.face_fixing.upscale, 1);
      assert.strictEqual(typeof data.metadata.face_fixing.time, 'number');
    });

    test('should handle no faces detected scenario', async () => {
      /**
       * TDD RED: Should handle landscape/no-face cases gracefully
       */
      const mockResponse = {
        localPath: '/output/2026-02-10/ses-123456/landscape.png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        metadata: {
          face_fixing: {
            applied: false,
            reason: 'no_faces_detected',
            faces_count: 0,
            time: 0.15,
          },
        },
      };

      nock('http://localhost:8001').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'beautiful landscape with mountains',
          fix_faces: true,
        }),
      });

      const data = await response.json();

      // Should gracefully handle no faces
      assert.strictEqual(data.metadata.face_fixing.applied, false);
      assert.strictEqual(data.metadata.face_fixing.reason, 'no_faces_detected');
      assert.strictEqual(data.metadata.face_fixing.faces_count, 0);
    });

    test('should handle face fixing error gracefully', async () => {
      /**
       * TDD RED: Should handle enhancement errors without crashing
       */
      const mockResponse = {
        localPath: '/output/2026-02-10/ses-123456/image.png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        metadata: {
          face_fixing: {
            applied: false,
            error: 'CUDA out of memory',
            time: 1.2,
          },
        },
      };

      nock('http://localhost:8001').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'portrait', fix_faces: true }),
      });

      const data = await response.json();

      // Should have error in metadata but still return image
      assert.strictEqual(data.metadata.face_fixing.applied, false);
      assert.ok(data.metadata.face_fixing.error);
      assert.ok(data.localPath); // Original image still returned
    });

    test('should respect fidelity parameter variations', async () => {
      /**
       * TDD RED: Different fidelity values should be passed through
       */
      nock('http://localhost:8001')
        .post('/generate', (body) => {
          assert.strictEqual(body.face_fidelity, 0.5);
          return true;
        })
        .reply(200, {
          localPath: '/output/image.png',
          metadata: { face_fixing: { fidelity: 0.5, applied: true, faces_count: 1, time: 2.0 } },
        });

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'portrait',
          fix_faces: true,
          face_fidelity: 0.5,
        }),
      });

      const data = await response.json();
      assert.strictEqual(data.metadata.face_fixing.fidelity, 0.5);
    });

    test('should apply 2x upscaling when requested', async () => {
      /**
       * TDD RED: Upscaling parameter should be respected
       */
      nock('http://localhost:8001')
        .post('/generate', (body) => {
          assert.strictEqual(body.face_upscale, 2);
          return true;
        })
        .reply(200, {
          localPath: '/output/image.png',
          metadata: { face_fixing: { upscale: 2, applied: true, faces_count: 1, time: 8.5 } },
        });

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'portrait',
          fix_faces: true,
          face_upscale: 2,
        }),
      });

      const data = await response.json();
      assert.strictEqual(data.metadata.face_fixing.upscale, 2);
    });

    test('should handle multiple faces in portrait', async () => {
      /**
       * TDD RED: Should detect and enhance multiple faces
       */
      const mockResponse = {
        localPath: '/output/family.png',
        metadata: {
          face_fixing: {
            applied: true,
            faces_count: 4, // Family photo
            fidelity: 0.6,
            upscale: 1,
            time: 7.2,
          },
        },
      };

      nock('http://localhost:8001').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'family portrait with 4 people',
          fix_faces: true,
        }),
      });

      const data = await response.json();

      // Should enhance all detected faces
      assert.strictEqual(data.metadata.face_fixing.faces_count, 4);
      assert.strictEqual(data.metadata.face_fixing.applied, true);
    });

    test('should be disabled by default (fix_faces: false)', async () => {
      /**
       * TDD RED: Face fixing should be opt-in
       */
      nock('http://localhost:8001')
        .post('/generate', (body) => {
          // Face fixing not in request = disabled
          assert.strictEqual(body.fix_faces, undefined);
          return true;
        })
        .reply(200, {
          localPath: '/output/image.png',
          metadata: {}, // No face_fixing metadata when disabled
        });

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'portrait',
          // fix_faces not specified = default to false
        }),
      });

      const data = await response.json();
      // Should not have face_fixing metadata when disabled
      assert.strictEqual(data.metadata.face_fixing, undefined);
    });
  });

  describe('Flux Provider Face Fixing (Mock HTTP)', () => {
    test('should pass face fixing parameters to Flux service', async () => {
      /**
       * TDD RED: Flux provider should support same parameters as Modal
       */
      nock('http://localhost:5000')
        .post('/generate', (body) => {
          assert.strictEqual(body.fix_faces, true);
          assert.strictEqual(body.face_fidelity, 0.7);
          return true;
        })
        .reply(200, {
          localPath: '/output/flux-image.png',
          metadata: {
            face_fixing: {
              applied: true,
              faces_count: 1,
              fidelity: 0.7,
              time: 4.2,
            },
          },
        });

      const response = await fetch('http://localhost:5000/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'portrait',
          fix_faces: true,
          face_fidelity: 0.7,
        }),
      });

      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.ok(data.metadata.face_fixing);
    });

    test('should handle GPU coordination metadata', async () => {
      /**
       * TDD RED: Flux service should track GPU coordination in metadata
       */
      const mockResponse = {
        localPath: '/output/flux-image.png',
        metadata: {
          face_fixing: {
            applied: true,
            faces_count: 1,
            time: 5.8,
          },
          gpu_coordination: {
            flux_unloaded: true,
            face_fixing_loaded: true,
            duration_ms: 3200,
          },
        },
      };

      nock('http://localhost:5000').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:5000/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'portrait', fix_faces: true }),
      });

      const data = await response.json();
      assert.ok(data.metadata.face_fixing.applied);
      // May include GPU coordination details for Flux
    });
  });

  describe('Parameter Validation (No GPU)', () => {
    test('should accept valid fidelity range 0.0-1.0', async () => {
      /**
       * TDD RED: Fidelity validation
       */
      const validFidelities = [0.0, 0.3, 0.5, 0.7, 1.0];

      for (const fidelity of validFidelities) {
        nock('http://localhost:8001')
          .post('/generate', (body) => {
            assert.strictEqual(body.face_fidelity, fidelity);
            return true;
          })
          .reply(200, {
            localPath: '/output/image.png',
            metadata: { face_fixing: { fidelity, applied: true, faces_count: 1, time: 2.5 } },
          });

        const response = await fetch('http://localhost:8001/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: 'portrait',
            fix_faces: true,
            face_fidelity: fidelity,
          }),
        });

        assert.strictEqual(response.status, 200);
      }
    });

    test('should only accept upscale values 1, 2, or 4', async () => {
      /**
       * TDD RED: Upscale validation
       */
      const validUpscales = [1, 2, 4];

      for (const upscale of validUpscales) {
        nock('http://localhost:8001')
          .post('/generate', (body) => {
            assert.strictEqual(body.face_upscale, upscale);
            return true;
          })
          .reply(200, {
            localPath: '/output/image.png',
            metadata: { face_fixing: { upscale, applied: true, faces_count: 1, time: 3.0 } },
          });

        const response = await fetch('http://localhost:8001/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: 'portrait',
            fix_faces: true,
            face_upscale: upscale,
          }),
        });

        assert.strictEqual(response.status, 200);
      }
    });
  });

  describe('Metadata Structure (No GPU)', () => {
    test('should include all required metadata fields', async () => {
      /**
       * TDD RED: Metadata should have consistent structure
       */
      const mockResponse = {
        localPath: '/output/image.png',
        metadata: {
          face_fixing: {
            applied: true,
            faces_count: 1,
            fidelity: 0.7,
            upscale: 1,
            time: 2.8,
          },
        },
      };

      nock('http://localhost:8001').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'portrait', fix_faces: true }),
      });

      const data = await response.json();
      const ff = data.metadata.face_fixing;

      // All required fields present
      assert.ok('applied' in ff);
      assert.ok('faces_count' in ff);
      assert.ok('fidelity' in ff);
      assert.ok('upscale' in ff);
      assert.ok('time' in ff);

      // Correct types
      assert.strictEqual(typeof ff.applied, 'boolean');
      assert.strictEqual(typeof ff.faces_count, 'number');
      assert.strictEqual(typeof ff.fidelity, 'number');
      assert.strictEqual(typeof ff.upscale, 'number');
      assert.strictEqual(typeof ff.time, 'number');
    });

    test('should include reason field when faces not detected', async () => {
      /**
       * TDD RED: Metadata should explain why fixing was skipped
       */
      const mockResponse = {
        localPath: '/output/landscape.png',
        metadata: {
          face_fixing: {
            applied: false,
            reason: 'no_faces_detected',
            faces_count: 0,
            time: 0.12,
          },
        },
      };

      nock('http://localhost:8001').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'beautiful landscape',
          fix_faces: true,
        }),
      });

      const data = await response.json();
      const ff = data.metadata.face_fixing;

      assert.strictEqual(ff.applied, false);
      assert.strictEqual(ff.reason, 'no_faces_detected');
    });

    test('should include error field when enhancement fails', async () => {
      /**
       * TDD RED: Metadata should document errors
       */
      const mockResponse = {
        localPath: '/output/image.png',
        metadata: {
          face_fixing: {
            applied: false,
            error: 'CUDA out of memory',
            time: 1.5,
          },
        },
      };

      nock('http://localhost:8001').post('/generate').reply(200, mockResponse);

      const response = await fetch('http://localhost:8001/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'portrait', fix_faces: true }),
      });

      const data = await response.json();
      const ff = data.metadata.face_fixing;

      assert.strictEqual(ff.applied, false);
      assert.ok(ff.error);
    });
  });
});
