/**
 * 🔴 RED: Rate Limiter Tests
 *
 * Tests for concurrent request rate limiting to prevent API rate limit errors.
 * Ensures that maximum concurrent requests never exceeds configured limit.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');

describe('Rate Limiter', () => {
  test('should limit concurrent executions to specified concurrency', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(2); // Max 2 concurrent
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async (id) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 10));

      currentConcurrent--;
      return `result_${id}`;
    };

    // Run 5 tasks with max concurrency 2
    const results = await Promise.all([
      limiter.execute(() => task(1)),
      limiter.execute(() => task(2)),
      limiter.execute(() => task(3)),
      limiter.execute(() => task(4)),
      limiter.execute(() => task(5))
    ]);

    assert.strictEqual(results.length, 5, 'Should complete all tasks');
    assert.strictEqual(maxConcurrent, 2, 'Should never exceed max concurrency of 2');
  });

  test('should return results in correct order', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(1);
    const results = await Promise.all([
      limiter.execute(async () => 'a'),
      limiter.execute(async () => 'b'),
      limiter.execute(async () => 'c')
    ]);

    assert.deepStrictEqual(results, ['a', 'b', 'c'], 'Should return results in order');
  });

  test('should propagate errors from tasks', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(1);
    const errorTask = limiter.execute(async () => {
      throw new Error('Task failed');
    });

    assert.rejects(errorTask, /Task failed/, 'Should propagate errors');
  });

  test('should handle high concurrency values', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(100);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 5));
      currentConcurrent--;
      return 'done';
    };

    const promises = Array(50).fill().map(() => limiter.execute(task));
    await Promise.all(promises);

    assert.ok(maxConcurrent > 1, 'Should use higher concurrency');
    assert.ok(maxConcurrent <= 100, 'Should not exceed configured limit');
  });

  test('should work with different concurrency levels', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(3);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 5));
      currentConcurrent--;
    };

    const promises = Array(10).fill().map(() => limiter.execute(task));
    await Promise.all(promises);

    assert.strictEqual(maxConcurrent, 3, 'Should enforce concurrency level of 3');
  });
});
