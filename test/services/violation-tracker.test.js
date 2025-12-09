const { describe, it } = require('node:test');
const assert = require('node:assert');
const ViolationTracker = require('../../src/services/violation-tracker.js');

describe('ViolationTracker', () => {
  describe('constructor', () => {
    it('should create with default maxHistory', () => {
      const tracker = new ViolationTracker();
      assert.ok(tracker);
    });

    it('should create with custom maxHistory', () => {
      const tracker = new ViolationTracker({ maxHistory: 50 });
      assert.ok(tracker);
    });

    it('should create with custom similarity threshold', () => {
      const tracker = new ViolationTracker({ similarityThreshold: 0.8 });
      assert.ok(tracker);
    });
  });

  describe('trackFailure', () => {
    it('should track a failed violation', () => {
      const tracker = new ViolationTracker();
      const violation = {
        original: 'problematic prompt',
        attempts: 3,
        refinements: ['refined1', 'refined2']
      };

      tracker.trackFailure(violation);
      const failures = tracker.getFailures();

      assert.strictEqual(failures.length, 1);
      assert.strictEqual(failures[0].original, 'problematic prompt');
      assert.strictEqual(failures[0].attempts, 3);
      assert.ok(failures[0].timestamp);
    });

    it('should limit history to maxHistory', () => {
      const tracker = new ViolationTracker({ maxHistory: 2 });

      tracker.trackFailure({ original: 'prompt1', attempts: 1, refinements: [] });
      tracker.trackFailure({ original: 'prompt2', attempts: 1, refinements: [] });
      tracker.trackFailure({ original: 'prompt3', attempts: 1, refinements: [] });

      const failures = tracker.getFailures();
      assert.strictEqual(failures.length, 2);
      assert.strictEqual(failures[0].original, 'prompt2');
      assert.strictEqual(failures[1].original, 'prompt3');
    });
  });

  describe('trackSuccess', () => {
    it('should track a successful refinement', () => {
      const tracker = new ViolationTracker();
      const success = {
        original: 'problematic prompt',
        refined: 'safe prompt',
        attempts: 2
      };

      tracker.trackSuccess(success);
      const successes = tracker.getSuccesses();

      assert.strictEqual(successes.length, 1);
      assert.strictEqual(successes[0].original, 'problematic prompt');
      assert.strictEqual(successes[0].refined, 'safe prompt');
      assert.strictEqual(successes[0].attempts, 2);
      assert.ok(successes[0].timestamp);
    });

    it('should limit history to maxHistory', () => {
      const tracker = new ViolationTracker({ maxHistory: 2 });

      tracker.trackSuccess({ original: 'p1', refined: 'r1', attempts: 1 });
      tracker.trackSuccess({ original: 'p2', refined: 'r2', attempts: 1 });
      tracker.trackSuccess({ original: 'p3', refined: 'r3', attempts: 1 });

      const successes = tracker.getSuccesses();
      assert.strictEqual(successes.length, 2);
      assert.strictEqual(successes[0].original, 'p2');
      assert.strictEqual(successes[1].original, 'p3');
    });
  });

  describe('findSimilar', () => {
    it('should return empty array when no history', () => {
      const tracker = new ViolationTracker();
      const similar = tracker.findSimilar('test prompt');

      assert.ok(Array.isArray(similar));
      assert.strictEqual(similar.length, 0);
    });

    it('should find similar successful refinements', () => {
      const tracker = new ViolationTracker();

      tracker.trackSuccess({
        original: 'a violent scene with weapons',
        refined: 'a dramatic action scene',
        attempts: 2
      });

      tracker.trackSuccess({
        original: 'a peaceful garden',
        refined: 'a peaceful garden with flowers',
        attempts: 1
      });

      const similar = tracker.findSimilar('violent battle with swords');

      assert.ok(similar.length > 0);
      // Should find the violent/weapons prompt as most similar
      assert.ok(similar[0].original.includes('violent') || similar[0].original.includes('weapons'));
    });

    it('should return results sorted by similarity score', () => {
      const tracker = new ViolationTracker();

      tracker.trackSuccess({
        original: 'violent action scene',
        refined: 'dramatic action scene',
        attempts: 1
      });

      tracker.trackSuccess({
        original: 'violent explosive battle',
        refined: 'intense battle sequence',
        attempts: 1
      });

      tracker.trackSuccess({
        original: 'peaceful meditation',
        refined: 'calm meditation scene',
        attempts: 1
      });

      const similar = tracker.findSimilar('violent warfare');

      assert.ok(similar.length >= 2);
      // Results should be sorted by score (descending)
      assert.ok(similar[0].score >= similar[1].score);
    });

    it('should respect similarity threshold', () => {
      const tracker = new ViolationTracker({ similarityThreshold: 0.9 });

      tracker.trackSuccess({
        original: 'completely different unrelated topic',
        refined: 'something else entirely',
        attempts: 1
      });

      // Should not return results below threshold
      const similar = tracker.findSimilar('violent action scene');
      assert.strictEqual(similar.length, 0);
    });

    it('should limit results to maxResults', () => {
      const tracker = new ViolationTracker();

      // Add many similar items
      for (let i = 0; i < 10; i++) {
        tracker.trackSuccess({
          original: `violent scene ${i}`,
          refined: `action scene ${i}`,
          attempts: 1
        });
      }

      const similar = tracker.findSimilar('violent action', { maxResults: 3 });
      assert.strictEqual(similar.length, 3);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      const tracker = new ViolationTracker();

      tracker.trackSuccess({ original: 'p1', refined: 'r1', attempts: 1 });
      tracker.trackSuccess({ original: 'p2', refined: 'r2', attempts: 2 });
      tracker.trackFailure({ original: 'p3', attempts: 3, refinements: [] });

      const stats = tracker.getStats();

      assert.strictEqual(stats.totalViolations, 3);
      assert.strictEqual(stats.successfulRefinements, 2);
      assert.strictEqual(stats.failedRefinements, 1);
      assert.strictEqual(stats.successRate, 2 / 3);
      assert.strictEqual(stats.averageAttempts, (1 + 2 + 3) / 3);
    });

    it('should handle empty tracker', () => {
      const tracker = new ViolationTracker();
      const stats = tracker.getStats();

      assert.strictEqual(stats.totalViolations, 0);
      assert.strictEqual(stats.successfulRefinements, 0);
      assert.strictEqual(stats.failedRefinements, 0);
      assert.strictEqual(stats.successRate, 0);
      assert.strictEqual(stats.averageAttempts, 0);
    });
  });

  describe('clear', () => {
    it('should clear all history', () => {
      const tracker = new ViolationTracker();

      tracker.trackSuccess({ original: 'p1', refined: 'r1', attempts: 1 });
      tracker.trackFailure({ original: 'p2', attempts: 2, refinements: [] });

      tracker.clear();

      assert.strictEqual(tracker.getSuccesses().length, 0);
      assert.strictEqual(tracker.getFailures().length, 0);
      assert.strictEqual(tracker.getStats().totalViolations, 0);
    });
  });
});
