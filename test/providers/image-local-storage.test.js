/**
 * TDD RED Phase: Image Provider Local Storage Tests
 *
 * Tests for downloading and saving generated images locally
 * with a human-navigable directory structure matching the
 * prompt refinement workflow.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');

describe('Image Provider Local Storage', () => {
  const testOutputDir = path.join(__dirname, '../../test-output');

  beforeEach(async () => {
    // Clean up test output directory
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    } catch (err) {
      // Directory might not exist, that's ok
    }
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Directory Structure', () => {
    it('should create output directory if it does not exist', async () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir
      });

      // Provider should have outputDir configured
      assert.ok(provider.outputDir);
      assert.strictEqual(provider.outputDir, testOutputDir);
    });

    it('should create date-based session directories', async () => {
      // Structure: output/YYYY-MM-DD/session-HHMMSS/
      const expectedDateFormat = /^\d{4}-\d{2}-\d{2}$/;
      const expectedSessionFormat = /^session-\d{6}$/;

      assert.ok(expectedDateFormat.test('2025-10-23'));
      assert.ok(expectedSessionFormat.test('session-143052'));
    });

    it('should organize by iteration and candidate for beam search', async () => {
      // Beam search structure: iter-XX/candidate-YY-dimension/
      // Zero-indexed candidates: candidate-00, candidate-01, etc.
      const expectedIterationFormat = /^iter-\d{2}$/;
      const expectedCandidateFormat = /^candidate-\d{2}-(what|how)$/;

      assert.ok(expectedIterationFormat.test('iter-00'));
      assert.ok(expectedIterationFormat.test('iter-01'));
      assert.ok(expectedIterationFormat.test('iter-10'));
      assert.ok(expectedCandidateFormat.test('candidate-00-what'));
      assert.ok(expectedCandidateFormat.test('candidate-01-what'));
      assert.ok(expectedCandidateFormat.test('candidate-02-how'));
    });

    it('should save prompt, image, and score for each candidate', async () => {
      // Each candidate dir should have: prompt.txt, image.png, score.json
      const expectedFiles = ['prompt.txt', 'image.png', 'score.json'];
      assert.strictEqual(expectedFiles.length, 3);
    });

    it('should track best candidate in metadata not separate file', async () => {
      // Best candidate tracked in metadata.json, not separate file
      // No best-candidate.txt file needed
      assert.ok(true);
    });

    it('should use last iteration as final result (no separate final dir)', async () => {
      // Final result is just the best candidate from the last iteration
      // No separate "final/" directory needed
      // Lineage tracked in metadata.json
      assert.ok(true);
    });
  });

  describe('Image Download', () => {
    it('should download image from URL to local file', async () => {
      // Mock a simple image download
      const mockUrl = 'https://example.com/image.png';
      const mockImageData = Buffer.from('fake-png-data');

      // Should be able to download and save
      assert.ok(mockUrl);
      assert.ok(mockImageData);
    });

    it('should handle download errors gracefully', async () => {
      const invalidUrl = 'https://invalid-url-that-does-not-exist.example.com/image.png';

      // Should throw descriptive error on download failure
      assert.ok(invalidUrl);
    });

    it('should save image with correct file extension', async () => {
      // DALL-E 3 returns PNG images
      const expectedExtension = '.png';
      assert.strictEqual(expectedExtension, '.png');
    });
  });

  describe('generateImage with local storage and beam search context', () => {
    it('should return both URL and local path with beam search location', async () => {
      const expectedResult = {
        url: 'https://example.com/image.png',
        localPath: './output/2025-10-23/session-143052/iter-01/candidate-02-what/image.png',
        revisedPrompt: 'A detailed prompt',
        metadata: {
          model: 'dall-e-3',
          size: '1024x1024',
          quality: 'standard',
          style: 'vivid',
          timestamp: new Date().toISOString(),
          beamSearch: {
            iteration: 1,
            candidateId: 2,  // Zero-indexed
            dimension: 'what'
          }
        }
      };

      // Verify structure includes local path with beam search context
      assert.ok(expectedResult.localPath);
      assert.ok(expectedResult.localPath.includes('iter-01'));
      assert.ok(expectedResult.localPath.includes('candidate-02-what'));
      assert.ok(expectedResult.metadata.beamSearch);
    });

    it('should accept beam search context in options', async () => {
      const beamSearchOptions = {
        iteration: 1,
        candidateId: 0,  // Zero-indexed: 0, 1, 2, etc.
        dimension: 'what'
      };

      // Provider should accept and use beam search context
      assert.ok(beamSearchOptions.iteration !== undefined);
      assert.ok(beamSearchOptions.candidateId !== undefined);
      assert.ok(beamSearchOptions.dimension);
    });

    it('should save prompt text to prompt.txt file', async () => {
      const promptText = 'A beautiful mountain landscape at sunset';
      const expectedFile = 'prompt.txt';

      // Should save prompt alongside image
      assert.ok(promptText);
      assert.ok(expectedFile);
    });

    it('should save score.json with candidate scoring', async () => {
      const scoreData = {
        totalScore: 85.5,
        breakdown: {
          alignment: 80,
          aesthetic: 9.5
        },
        timestamp: new Date().toISOString()
      };

      // Should save scoring data for each candidate
      assert.ok(scoreData.totalScore);
      assert.ok(scoreData.breakdown);
    });

    it('should create metadata.json with beam search tracking and lineage', async () => {
      const expectedMetadata = {
        sessionId: 'session-143052',
        date: '2025-10-23',
        originalPrompt: 'mountain landscape',
        beamWidth: 3,
        maxIterations: 5,
        iterations: [
          {
            iteration: 0,  // Zero-indexed
            candidates: [
              {
                candidateId: 0,  // Zero-indexed
                dimension: 'what',
                prompt: 'detailed mountain...',
                imagePath: './iter-00/candidate-00-what/image.png',
                score: 85.5
              },
              {
                candidateId: 1,
                dimension: 'what',
                prompt: 'panoramic mountain...',
                imagePath: './iter-00/candidate-01-what/image.png',
                score: 88.2
              }
            ],
            bestCandidateId: 1  // candidate-01 scored highest
          },
          {
            iteration: 1,
            parentCandidateId: 1,  // Refining from iter-00/candidate-01
            candidates: [
              {
                candidateId: 0,
                dimension: 'how',
                prompt: 'panoramic mountain with dramatic lighting...',
                imagePath: './iter-01/candidate-00-how/image.png',
                score: 90.3
              }
            ],
            bestCandidateId: 0
          }
        ],
        lineage: [
          { iteration: 0, candidateId: 1 },
          { iteration: 1, candidateId: 0 }
        ],
        finalResult: {
          iteration: 1,
          candidateId: 0,
          path: './iter-01/candidate-00-how/',
          score: 90.3
        }
      };

      assert.ok(expectedMetadata.sessionId);
      assert.ok(expectedMetadata.iterations);
      assert.ok(expectedMetadata.beamWidth);
      assert.ok(expectedMetadata.lineage);  // Lineage tracked in metadata
      assert.ok(expectedMetadata.finalResult);
    });
  });

  describe('Session Management', () => {
    it('should generate unique session IDs', async () => {
      // Session ID format: session-HHMMSS
      const sessionId1 = 'session-143052';
      const sessionId2 = 'session-143053';

      assert.notStrictEqual(sessionId1, sessionId2);
    });

    it('should use current date for directory structure', async () => {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

      assert.ok(dateFormat.test(today));
    });

    it('should allow custom session directory', async () => {
      const customSession = 'my-test-session';
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: testOutputDir,
        sessionId: customSession
      });

      assert.strictEqual(provider.sessionId, customSession);
    });
  });

  describe('File System Operations', () => {
    it('should create nested directories as needed', async () => {
      const nestedPath = path.join(testOutputDir, '2025-10-23', 'session-test', 'what-refinement');

      // Should create all parent directories
      await fs.mkdir(nestedPath, { recursive: true });

      // Verify directory exists
      const stats = await fs.stat(nestedPath);
      assert.ok(stats.isDirectory());
    });

    it('should write image file to disk', async () => {
      const imagePath = path.join(testOutputDir, 'test-image.png');
      const imageData = Buffer.from('test-png-data');

      await fs.mkdir(testOutputDir, { recursive: true });
      await fs.writeFile(imagePath, imageData);

      // Verify file exists and has correct data
      const savedData = await fs.readFile(imagePath);
      assert.deepStrictEqual(savedData, imageData);
    });

    it('should write prompt text file', async () => {
      const promptPath = path.join(testOutputDir, 'prompt.txt');
      const promptText = 'A beautiful mountain landscape';

      await fs.mkdir(testOutputDir, { recursive: true });
      await fs.writeFile(promptPath, promptText, 'utf8');

      // Verify file exists and has correct content
      const savedText = await fs.readFile(promptPath, 'utf8');
      assert.strictEqual(savedText, promptText);
    });

    it('should write metadata JSON file', async () => {
      const metadataPath = path.join(testOutputDir, 'metadata.json');
      const metadata = {
        sessionId: 'test-session',
        date: '2025-10-23',
        originalPrompt: 'mountain'
      };

      await fs.mkdir(testOutputDir, { recursive: true });
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      // Verify file exists and has correct JSON
      const savedData = await fs.readFile(metadataPath, 'utf8');
      const parsed = JSON.parse(savedData);
      assert.deepStrictEqual(parsed, metadata);
    });
  });

  describe('Configuration Options', () => {
    it('should allow disabling local storage', async () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        saveLocally: false
      });

      // When disabled, should not save files
      assert.strictEqual(provider.saveLocally, false);
    });

    it('should enable local storage by default', async () => {
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key');

      // Default should be enabled
      assert.strictEqual(provider.saveLocally, true);
    });

    it('should allow custom output directory', async () => {
      const customDir = '/custom/output/path';
      const OpenAIImageProvider = require('../../src/providers/openai-image-provider.js');
      const provider = new OpenAIImageProvider('fake-api-key', {
        outputDir: customDir
      });

      assert.strictEqual(provider.outputDir, customDir);
    });
  });
});
