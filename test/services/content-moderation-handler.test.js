/**
 * TDD RED Phase: Content Moderation Handler Tests
 *
 * Feature: Automatic retry with prompt refinement when content policy violations occur
 *
 * Requirements:
 * - Detect content moderation errors (400 status with policy violation message)
 * - Retry up to N times (default 3, configurable)
 * - Refine prompts to be as close as possible to original
 * - Track violations and successful refinements
 * - Use similarity search to find relevant examples for refinement
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const ContentModerationHandler = require('../../src/services/content-moderation-handler.js');

describe('ContentModerationHandler', () => {
  describe('constructor', () => {
    it('should initialize with default max retries of 3', () => {
      const handler = new ContentModerationHandler();
      assert.strictEqual(handler.maxRetries, 3);
    });

    it('should accept custom max retries', () => {
      const handler = new ContentModerationHandler({ maxRetries: 5 });
      assert.strictEqual(handler.maxRetries, 5);
    });
  });

  describe('isContentViolation', () => {
    it('should detect OpenAI content policy violation error', () => {
      const handler = new ContentModerationHandler();
      const error = new Error('Your request was rejected due to content policy violation');
      error.status = 400;

      assert.strictEqual(handler.isContentViolation(error), true);
    });

    it('should detect error with inappropriate content message', () => {
      const handler = new ContentModerationHandler();
      const error = new Error('The content was flagged as inappropriate');
      error.status = 400;

      assert.strictEqual(handler.isContentViolation(error), true);
    });

    it('should return false for non-400 errors', () => {
      const handler = new ContentModerationHandler();
      const error = new Error('Server error');
      error.status = 500;

      assert.strictEqual(handler.isContentViolation(error), false);
    });

    it('should return false for 400 errors without policy violation', () => {
      const handler = new ContentModerationHandler();
      const error = new Error('Invalid parameter');
      error.status = 400;

      assert.strictEqual(handler.isContentViolation(error), false);
    });
  });

  describe('executeWithRetry', () => {
    it('should execute function successfully on first try', async () => {
      const handler = new ContentModerationHandler();
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { result: 'success' };
      };

      const result = await handler.executeWithRetry(mockFn, 'original prompt');

      assert.deepStrictEqual(result, { result: 'success' });
      assert.strictEqual(callCount, 1);
    });

    it('should retry on content violation and succeed', async () => {
      const handler = new ContentModerationHandler({ maxRetries: 2 });
      const violationError = new Error('Content policy violation');
      violationError.status = 400;

      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        if (callCount === 1) {
          throw violationError;
        }
        return { result: 'success after refinement' };
      };

      let refinerCalled = false;
      handler.promptRefiner = {
        refinePrompt: (prompt, context) => {
          refinerCalled = true;
          assert.strictEqual(prompt, 'problematic prompt');
          assert.ok(context.error);
          return 'refined prompt';
        }
      };

      const result = await handler.executeWithRetry(mockFn, 'problematic prompt');

      assert.deepStrictEqual(result, { result: 'success after refinement' });
      assert.strictEqual(callCount, 2);
      assert.strictEqual(refinerCalled, true);
    });

    it('should track violation when retry succeeds', async () => {
      const handler = new ContentModerationHandler();
      const violationError = new Error('Content policy violation');
      violationError.status = 400;

      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        if (callCount === 1) {
          throw violationError;
        }
        return { result: 'success' };
      };

      handler.promptRefiner = {
        refinePrompt: () => 'safe prompt'
      };

      let trackedSuccess = null;
      handler.violationTracker = {
        trackSuccess: (data) => {
          trackedSuccess = data;
        }
      };

      await handler.executeWithRetry(mockFn, 'unsafe prompt');

      assert.ok(trackedSuccess);
      assert.strictEqual(trackedSuccess.original, 'unsafe prompt');
      assert.strictEqual(trackedSuccess.refined, 'safe prompt');
      assert.strictEqual(trackedSuccess.attempts, 1);
    });

    it('should throw error after max retries exceeded', async () => {
      const handler = new ContentModerationHandler({ maxRetries: 2 });
      const violationError = new Error('Content policy violation');
      violationError.status = 400;

      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        throw violationError;
      };

      handler.promptRefiner = {
        refinePrompt: () => 'still unsafe'
      };

      await assert.rejects(
        async () => handler.executeWithRetry(mockFn, 'unsafe prompt'),
        /Max retries \(2\) exceeded for content moderation/
      );

      assert.strictEqual(callCount, 3); // Initial + 2 retries
    });

    it('should track all failed attempts', async () => {
      const handler = new ContentModerationHandler({ maxRetries: 2 });
      const violationError = new Error('Content policy violation');
      violationError.status = 400;

      const mockFn = async () => {
        throw violationError;
      };

      handler.promptRefiner = {
        refinePrompt: () => 'refined'
      };

      let trackedFailure = null;
      handler.violationTracker = {
        trackFailure: (data) => {
          trackedFailure = data;
        }
      };

      await assert.rejects(
        async () => handler.executeWithRetry(mockFn, 'unsafe prompt')
      );

      assert.ok(trackedFailure);
      assert.strictEqual(trackedFailure.original, 'unsafe prompt');
      assert.strictEqual(trackedFailure.attempts, 3);
      assert.ok(Array.isArray(trackedFailure.refinements));
      assert.ok(trackedFailure.refinements.includes('refined'));
    });
  });
});
