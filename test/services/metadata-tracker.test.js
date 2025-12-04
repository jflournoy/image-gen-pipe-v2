/**
 * 🔴 TDD RED Phase: Metadata Tracker Tests
 *
 * Tests for session metadata tracking that captures complete beam search evolution.
 * Creates single JSON file per session with all prompts, critiques, scores, and lineage.
 *
 * Related Issue: #8
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');

describe('Metadata Tracker', () => {
  const testOutputDir = path.join(__dirname, '../../test-output-metadata');
  const testSessionId = 'test-session-123';

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

  describe('MetadataTracker Class', () => {
    it('should create MetadataTracker instance', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId
      });

      assert.ok(tracker);
      assert.strictEqual(tracker.sessionId, testSessionId);
    });

    it('should initialize with session configuration', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const config = {
        beamWidth: 4,
        keepTop: 2,
        maxIterations: 3,
        alpha: 0.7
      };

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'a mountain landscape',
        config
      });

      assert.strictEqual(tracker.config.beamWidth, 4);
      assert.strictEqual(tracker.config.keepTop, 2);
      assert.strictEqual(tracker.userPrompt, 'a mountain landscape');
    });
  });

  describe('Session Initialization', () => {
    it('should create metadata.json file on initialization', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'a mountain landscape',
        config: { beamWidth: 4, keepTop: 2, maxIterations: 3, alpha: 0.7 }
      });

      await tracker.initialize();

      // Verify file exists
      const date = new Date().toISOString().split('T')[0];
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const stats = await fs.stat(metadataPath);
      assert.ok(stats.isFile());
    });

    it('should initialize metadata.json with session info', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'a mountain landscape',
        config: { beamWidth: 4, keepTop: 2, maxIterations: 3, alpha: 0.7 }
      });

      await tracker.initialize();

      // Read and parse metadata
      const date = new Date().toISOString().split('T')[0];
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      assert.strictEqual(metadata.sessionId, testSessionId);
      assert.strictEqual(metadata.userPrompt, 'a mountain landscape');
      assert.strictEqual(metadata.config.beamWidth, 4);
      assert.strictEqual(metadata.config.keepTop, 2);
      assert.ok(metadata.timestamp);
      assert.ok(Array.isArray(metadata.iterations));
      assert.strictEqual(metadata.iterations.length, 0);
    });
  });

  describe('Recording Candidates', () => {
    it('should record candidate data for iteration', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'a mountain',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record a candidate
      const candidate = {
        whatPrompt: 'detailed mountain scene',
        howPrompt: 'dramatic lighting',
        combined: 'detailed mountain scene with dramatic lighting',
        image: {
          url: 'https://example.com/img.png',
          localPath: '2025-12-03/test-session-123/iter0-cand0.png'
        },
        evaluation: {
          alignmentScore: 85,
          aestheticScore: 7.5,
          analysis: 'Good composition',
          strengths: ['lighting', 'composition'],
          weaknesses: ['color saturation']
        },
        totalScore: 81.75,
        metadata: {
          iteration: 0,
          candidateId: 0,
          dimension: 'what',
          parentId: null
        }
      };

      await tracker.recordCandidate(candidate, { survived: true });

      // Verify candidate was recorded
      const metadata = await tracker.getMetadata();
      assert.strictEqual(metadata.iterations.length, 1);
      assert.strictEqual(metadata.iterations[0].iteration, 0);
      assert.strictEqual(metadata.iterations[0].candidates.length, 1);
      assert.strictEqual(metadata.iterations[0].candidates[0].candidateId, 0);
      assert.strictEqual(metadata.iterations[0].candidates[0].totalScore, 81.75);
      assert.strictEqual(metadata.iterations[0].candidates[0].survived, true);
    });

    it('should record multiple candidates in same iteration', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record multiple candidates
      for (let i = 0; i < 3; i++) {
        await tracker.recordCandidate({
          whatPrompt: `what ${i}`,
          howPrompt: `how ${i}`,
          combined: `combined ${i}`,
          image: { url: `url${i}`, localPath: `path${i}` },
          evaluation: { alignmentScore: 80 + i, aestheticScore: 7 },
          totalScore: 80 + i,
          metadata: { iteration: 0, candidateId: i, dimension: 'what' }
        }, { survived: i < 2 });
      }

      const metadata = await tracker.getMetadata();
      assert.strictEqual(metadata.iterations[0].candidates.length, 3);
      assert.strictEqual(metadata.iterations[0].candidates[0].survived, true);
      assert.strictEqual(metadata.iterations[0].candidates[1].survived, true);
      assert.strictEqual(metadata.iterations[0].candidates[2].survived, false);
    });

    it('should track parent-child relationships', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Iteration 0 - parents
      await tracker.recordCandidate({
        whatPrompt: 'parent what',
        howPrompt: 'parent how',
        combined: 'parent combined',
        image: { url: 'url0', localPath: 'path0' },
        evaluation: { alignmentScore: 85, aestheticScore: 8 },
        totalScore: 85,
        metadata: { iteration: 0, candidateId: 0, dimension: 'what', parentId: null }
      }, { survived: true });

      // Iteration 1 - child with parent reference
      await tracker.recordCandidate({
        whatPrompt: 'child what',
        howPrompt: 'parent how',
        combined: 'child combined',
        image: { url: 'url1', localPath: 'path1' },
        evaluation: { alignmentScore: 90, aestheticScore: 8.5 },
        totalScore: 90,
        metadata: { iteration: 1, candidateId: 0, dimension: 'what', parentId: 0 }
      }, { survived: true });

      const metadata = await tracker.getMetadata();
      assert.strictEqual(metadata.iterations[0].candidates[0].parentId, null);
      assert.strictEqual(metadata.iterations[1].candidates[0].parentId, 0);
    });

    it('should store critique information for refinement iterations', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      const critique = {
        critique: 'Needs better lighting',
        recommendation: 'Add dramatic side lighting',
        reason: 'Will improve visual impact',
        dimension: 'how'
      };

      await tracker.recordCandidate({
        whatPrompt: 'mountain',
        howPrompt: 'dramatic lighting',
        combined: 'mountain with dramatic lighting',
        image: { url: 'url', localPath: 'path' },
        evaluation: { alignmentScore: 85, aestheticScore: 8 },
        totalScore: 85,
        metadata: { iteration: 1, candidateId: 0, dimension: 'how' },
        critique
      }, { survived: true });

      const metadata = await tracker.getMetadata();
      const candidate = metadata.iterations[0].candidates[0];
      assert.ok(candidate.critique);
      assert.strictEqual(candidate.critique.critique, 'Needs better lighting');
      assert.strictEqual(candidate.critique.dimension, 'how');
    });
  });

  describe('Iteration Management', () => {
    it('should track iteration dimension (what/how alternation)', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Iteration 0 - WHAT
      await tracker.recordCandidate({
        whatPrompt: 'what0',
        howPrompt: 'how0',
        combined: 'combined0',
        image: { url: 'url0', localPath: 'path0' },
        evaluation: { alignmentScore: 85, aestheticScore: 8 },
        totalScore: 85,
        metadata: { iteration: 0, candidateId: 0, dimension: 'what' }
      }, { survived: true });

      // Iteration 1 - HOW (odd iterations refine WHAT)
      await tracker.recordCandidate({
        whatPrompt: 'what1',
        howPrompt: 'how1',
        combined: 'combined1',
        image: { url: 'url1', localPath: 'path1' },
        evaluation: { alignmentScore: 87, aestheticScore: 8.2 },
        totalScore: 87,
        metadata: { iteration: 1, candidateId: 0, dimension: 'what' }
      }, { survived: true });

      const metadata = await tracker.getMetadata();
      assert.strictEqual(metadata.iterations[0].dimension, 'what');
      assert.strictEqual(metadata.iterations[1].dimension, 'what');
    });

    it('should track best candidate per iteration', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record candidates with different scores
      await tracker.recordCandidate({
        whatPrompt: 'what0',
        howPrompt: 'how0',
        combined: 'combined0',
        image: { url: 'url0', localPath: 'path0' },
        evaluation: { alignmentScore: 80, aestheticScore: 7 },
        totalScore: 80,
        metadata: { iteration: 0, candidateId: 0, dimension: 'what' }
      }, { survived: true });

      await tracker.recordCandidate({
        whatPrompt: 'what1',
        howPrompt: 'how1',
        combined: 'combined1',
        image: { url: 'url1', localPath: 'path1' },
        evaluation: { alignmentScore: 90, aestheticScore: 9 },
        totalScore: 90,
        metadata: { iteration: 0, candidateId: 1, dimension: 'what' }
      }, { survived: true });

      const metadata = await tracker.getMetadata();
      assert.strictEqual(metadata.iterations[0].bestCandidateId, 1);
      assert.strictEqual(metadata.iterations[0].bestScore, 90);
    });
  });

  describe('Persistence', () => {
    it('should write metadata to disk after each update', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record candidate
      await tracker.recordCandidate({
        whatPrompt: 'what',
        howPrompt: 'how',
        combined: 'combined',
        image: { url: 'url', localPath: 'path' },
        evaluation: { alignmentScore: 85, aestheticScore: 8 },
        totalScore: 85,
        metadata: { iteration: 0, candidateId: 0, dimension: 'what' }
      }, { survived: true });

      // Read directly from disk to verify persistence
      const date = new Date().toISOString().split('T')[0];
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      assert.strictEqual(metadata.iterations.length, 1);
      assert.strictEqual(metadata.iterations[0].candidates.length, 1);
    });

    it('should maintain valid JSON format', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record multiple candidates
      for (let i = 0; i < 3; i++) {
        await tracker.recordCandidate({
          whatPrompt: `what${i}`,
          howPrompt: `how${i}`,
          combined: `combined${i}`,
          image: { url: `url${i}`, localPath: `path${i}` },
          evaluation: { alignmentScore: 80, aestheticScore: 7 },
          totalScore: 80,
          metadata: { iteration: 0, candidateId: i, dimension: 'what' }
        }, { survived: true });
      }

      // Read and parse - should not throw
      const date = new Date().toISOString().split('T')[0];
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content); // Will throw if invalid JSON

      assert.ok(metadata);
    });
  });

  describe('Final Result Tracking', () => {
    it('should mark final winner after all iterations', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2, maxIterations: 2 }
      });

      await tracker.initialize();

      // Iteration 0
      await tracker.recordCandidate({
        whatPrompt: 'what0',
        howPrompt: 'how0',
        combined: 'combined0',
        image: { url: 'url0', localPath: 'path0' },
        evaluation: { alignmentScore: 85, aestheticScore: 8 },
        totalScore: 85,
        metadata: { iteration: 0, candidateId: 0, dimension: 'what' }
      }, { survived: true });

      // Iteration 1 (final)
      await tracker.recordCandidate({
        whatPrompt: 'what1',
        howPrompt: 'how1',
        combined: 'combined1',
        image: { url: 'url1', localPath: 'path1' },
        evaluation: { alignmentScore: 92, aestheticScore: 9 },
        totalScore: 92,
        metadata: { iteration: 1, candidateId: 0, dimension: 'what', parentId: 0 }
      }, { survived: true });

      // Mark as final winner
      await tracker.markFinalWinner({
        iteration: 1,
        candidateId: 0,
        totalScore: 92
      });

      const metadata = await tracker.getMetadata();
      assert.ok(metadata.finalWinner);
      assert.strictEqual(metadata.finalWinner.iteration, 1);
      assert.strictEqual(metadata.finalWinner.candidateId, 0);
      assert.strictEqual(metadata.finalWinner.totalScore, 92);
    });
  });

  describe('Lineage Tracking', () => {
    it('should build complete lineage path from winner to root', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Build a lineage chain: iter0-cand1 -> iter1-cand0 -> iter2-cand0
      await tracker.recordCandidate({
        whatPrompt: 'root',
        howPrompt: 'root',
        combined: 'root',
        image: { url: 'url0', localPath: 'path0' },
        evaluation: { alignmentScore: 80, aestheticScore: 7 },
        totalScore: 80,
        metadata: { iteration: 0, candidateId: 1, dimension: 'what', parentId: null }
      }, { survived: true });

      await tracker.recordCandidate({
        whatPrompt: 'gen1',
        howPrompt: 'root',
        combined: 'gen1',
        image: { url: 'url1', localPath: 'path1' },
        evaluation: { alignmentScore: 85, aestheticScore: 8 },
        totalScore: 85,
        metadata: { iteration: 1, candidateId: 0, dimension: 'what', parentId: 1 }
      }, { survived: true });

      await tracker.recordCandidate({
        whatPrompt: 'gen1',
        howPrompt: 'gen2',
        combined: 'gen2',
        image: { url: 'url2', localPath: 'path2' },
        evaluation: { alignmentScore: 90, aestheticScore: 9 },
        totalScore: 90,
        metadata: { iteration: 2, candidateId: 0, dimension: 'how', parentId: 0 }
      }, { survived: true });

      await tracker.markFinalWinner({
        iteration: 2,
        candidateId: 0,
        totalScore: 90
      });

      const metadata = await tracker.getMetadata();
      assert.ok(metadata.lineage);
      assert.strictEqual(metadata.lineage.length, 3);
      assert.deepStrictEqual(metadata.lineage[0], { iteration: 0, candidateId: 1 });
      assert.deepStrictEqual(metadata.lineage[1], { iteration: 1, candidateId: 0 });
      assert.deepStrictEqual(metadata.lineage[2], { iteration: 2, candidateId: 0 });
    });
  });

  describe('Defensive Metadata Recording', () => {
    it('should record attempt before processing to survive errors', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record attempt with just the prompts and metadata (before processing)
      const attemptInfo = {
        whatPrompt: 'detailed mountain',
        howPrompt: 'dramatic lighting',
        metadata: {
          iteration: 0,
          candidateId: 0,
          dimension: 'what',
          parentId: null
        }
      };

      await tracker.recordAttempt(attemptInfo);

      // Verify attempt was recorded even without results
      const metadata = await tracker.getMetadata();
      assert.strictEqual(metadata.iterations.length, 1);
      assert.strictEqual(metadata.iterations[0].candidates.length, 1);

      const candidate = metadata.iterations[0].candidates[0];
      assert.strictEqual(candidate.whatPrompt, 'detailed mountain');
      assert.strictEqual(candidate.howPrompt, 'dramatic lighting');
      assert.strictEqual(candidate.status, 'attempted');
      assert.strictEqual(candidate.combined, null);
      assert.strictEqual(candidate.image, null);
      assert.strictEqual(candidate.evaluation, null);
    });

    it('should update attempt with results after successful processing', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // First record attempt
      const attemptInfo = {
        whatPrompt: 'detailed mountain',
        howPrompt: 'dramatic lighting',
        metadata: {
          iteration: 0,
          candidateId: 0,
          dimension: 'what'
        }
      };

      await tracker.recordAttempt(attemptInfo);

      // Then update with results
      const results = {
        combined: 'detailed mountain with dramatic lighting',
        image: {
          url: 'https://example.com/img.png',
          localPath: '2025-12-03/test-session-123/iter0-cand0.png'
        },
        evaluation: {
          alignmentScore: 85,
          aestheticScore: 7.5,
          analysis: 'Good composition',
          strengths: ['lighting'],
          weaknesses: []
        },
        totalScore: 81.75
      };

      await tracker.updateAttemptWithResults(0, 0, results, { survived: true });

      // Verify status changed to completed
      const metadata = await tracker.getMetadata();
      const candidate = metadata.iterations[0].candidates[0];
      assert.strictEqual(candidate.status, 'completed');
      assert.strictEqual(candidate.combined, 'detailed mountain with dramatic lighting');
      assert.strictEqual(candidate.totalScore, 81.75);
      assert.strictEqual(candidate.survived, true);
    });

    it('should persist attempt to disk immediately', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record attempt
      await tracker.recordAttempt({
        whatPrompt: 'test what',
        howPrompt: 'test how',
        metadata: {
          iteration: 0,
          candidateId: 0,
          dimension: 'what'
        }
      });

      // Read directly from disk to verify immediate persistence
      const date = new Date().toISOString().split('T')[0];
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      assert.strictEqual(metadata.iterations.length, 1);
      const candidate = metadata.iterations[0].candidates[0];
      assert.strictEqual(candidate.status, 'attempted');
      assert.strictEqual(candidate.whatPrompt, 'test what');
    });
  });
});
