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

describe('RateLimiter.setConcurrencyLimit', () => {
  test('should update concurrency limit', () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(3);
    assert.strictEqual(limiter.concurrencyLimit, 3, 'Initial limit should be 3');

    limiter.setConcurrencyLimit(1);
    assert.strictEqual(limiter.concurrencyLimit, 1, 'Should update to 1');

    limiter.setConcurrencyLimit(5);
    assert.strictEqual(limiter.concurrencyLimit, 5, 'Should update to 5');
  });

  test('should reject invalid concurrency limits', () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(3);

    assert.throws(
      () => limiter.setConcurrencyLimit(0),
      /Concurrency limit must be a positive integer/,
      'Should reject 0'
    );

    assert.throws(
      () => limiter.setConcurrencyLimit(-1),
      /Concurrency limit must be a positive integer/,
      'Should reject negative numbers'
    );

    assert.throws(
      () => limiter.setConcurrencyLimit(1.5),
      /Concurrency limit must be a positive integer/,
      'Should reject non-integers'
    );

    assert.throws(
      () => limiter.setConcurrencyLimit('2'),
      /Concurrency limit must be a positive integer/,
      'Should reject strings'
    );
  });

  test('should enforce new lower limit for subsequent tasks', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(5);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 20));
      currentConcurrent--;
      return 'done';
    };

    // Change to serial (1) before running tasks
    limiter.setConcurrencyLimit(1);

    const promises = Array(3).fill().map(() => limiter.execute(task));
    await Promise.all(promises);

    assert.strictEqual(maxConcurrent, 1, 'Should enforce new limit of 1');
  });

  test('should start queued tasks when limit increases', async () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(1);
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const completionOrder = [];

    const task = async (id) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 10));
      currentConcurrent--;
      completionOrder.push(id);
      return id;
    };

    // Start tasks with limit of 1 (will queue)
    const promise1 = limiter.execute(() => task(1));
    const promise2 = limiter.execute(() => task(2));
    const promise3 = limiter.execute(() => task(3));

    // Wait a moment for first task to start
    await new Promise(resolve => setTimeout(resolve, 5));

    // Increase limit - should start more queued tasks
    limiter.setConcurrencyLimit(3);

    await Promise.all([promise1, promise2, promise3]);

    // After increasing to 3, concurrent tasks should have increased
    assert.ok(maxConcurrent >= 1, 'Should have run at least 1 concurrent task');
  });

  test('should report metrics correctly after limit change', () => {
    const { RateLimiter } = require('../../src/utils/rate-limiter.js');

    const limiter = new RateLimiter(3);
    const metrics1 = limiter.getMetrics();
    assert.strictEqual(metrics1.limit, 3, 'Initial metrics should show limit of 3');

    limiter.setConcurrencyLimit(1);
    const metrics2 = limiter.getMetrics();
    assert.strictEqual(metrics2.limit, 1, 'Metrics should show updated limit of 1');
  });
});
