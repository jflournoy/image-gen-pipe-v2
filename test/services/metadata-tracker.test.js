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
const { getDateString } = require('../../src/utils/timezone.js');

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
      const date = getDateString();
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
      const date = getDateString();
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
      const date = getDateString();
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
      const date = getDateString();
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
      const date = getDateString();
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      assert.strictEqual(metadata.iterations.length, 1);
      const candidate = metadata.iterations[0].candidates[0];
      assert.strictEqual(candidate.status, 'attempted');
      assert.strictEqual(candidate.whatPrompt, 'test what');
    });

    it('should record critique in attempt when provided', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      const critique = {
        critique: 'Lighting is too flat',
        recommendation: 'Add dramatic side lighting with shadows',
        reason: 'Will add depth and visual interest',
        dimension: 'how',
        metadata: { model: 'mistral-7b', tokensUsed: 312, feedbackType: 'ranking' }
      };

      await tracker.recordAttempt({
        whatPrompt: 'mountain scene',
        howPrompt: 'flat lighting',
        critique,
        metadata: {
          iteration: 1,
          candidateId: 0,
          dimension: 'how',
          parentId: 0
        }
      });

      const metadata = await tracker.getMetadata();
      const candidate = metadata.iterations[0].candidates[0];
      assert.ok(candidate.critique);
      assert.strictEqual(candidate.critique.critique, 'Lighting is too flat');
      assert.strictEqual(candidate.critique.recommendation, 'Add dramatic side lighting with shadows');
      assert.strictEqual(candidate.critique.dimension, 'how');
      assert.strictEqual(candidate.critique.metadata.model, 'mistral-7b');
    });
  });

  describe('Enriched Config', () => {
    it('should persist full pipeline config including providers and options', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const fullConfig = {
        beamWidth: 4,
        keepTop: 2,
        maxIterations: 3,
        alpha: 0.7,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        promptStyle: 'booru',
        descriptiveness: 3,
        varyDescriptivenessRandomly: true,
        rankingMode: 'vlm',
        useSeparateEvaluations: true,
        autoGenerateNegativePrompts: true,
        fixFaces: true,
        restorationStrength: 0.5,
        faceUpscale: 2,
        return_intermediate_images: true,
        providers: { llm: 'local-llm', image: 'flux', vision: 'local' },
        models: { llm: 'mistral-7b-q4' },
        fluxOptions: { steps: 20, guidance: 7.5 },
        bflOptions: null,
        modalOptions: null,
        loraOptions: { path: '/models/lora.safetensors', scale: 0.8 },
      };

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test prompt',
        config: fullConfig
      });

      await tracker.initialize();

      // Read from disk to verify all fields persisted
      const date = getDateString();
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      assert.strictEqual(metadata.config.promptStyle, 'booru');
      assert.strictEqual(metadata.config.descriptiveness, 3);
      assert.strictEqual(metadata.config.rankingMode, 'vlm');
      assert.strictEqual(metadata.config.useSeparateEvaluations, true);
      assert.strictEqual(metadata.config.fixFaces, true);
      assert.strictEqual(metadata.config.restorationStrength, 0.5);
      assert.strictEqual(metadata.config.return_intermediate_images, true);
      assert.deepStrictEqual(metadata.config.providers, { llm: 'local-llm', image: 'flux', vision: 'local' });
      assert.deepStrictEqual(metadata.config.fluxOptions, { steps: 20, guidance: 7.5 });
      assert.deepStrictEqual(metadata.config.loraOptions, { path: '/models/lora.safetensors', scale: 0.8 });
      assert.strictEqual(metadata.config.bflOptions, null);
    });
  });

  describe('Ranking Data Enrichment', () => {
    it('should enrich candidate with comparisons and aggregatedFeedback', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record an attempt first
      await tracker.recordAttempt({
        whatPrompt: 'mountain',
        howPrompt: 'dramatic',
        metadata: { iteration: 0, candidateId: 0, dimension: 'what', parentId: null }
      });

      // Enrich with ranking data
      await tracker.enrichCandidateWithRankingData(0, 0, {
        comparisons: [
          { opponentId: 'i0c1', result: 'win', myRanks: { alignment: 4, aesthetics: 3, combined: 3.5 }, opponentRanks: { alignment: 2, aesthetics: 2, combined: 2 }, timestamp: '2026-02-23T10:00:00Z' },
          { opponentId: 'i0c2', result: 'loss', myRanks: { alignment: 2, aesthetics: 2, combined: 2 }, opponentRanks: { alignment: 4, aesthetics: 4, combined: 4 }, timestamp: '2026-02-23T10:01:00Z' }
        ],
        aggregatedFeedback: {
          strengths: ['good composition'],
          weaknesses: ['slightly blurry'],
          ranks: { alignment: 3, aesthetics: 2.5, combined: 2.75 },
          improvementSuggestion: 'Sharpen the edges'
        }
      });

      const metadata = await tracker.getMetadata();
      const candidate = metadata.iterations[0].candidates[0];
      assert.strictEqual(candidate.comparisons.length, 2);
      assert.strictEqual(candidate.comparisons[0].opponentId, 'i0c1');
      assert.strictEqual(candidate.comparisons[0].result, 'win');
      assert.strictEqual(candidate.comparisons[1].result, 'loss');
      assert.deepStrictEqual(candidate.aggregatedFeedback.strengths, ['good composition']);
      assert.strictEqual(candidate.aggregatedFeedback.improvementSuggestion, 'Sharpen the edges');
    });

    it('should enrich candidate with critique', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      await tracker.recordAttempt({
        whatPrompt: 'mountain',
        howPrompt: 'dramatic',
        metadata: { iteration: 0, candidateId: 0, dimension: 'what', parentId: null }
      });

      const critique = {
        critique: 'Needs better lighting',
        recommendation: 'Add dramatic side lighting',
        reason: 'Will improve depth',
        dimension: 'how'
      };

      await tracker.enrichCandidateWithRankingData(0, 0, {
        comparisons: [],
        aggregatedFeedback: null,
        critique
      });

      const metadata = await tracker.getMetadata();
      const candidate = metadata.iterations[0].candidates[0];
      assert.ok(candidate.critique);
      assert.strictEqual(candidate.critique.critique, 'Needs better lighting');
    });

    it('should throw when iteration not found', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      await assert.rejects(
        () => tracker.enrichCandidateWithRankingData(99, 0, { comparisons: [], aggregatedFeedback: null }),
        /Iteration 99 not found/
      );
    });

    it('should throw when candidate not found', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      await tracker.recordAttempt({
        whatPrompt: 'test',
        howPrompt: 'test',
        metadata: { iteration: 0, candidateId: 0, dimension: 'what' }
      });

      await assert.rejects(
        () => tracker.enrichCandidateWithRankingData(0, 99, { comparisons: [], aggregatedFeedback: null }),
        /Candidate 99 not found in iteration 0/
      );
    });

    it('should persist enriched data to disk', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      await tracker.recordAttempt({
        whatPrompt: 'mountain',
        howPrompt: 'dramatic',
        metadata: { iteration: 0, candidateId: 0, dimension: 'what', parentId: null }
      });

      await tracker.enrichCandidateWithRankingData(0, 0, {
        comparisons: [{ opponentId: 'i0c1', result: 'win', myRanks: null, opponentRanks: null, timestamp: '2026-02-23T10:00:00Z' }],
        aggregatedFeedback: { strengths: ['nice'], weaknesses: [], ranks: null, improvementSuggestion: null }
      });

      // Read directly from disk
      const date = getDateString();
      const metadataPath = path.join(testOutputDir, date, testSessionId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      const candidate = metadata.iterations[0].candidates[0];
      assert.strictEqual(candidate.comparisons.length, 1);
      assert.ok(candidate.aggregatedFeedback);
    });

    it('should include default comparisons and aggregatedFeedback in recordAttempt', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      await tracker.recordAttempt({
        whatPrompt: 'test',
        howPrompt: 'test',
        metadata: { iteration: 0, candidateId: 0, dimension: 'what' }
      });

      const metadata = await tracker.getMetadata();
      const candidate = metadata.iterations[0].candidates[0];
      assert.deepStrictEqual(candidate.comparisons, []);
      assert.strictEqual(candidate.aggregatedFeedback, null);
    });
  });

  describe('bestCandidateId from ranking data', () => {
    it('should set bestCandidateId from aggregatedFeedback ranks when totalScore is null', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Record two attempts
      await tracker.recordAttempt({
        whatPrompt: 'mountain',
        howPrompt: 'dramatic',
        metadata: { iteration: 0, candidateId: 0, dimension: 'what', parentId: null }
      });

      await tracker.recordAttempt({
        whatPrompt: 'ocean',
        howPrompt: 'serene',
        metadata: { iteration: 0, candidateId: 1, dimension: 'what', parentId: null }
      });

      // Enrich candidate 0 with worse rank (higher = worse)
      await tracker.enrichCandidateWithRankingData(0, 0, {
        comparisons: [{ opponentId: 'i0c1', result: 'loss', myRanks: { combined: 2 }, opponentRanks: { combined: 1 }, timestamp: '2026-02-24T10:00:00Z' }],
        aggregatedFeedback: {
          strengths: [], weaknesses: ['blurry'],
          ranks: { alignment: 1.8, aesthetics: 1.6, combined: 1.72 },
          improvementSuggestion: null
        }
      });

      // Enrich candidate 1 with better rank (lower = better)
      await tracker.enrichCandidateWithRankingData(0, 1, {
        comparisons: [{ opponentId: 'i0c0', result: 'win', myRanks: { combined: 1 }, opponentRanks: { combined: 2 }, timestamp: '2026-02-24T10:00:00Z' }],
        aggregatedFeedback: {
          strengths: ['sharp', 'well composed'], weaknesses: [],
          ranks: { alignment: 1.2, aesthetics: 1.1, combined: 1.16 },
          improvementSuggestion: null
        }
      });

      const metadata = await tracker.getMetadata();
      // bestCandidateId should be 1 (lower combined rank = better)
      assert.strictEqual(metadata.iterations[0].bestCandidateId, 1);
      assert.strictEqual(metadata.iterations[0].bestScore, 1.16);
    });

    it('should not update bestCandidateId when aggregatedFeedback has no ranks', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      await tracker.recordAttempt({
        whatPrompt: 'test',
        howPrompt: 'test',
        metadata: { iteration: 0, candidateId: 0, dimension: 'what', parentId: null }
      });

      await tracker.enrichCandidateWithRankingData(0, 0, {
        comparisons: [],
        aggregatedFeedback: { strengths: [], weaknesses: [], ranks: null, improvementSuggestion: null }
      });

      const metadata = await tracker.getMetadata();
      assert.strictEqual(metadata.iterations[0].bestCandidateId, null);
      assert.strictEqual(metadata.iterations[0].bestScore, null);
    });
  });

  describe('Token Persistence', () => {
    it('should write tokens.json alongside metadata.json', async () => {
      const MetadataTracker = require('../../src/services/metadata-tracker.js');

      const tracker = new MetadataTracker({
        outputDir: testOutputDir,
        sessionId: testSessionId,
        userPrompt: 'test',
        config: { beamWidth: 4, keepTop: 2 }
      });

      await tracker.initialize();

      // Mock token tracker with the expected interface
      const mockTokenTracker = {
        getStats: () => ({
          totalTokens: 4521,
          llmTokens: 1820,
          visionTokens: 980,
          critiqueTokens: 640,
          imageGenTokens: 8
        }),
        getEstimatedCost: () => ({
          total: 0.0234,
          llm: 0.0045,
          vision: 0.0147,
          critique: 0.0016,
          imageGen: 0.0
        }),
        getRecords: () => ([
          {
            provider: 'llm',
            operation: 'expand',
            tokens: 210,
            metadata: { model: 'mistral-7b-q4', iteration: 0, candidateId: 0 }
          }
        ])
      };

      await tracker.persistTokens(mockTokenTracker);

      // Read tokens.json from disk
      const date = getDateString();
      const tokensPath = path.join(testOutputDir, date, testSessionId, 'tokens.json');
      const content = await fs.readFile(tokensPath, 'utf8');
      const tokenData = JSON.parse(content);

      assert.strictEqual(tokenData.sessionId, testSessionId);
      assert.ok(tokenData.generatedAt);
      assert.strictEqual(tokenData.totals.totalTokens, 4521);
      assert.strictEqual(tokenData.totals.llmTokens, 1820);
      assert.strictEqual(tokenData.estimatedCost.total, 0.0234);
      assert.strictEqual(tokenData.records.length, 1);
      assert.strictEqual(tokenData.records[0].provider, 'llm');
    });
  });
});
