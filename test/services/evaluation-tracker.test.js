/**
 * Tests for HITL Evaluation Tracker
 *
 * Tests for pairwise comparison evaluation tracking that collects
 * human preferences for AI evaluation using Bradley-Terry model.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const EvaluationTracker = require('../../src/services/evaluation-tracker.js');

describe('Evaluation Tracker', () => {
  const testOutputDir = path.join(__dirname, '../../test-output-evaluation');
  const testSessionId = 'ses-123456';
  const testEvaluationId = 'eval-test-001';

  // Sample beam search metadata for testing
  const mockBeamSearchMetadata = {
    sessionId: testSessionId,
    userPrompt: 'A serene mountain landscape',
    iterations: [
      {
        iteration: 0,
        candidates: [
          {
            candidateId: 0,
            image: { localPath: '/path/to/iter0-cand0.png' },
            combined: 'Mountain landscape with sunset',
            whatPrompt: 'Mountain landscape',
            howPrompt: 'With sunset lighting',
            totalScore: 0.85
          },
          {
            candidateId: 1,
            image: { localPath: '/path/to/iter0-cand1.png' },
            combined: 'Mountain landscape with snow',
            whatPrompt: 'Mountain landscape',
            howPrompt: 'With snow-capped peaks',
            totalScore: 0.78
          }
        ]
      },
      {
        iteration: 1,
        candidates: [
          {
            candidateId: 2,
            image: { localPath: '/path/to/iter1-cand2.png' },
            combined: 'Mountain landscape with dramatic clouds',
            whatPrompt: 'Mountain landscape',
            howPrompt: 'With dramatic cloud formations',
            totalScore: 0.92
          }
        ]
      }
    ]
  };

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

  describe('EvaluationTracker Class', () => {
    it('should create EvaluationTracker instance', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      assert.ok(tracker);
      assert.strictEqual(tracker.evaluationId, testEvaluationId);
      assert.strictEqual(tracker.sessionId, testSessionId);
    });

    it('should initialize with default evaluator as anonymous', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      assert.strictEqual(tracker.evaluatorId, 'anonymous');
    });

    it('should initialize with custom evaluator ID', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId,
        evaluatorId: 'user-123'
      });

      assert.strictEqual(tracker.evaluatorId, 'user-123');
    });

    it('should initialize from beam search metadata', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      const evaluation = await tracker.getEvaluation();

      assert.strictEqual(evaluation.userPrompt, 'A serene mountain landscape');
      assert.strictEqual(evaluation.candidates.length, 3); // 2 from iter 0 + 1 from iter 1
      assert.strictEqual(evaluation.progress.totalPairs, 3); // C(3,2) = 3*2/2 = 3
      assert.strictEqual(evaluation.status, 'in_progress');
    });

    it('should write evaluation file on initialization', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      // Use the tracker's own path method to ensure consistency
      const evaluationPath = tracker._getEvaluationPath();

      const fileExists = await fs.access(evaluationPath).then(() => true).catch(() => false);
      assert.ok(fileExists, 'Evaluation file should be created');
    });
  });

  describe('Pairwise Comparison', () => {
    it('should get next comparison task', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      const nextComparison = await tracker.getNextComparison();

      assert.ok(nextComparison);
      assert.ok(nextComparison.candidateA);
      assert.ok(nextComparison.candidateB);
      assert.ok(nextComparison.comparisonId);
      assert.strictEqual(nextComparison.progress.total, 3);
      assert.strictEqual(nextComparison.progress.completed, 0);
    });

    it('should return null when all comparisons complete', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      // Complete all comparisons
      const comparisons = [];
      let next = await tracker.getNextComparison();
      while (next) {
        await tracker.recordComparison({
          comparisonId: next.comparisonId,
          candidateA: next.candidateA.candidateId,
          candidateB: next.candidateB.candidateId,
          winner: 'A',
          responseTimeMs: 1000
        });
        comparisons.push(next);
        next = await tracker.getNextComparison();
      }

      assert.strictEqual(comparisons.length, 3); // C(3,2) = 3
      assert.strictEqual(next, null);
    });

    it('should record comparison result', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      const comparison = await tracker.getNextComparison();

      await tracker.recordComparison({
        comparisonId: comparison.comparisonId,
        candidateA: comparison.candidateA.candidateId,
        candidateB: comparison.candidateB.candidateId,
        winner: 'A',
        responseTimeMs: 2500
      });

      const evaluation = await tracker.getEvaluation();

      assert.strictEqual(evaluation.comparisons.length, 1);
      assert.strictEqual(evaluation.comparisons[0].winner, 'A');
      assert.strictEqual(evaluation.comparisons[0].responseTimeMs, 2500);
      assert.strictEqual(evaluation.progress.completedPairs, 1);
    });

    it('should validate winner value', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      const comparison = await tracker.getNextComparison();

      await assert.rejects(
        async () => {
          await tracker.recordComparison({
            comparisonId: comparison.comparisonId,
            candidateA: comparison.candidateA.candidateId,
            candidateB: comparison.candidateB.candidateId,
            winner: 'invalid',
            responseTimeMs: 1000
          });
        },
        /Invalid winner/
      );
    });

    it('should mark evaluation as completed when all pairs done', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      // Complete all comparisons
      let next = await tracker.getNextComparison();
      while (next) {
        await tracker.recordComparison({
          comparisonId: next.comparisonId,
          candidateA: next.candidateA.candidateId,
          candidateB: next.candidateB.candidateId,
          winner: 'A',
          responseTimeMs: 1000
        });
        next = await tracker.getNextComparison();
      }

      const evaluation = await tracker.getEvaluation();

      assert.strictEqual(evaluation.status, 'completed');
      assert.ok(evaluation.completedAt);
    });

    it('should support tie votes', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      const comparison = await tracker.getNextComparison();

      await tracker.recordComparison({
        comparisonId: comparison.comparisonId,
        candidateA: comparison.candidateA.candidateId,
        candidateB: comparison.candidateB.candidateId,
        winner: 'tie',
        responseTimeMs: 1500
      });

      const evaluation = await tracker.getEvaluation();

      assert.strictEqual(evaluation.comparisons[0].winner, 'tie');
    });
  });

  describe('Export for Analysis', () => {
    it('should export evaluation data in analysis format', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId,
        evaluatorId: 'user-123'
      });

      await tracker.initialize(mockBeamSearchMetadata);

      // Add one comparison
      const comparison = await tracker.getNextComparison();
      await tracker.recordComparison({
        comparisonId: comparison.comparisonId,
        candidateA: comparison.candidateA.candidateId,
        candidateB: comparison.candidateB.candidateId,
        winner: 'B',
        responseTimeMs: 2000
      });

      const exportData = await tracker.exportForAnalysis();

      // Verify metadata
      assert.strictEqual(exportData.metadata.evaluationId, testEvaluationId);
      assert.strictEqual(exportData.metadata.sessionId, testSessionId);
      assert.strictEqual(exportData.metadata.evaluatorId, 'user-123');
      assert.strictEqual(exportData.metadata.status, 'in_progress');

      // Verify candidates format
      assert.strictEqual(exportData.candidates.length, 3);
      assert.ok(exportData.candidates[0].id !== undefined);
      assert.ok(exportData.candidates[0].iteration !== undefined);
      assert.ok(exportData.candidates[0].prompt);

      // Verify comparisons format
      assert.strictEqual(exportData.comparisons.length, 1);
      assert.ok(exportData.comparisons[0].candidateA !== undefined);
      assert.ok(exportData.comparisons[0].candidateB !== undefined);
      assert.strictEqual(exportData.comparisons[0].winner, 'B');
      assert.strictEqual(exportData.comparisons[0].responseTimeMs, 2000);
    });
  });

  describe('Load Existing Evaluation', () => {
    it('should load existing evaluation from disk', async () => {
      // Create and save evaluation
      const tracker1 = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId,
        evaluatorId: 'user-456'
      });

      await tracker1.initialize(mockBeamSearchMetadata);

      const comparison = await tracker1.getNextComparison();
      await tracker1.recordComparison({
        comparisonId: comparison.comparisonId,
        candidateA: comparison.candidateA.candidateId,
        candidateB: comparison.candidateB.candidateId,
        winner: 'A',
        responseTimeMs: 1800
      });

      // Load from disk
      const tracker2 = await EvaluationTracker.load(
        testOutputDir,
        testSessionId,
        testEvaluationId
      );

      const evaluation = await tracker2.getEvaluation();

      assert.strictEqual(evaluation.evaluationId, testEvaluationId);
      assert.strictEqual(evaluation.evaluatorId, 'user-456');
      assert.strictEqual(evaluation.comparisons.length, 1);
      assert.strictEqual(evaluation.comparisons[0].winner, 'A');
    });
  });

  describe('Position Bias Prevention', () => {
    it('should randomize presentation order to prevent position bias', async () => {
      // Bug: i0c0 always appears on the left (candidateA) and wins due to position bias
      // Fix: getNextComparison() should randomly swap A/B positions
      //
      // This test creates a larger dataset and verifies that:
      // 1. Each candidate appears in both positions (A and B)
      // 2. The presentationOrder field indicates if candidates were swapped
      // 3. The original candidate IDs are preserved for correct winner mapping

      // Create metadata with 5 candidates to have 10 pairs
      const largeMetadata = {
        sessionId: testSessionId,
        userPrompt: 'Test prompt',
        iterations: [
          {
            iteration: 0,
            candidates: [
              { candidateId: 'i0c0', image: { localPath: '/path/to/0.png' }, combined: 'A', whatPrompt: 'A', howPrompt: 'A', totalScore: 0.8 },
              { candidateId: 'i0c1', image: { localPath: '/path/to/1.png' }, combined: 'B', whatPrompt: 'B', howPrompt: 'B', totalScore: 0.7 },
              { candidateId: 'i0c2', image: { localPath: '/path/to/2.png' }, combined: 'C', whatPrompt: 'C', howPrompt: 'C', totalScore: 0.6 },
              { candidateId: 'i0c3', image: { localPath: '/path/to/3.png' }, combined: 'D', whatPrompt: 'D', howPrompt: 'D', totalScore: 0.5 },
              { candidateId: 'i0c4', image: { localPath: '/path/to/4.png' }, combined: 'E', whatPrompt: 'E', howPrompt: 'E', totalScore: 0.4 }
            ]
          }
        ]
      };

      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(largeMetadata);

      // Collect all comparisons
      const comparisons = [];
      let next = await tracker.getNextComparison();
      while (next) {
        comparisons.push(next);
        await tracker.recordComparison({
          comparisonId: next.comparisonId,
          candidateA: next.candidateA.candidateId,
          candidateB: next.candidateB.candidateId,
          winner: 'A', // Always vote for position A to simulate bias
          responseTimeMs: 100
        });
        next = await tracker.getNextComparison();
      }

      // Should have C(5,2) = 10 comparisons
      assert.strictEqual(comparisons.length, 10, 'Should have 10 pairs for 5 candidates');

      // Key assertion: Each comparison should have presentationOrder metadata
      // to track if candidates were swapped for display
      for (const comparison of comparisons) {
        assert.ok(
          comparison.presentationOrder !== undefined,
          'Comparison should include presentationOrder field for bias tracking'
        );
        assert.ok(
          ['original', 'swapped'].includes(comparison.presentationOrder),
          'presentationOrder should be "original" or "swapped"'
        );
      }

      // Track how often i0c0 appears in position A vs B
      const i0c0AsA = comparisons.filter(c => c.candidateA.candidateId === 'i0c0').length;
      const i0c0AsB = comparisons.filter(c => c.candidateB.candidateId === 'i0c0').length;

      // i0c0 participates in 4 comparisons (paired with each of the other 4 candidates)
      assert.strictEqual(i0c0AsA + i0c0AsB, 4, 'i0c0 should participate in 4 comparisons');

      // With randomization, i0c0 should NOT always be in position A
      // At least some comparisons should have i0c0 in position B
      assert.ok(
        i0c0AsB > 0,
        `Position bias bug: i0c0 always appears in position A (${i0c0AsA} times as A, ${i0c0AsB} times as B). ` +
        'Presentation order should be randomized.'
      );
    });

    it('should include original pair info for correct winner mapping', async () => {
      // When presentation is swapped, the UI votes for "A" or "B" based on position
      // But the winner mapping must correctly identify the actual candidate
      // This requires originalPair info to be preserved

      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      const comparison = await tracker.getNextComparison();

      // Comparison should include the original pair for correct mapping
      assert.ok(
        comparison.originalPair !== undefined,
        'Comparison should include originalPair for winner mapping'
      );
      assert.ok(
        comparison.originalPair.first !== undefined && comparison.originalPair.second !== undefined,
        'originalPair should have first and second candidate IDs'
      );
    });
  });

  describe('Progress Tracking', () => {
    it('should calculate correct number of pairs for 3 candidates', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      const evaluation = await tracker.getEvaluation();

      // C(3, 2) = 3 * 2 / 2 = 3
      assert.strictEqual(evaluation.progress.totalPairs, 3);
    });

    it('should track progress percentage correctly', async () => {
      const tracker = new EvaluationTracker({
        outputDir: testOutputDir,
        evaluationId: testEvaluationId,
        sessionId: testSessionId
      });

      await tracker.initialize(mockBeamSearchMetadata);

      // Complete one comparison
      const comparison = await tracker.getNextComparison();
      await tracker.recordComparison({
        comparisonId: comparison.comparisonId,
        candidateA: comparison.candidateA.candidateId,
        candidateB: comparison.candidateB.candidateId,
        winner: 'A',
        responseTimeMs: 1000
      });

      const nextComparison = await tracker.getNextComparison();

      assert.strictEqual(nextComparison.progress.completed, 1);
      assert.strictEqual(nextComparison.progress.total, 3);
      assert.strictEqual(nextComparison.progress.percentage, 33); // 1/3 = 33%
    });
  });
});
