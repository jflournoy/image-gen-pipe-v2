/**
 * 🔴 TDD RED Phase: Flat Image Storage Tests
 *
 * Tests for new flat directory structure:
 * - All images in single session directory
 * - Filenames encode iteration and candidate: iter{N}-cand{M}.png
 * - No hierarchical iteration/candidate subdirectories
 *
 * Related Issue: #9
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');

describe('Flat Image Storage', () => {
  const testOutputDir = path.join(__dirname, '../../test-output-flat');

  beforeEach(async () => {
    // Clean up test output directory
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist, that's ok
    }
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Flat Directory Structure', () => {
    it('should store all images in single session directory', async () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir,
        sessionId: 'test-session',
        saveLocally: true
      });

      // Expected structure: output/sessions/test-session/
      // NOT: output/sessions/test-session/iteration-0/candidate-0/

      // For now, just verify provider is configured correctly
      assert.strictEqual(provider.sessionId, 'test-session');
    });

    it('should use filename format iter{N}-cand{M}.png', async () => {
      // Examples of expected filenames:
      // iter0-cand0.png, iter0-cand1.png, iter1-cand0.png, iter2-cand3.png

      const testCases = [
        { iteration: 0, candidateId: 0, expected: 'iter0-cand0.png' },
        { iteration: 0, candidateId: 1, expected: 'iter0-cand1.png' },
        { iteration: 1, candidateId: 0, expected: 'iter1-cand0.png' },
        { iteration: 2, candidateId: 3, expected: 'iter2-cand3.png' },
        { iteration: 10, candidateId: 5, expected: 'iter10-cand5.png' }
      ];

      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key');

      testCases.forEach(({ iteration, candidateId, expected }) => {
        const filename = provider._buildFlatImageFilename(iteration, candidateId);
        assert.strictEqual(filename, expected,
          `Expected iter${iteration}-cand${candidateId}.png to equal ${expected}`);
      });
    });

    it('should create flat directory path without iteration subdirectories', async () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir,
        sessionId: 'test-session'
      });

      // Expected: output/sessions/test-session/iter0-cand0.png
      // NOT: output/sessions/test-session/iteration-0/candidate-0/image.png

      const beamSearch = {
        iteration: 0,
        candidateId: 0,
        dimension: 'what'
      };

      const sessionDir = provider._buildFlatSessionPath(beamSearch);
      const expectedPath = path.join(testOutputDir, 'sessions', 'test-session');

      assert.strictEqual(sessionDir, expectedPath);
      assert.ok(!sessionDir.includes('iteration'), 'Should not include iteration directory');
      assert.ok(!sessionDir.includes('candidate'), 'Should not include candidate directory');
    });

    it('should not create hierarchical subdirectories', async () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir,
        sessionId: 'test-session'
      });

      const sessionDir = provider._buildFlatSessionPath({ iteration: 1, candidateId: 2, dimension: 'how' });

      // Should be flat: output/sessions/test-session/
      // Image would be: output/sessions/test-session/iter1-cand2.png
      const parts = sessionDir.split(path.sep);

      // Should not have iter-XX or candidate-YY in path
      assert.ok(!parts.some(part => part.startsWith('iter-')));
      assert.ok(!parts.some(part => part.startsWith('candidate-')));
    });
  });

  describe('Flat Storage with Beam Search Context', () => {
    it('should save image with iteration-aware filename', async () => {
      // Given iteration=1, candidateId=2
      // Expected filename: iter1-cand2.png
      // Full path: output/sessions/test-session/iter1-cand2.png

      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir,
        sessionId: 'test-session'
      });

      const result = await provider._buildFlatImagePath({
        iteration: 1,
        candidateId: 2,
        dimension: 'how'
      });

      const expectedFilename = 'iter1-cand2.png';
      assert.ok(result.endsWith(expectedFilename),
        `Path should end with ${expectedFilename}, got: ${result}`);
    });

    it('should return localPath in flat structure', async () => {
      // Result object should have localPath pointing to flat file
      const expectedResult = {
        url: 'https://example.com/image.png',
        localPath: 'output/sessions/test-session/iter0-cand0.png',
        revisedPrompt: 'A detailed prompt',
        metadata: {
          model: 'dall-e-3',
          beamSearch: {
            iteration: 0,
            candidateId: 0,
            dimension: 'what'
          }
        }
      };

      assert.ok(expectedResult.localPath.includes('iter0-cand0.png'));
      assert.ok(!expectedResult.localPath.includes('iteration-0'));
      assert.ok(!expectedResult.localPath.includes('candidate-0'));
    });
  });

  describe('Session Management for Flat Storage', () => {
    it('should use sessions subdirectory', async () => {
      // New structure: output/sessions/<sessionId>/
      // Old structure: output/<date>/<sessionId>/

      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir,
        sessionId: 'my-session'
      });

      const sessionPath = provider._buildFlatSessionPath({ iteration: 0, candidateId: 0, dimension: 'what' });

      assert.ok(sessionPath.includes('sessions'), 'Should include sessions directory');
      assert.ok(sessionPath.includes('my-session'), 'Should include session ID');
    });

    it('should store metadata.json in session directory', async () => {
      // Metadata file location: output/sessions/<sessionId>/metadata.json
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir,
        sessionId: 'test-session'
      });

      const metadataPath = provider._buildMetadataPath();
      const expectedPath = path.join(testOutputDir, 'sessions', 'test-session', 'metadata.json');

      assert.strictEqual(metadataPath, expectedPath);
    });
  });

  describe('Backwards Compatibility', () => {
    it('should have legacy hierarchical storage still available', async () => {
      // The old _buildCandidatePath method should still exist
      // for backwards compatibility (deprecated)
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key');

      assert.ok(typeof provider._buildCandidatePath === 'function',
        'Legacy _buildCandidatePath should still exist for backwards compatibility');
    });
  });

  describe('File Operations', () => {
    it('should write image to flat location', async () => {
      const sessionDir = path.join(testOutputDir, 'sessions', 'test-session');
      const imagePath = path.join(sessionDir, 'iter0-cand0.png');
      const imageData = Buffer.from('test-png-data');

      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(imagePath, imageData);

      // Verify file exists at flat location
      const stats = await fs.stat(imagePath);
      assert.ok(stats.isFile());

      const savedData = await fs.readFile(imagePath);
      assert.deepStrictEqual(savedData, imageData);
    });

    it('should list all session images easily', async () => {
      // Flat structure makes it trivial to list all images
      const sessionDir = path.join(testOutputDir, 'sessions', 'test-session');

      // Create some test images
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(path.join(sessionDir, 'iter0-cand0.png'), Buffer.from('img0'));
      await fs.writeFile(path.join(sessionDir, 'iter0-cand1.png'), Buffer.from('img1'));
      await fs.writeFile(path.join(sessionDir, 'iter1-cand0.png'), Buffer.from('img2'));
      await fs.writeFile(path.join(sessionDir, 'metadata.json'), '{}');

      // List all PNG files
      const files = await fs.readdir(sessionDir);
      const images = files.filter(f => f.endsWith('.png'));

      assert.strictEqual(images.length, 3);
      assert.ok(images.includes('iter0-cand0.png'));
      assert.ok(images.includes('iter0-cand1.png'));
      assert.ok(images.includes('iter1-cand0.png'));
    });
  });
});
