/**
 * 🔴 RED: ServiceConnection Tests
 *
 * Tests for the shared service connection utility that provides
 * PID-aware retry/restart logic for all local service providers.
 */

const { describe, test, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('ServiceConnection', () => {
  let ServiceConnection;
  let mockServiceManager;

  beforeEach(() => {
    // Mock service-manager module
    mockServiceManager = {
      isServiceRunning: mock.fn(async () => false),
      getServiceUrl: mock.fn((name) => `http://localhost:8003`),
    };

    // Clear module cache
    delete require.cache[require.resolve('../../src/utils/service-connection.js')];
  });

  function createConnection(overrides = {}) {
    const ServiceConnectionClass = require('../../src/utils/service-connection.js');
    return new ServiceConnectionClass({
      serviceName: 'llm',
      serviceManager: mockServiceManager,
      serviceRestarter: overrides.serviceRestarter || null,
      onUrlChanged: overrides.onUrlChanged || (() => {}),
      ...overrides,
    });
  }

  describe('withRetry - successful operations', () => {
    test('should succeed on first attempt when service is healthy', async () => {
      const conn = createConnection();
      const result = await conn.withRetry(async () => 'success', {
        operationName: 'test op',
      });
      assert.strictEqual(result, 'success');
      // Should not have checked PID since operation succeeded
      assert.strictEqual(mockServiceManager.isServiceRunning.mock.callCount(), 0);
    });

    test('should pass through non-connection errors immediately', async () => {
      const conn = createConnection();
      const httpError = new Error('Request failed with status code 500');
      httpError.response = { status: 500 };

      await assert.rejects(
        () => conn.withRetry(async () => { throw httpError; }, { operationName: 'test op' }),
        (err) => err.message.includes('500')
      );
      // Should not check PID for non-connection errors
      assert.strictEqual(mockServiceManager.isServiceRunning.mock.callCount(), 0);
    });
  });

  describe('withRetry - process not running', () => {
    test('should skip retries and restart immediately when process is not running', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);
      const restarter = mock.fn(async () => ({ success: true, port: 8003 }));

      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return 'success after restart';
      };

      const conn = createConnection({ serviceRestarter: restarter });
      const result = await conn.withRetry(operation, { operationName: 'test op' });

      assert.strictEqual(result, 'success after restart');
      // Should have checked PID
      assert.strictEqual(mockServiceManager.isServiceRunning.mock.callCount(), 1);
      // Should have restarted immediately (no wasted retries)
      assert.strictEqual(restarter.mock.callCount(), 1);
      // Operation called exactly twice: initial fail + post-restart success
      assert.strictEqual(callCount, 2);
    });

    test('should fail with clear error when process not running and no restarter', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);

      const operation = async () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');
        err.code = 'ECONNREFUSED';
        throw err;
      };

      const conn = createConnection({ serviceRestarter: null });
      await assert.rejects(
        () => conn.withRetry(operation, { operationName: 'test op' }),
        (err) => {
          assert.ok(err.message.includes('not running'), `Expected "not running" in: ${err.message}`);
          return true;
        }
      );
    });

    test('should fail with clear error when restart fails', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);
      const restarter = mock.fn(async () => ({
        success: false,
        error: 'No available port in range 8003-8012',
      }));

      const operation = async () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');
        err.code = 'ECONNREFUSED';
        throw err;
      };

      const conn = createConnection({ serviceRestarter: restarter });
      await assert.rejects(
        () => conn.withRetry(operation, { operationName: 'test op' }),
        (err) => {
          assert.ok(err.message.includes('restart failed'), `Expected "restart failed" in: ${err.message}`);
          assert.ok(err.message.includes('No available port'), `Expected port error in: ${err.message}`);
          return true;
        }
      );
    });
  });

  describe('withRetry - process running but not responding', () => {
    test('should do quick retries before restarting when process is alive', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => true);
      const restarter = mock.fn(async () => ({ success: true, port: 8003 }));

      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount <= 3) {
          // Fail 3 times: initial + 2 quick retries
          const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return 'success after restart';
      };

      const conn = createConnection({ serviceRestarter: restarter });
      const result = await conn.withRetry(operation, { operationName: 'test op' });

      assert.strictEqual(result, 'success after restart');
      // Should have checked PID on first failure
      assert.ok(mockServiceManager.isServiceRunning.mock.callCount() >= 1);
      // Should have done quick retries THEN restart (not immediately)
      assert.strictEqual(restarter.mock.callCount(), 1);
      // 1 initial + 2 quick retries + 1 post-restart = 4 calls
      assert.strictEqual(callCount, 4);
    });

    test('should succeed without restart if quick retries work', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => true);
      const restarter = mock.fn(async () => ({ success: true, port: 8003 }));

      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return 'recovered';
      };

      const conn = createConnection({ serviceRestarter: restarter });
      const result = await conn.withRetry(operation, { operationName: 'test op' });

      assert.strictEqual(result, 'recovered');
      // Should NOT have restarted since quick retry worked
      assert.strictEqual(restarter.mock.callCount(), 0);
    });
  });

  describe('withRetry - URL updates after restart', () => {
    test('should call onUrlChanged when restart changes port', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);
      mockServiceManager.getServiceUrl = mock.fn(() => 'http://localhost:8005');
      const restarter = mock.fn(async () => ({ success: true, port: 8005 }));
      const onUrlChanged = mock.fn();

      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return 'success';
      };

      const conn = createConnection({ serviceRestarter: restarter, onUrlChanged });
      await conn.withRetry(operation, { operationName: 'test op' });

      assert.strictEqual(onUrlChanged.mock.callCount(), 1);
      assert.strictEqual(onUrlChanged.mock.calls[0].arguments[0], 'http://localhost:8005');
    });

    test('should resolve current URL via getServiceUrl', async () => {
      mockServiceManager.getServiceUrl = mock.fn(() => 'http://localhost:8007');

      const conn = createConnection();
      const url = conn.getApiUrl();

      assert.strictEqual(url, 'http://localhost:8007');
      assert.strictEqual(mockServiceManager.getServiceUrl.mock.callCount(), 1);
    });
  });

  describe('withRetry - attemptRestart option', () => {
    test('should not attempt restart when attemptRestart is false', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);
      const restarter = mock.fn(async () => ({ success: true, port: 8003 }));

      const operation = async () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');
        err.code = 'ECONNREFUSED';
        throw err;
      };

      const conn = createConnection({ serviceRestarter: restarter });
      await assert.rejects(
        () => conn.withRetry(operation, { operationName: 'test op', attemptRestart: false }),
        (err) => {
          assert.ok(err.message.includes('ECONNREFUSED') || err.message.includes('not running'));
          return true;
        }
      );
      // Should NOT have attempted restart
      assert.strictEqual(restarter.mock.callCount(), 0);
    });
  });

  describe('connection error detection', () => {
    test('should detect ECONNREFUSED by error code', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);

      const err = new Error('some error');
      err.code = 'ECONNREFUSED';

      const conn = createConnection();
      await assert.rejects(
        () => conn.withRetry(async () => { throw err; }, { operationName: 'test' }),
        (e) => {
          // Should have checked PID (meaning it recognized this as a connection error)
          assert.strictEqual(mockServiceManager.isServiceRunning.mock.callCount(), 1);
          return true;
        }
      );
    });

    test('should detect ECONNREFUSED in error message', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);

      const err = new Error('connect ECONNREFUSED 127.0.0.1:8003');

      const conn = createConnection();
      await assert.rejects(
        () => conn.withRetry(async () => { throw err; }, { operationName: 'test' }),
        (e) => {
          assert.strictEqual(mockServiceManager.isServiceRunning.mock.callCount(), 1);
          return true;
        }
      );
    });

    test('should detect "Cannot reach" messages as connection errors', async () => {
      mockServiceManager.isServiceRunning = mock.fn(async () => false);

      const err = new Error('Cannot reach local LLM service at http://localhost:8003');

      const conn = createConnection();
      await assert.rejects(
        () => conn.withRetry(async () => { throw err; }, { operationName: 'test' }),
        (e) => {
          assert.strictEqual(mockServiceManager.isServiceRunning.mock.callCount(), 1);
          return true;
        }
      );
    });

    test('should NOT treat HTTP errors as connection errors', async () => {
      const err = new Error('Request failed with status code 400');
      err.response = { status: 400 };

      const conn = createConnection();
      await assert.rejects(
        () => conn.withRetry(async () => { throw err; }, { operationName: 'test' }),
        (e) => {
          // Should NOT have checked PID
          assert.strictEqual(mockServiceManager.isServiceRunning.mock.callCount(), 0);
          return true;
        }
      );
    });
  });
});
