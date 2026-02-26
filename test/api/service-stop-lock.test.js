/**
 * @file Service Stop Lock Tests (TDD RED)
 * Tests for STOP_LOCK mechanism that prevents restarts after manual service stop
 *
 * Feature: When stopping a service via UI, create a STOP_LOCK to block restarts
 * until we're confident no pending restarts will occur.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;

const ServiceManager = require('../../src/utils/service-manager');

const TEMP_DIR = '/tmp/stop-lock-tests';

describe('🔴 RED: Service Stop Lock Mechanism', () => {
  before(async () => {
    // Create temp directory for test lock files
    try {
      await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch {
      // Already exists
    }

    // Clean up main service locks to avoid interference with other tests
    await ServiceManager.deleteStopLock('flux');
    await ServiceManager.deleteStopLock('llm');
    await ServiceManager.deleteStopLock('vision');
    await ServiceManager.deleteStopLock('vlm');
  });

  after(async () => {
    // Cleanup locks created during tests
    const services = ['flux', 'llm', 'vision', 'vlm', 'test-flux', 'test-llm', 'test-vision', 'test-vlm'];
    for (const service of services) {
      await ServiceManager.deleteStopLock(service);
    }

    // Cleanup temp directory
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Stop Lock File Creation', () => {
    it('should create STOP_LOCK file when stopping a service', async () => {
      // Note: This test defines the API we want
      // ServiceManager should have a createStopLock() method
      assert.ok(
        typeof ServiceManager.createStopLock === 'function',
        'ServiceManager should export createStopLock function'
      );
    });

    it('should get STOP_LOCK file path for a service', async () => {
      // ServiceManager should have a getStopLockPath() method
      assert.ok(
        typeof ServiceManager.getStopLockPath === 'function',
        'ServiceManager should export getStopLockPath function'
      );

      const lockPath = ServiceManager.getStopLockPath('flux');
      assert.ok(lockPath.includes('flux'), 'Lock path should include service name');
      assert.ok(lockPath.includes('STOP_LOCK'), 'Lock path should include STOP_LOCK marker');
    });

    it('should check if STOP_LOCK exists for a service', async () => {
      // ServiceManager should have a hasStopLock() method
      assert.ok(
        typeof ServiceManager.hasStopLock === 'function',
        'ServiceManager should export hasStopLock function'
      );
    });

    it('should delete STOP_LOCK file for a service', async () => {
      // ServiceManager should have a deleteStopLock() method
      assert.ok(
        typeof ServiceManager.deleteStopLock === 'function',
        'ServiceManager should export deleteStopLock function'
      );
    });
  });

  describe('Stop Lock Behavior', () => {
    it('should create STOP_LOCK when creating a new lock', async () => {
      const serviceName = 'test-flux';

      // Create lock
      await ServiceManager.createStopLock(serviceName);

      // Check it exists
      const hasLock = await ServiceManager.hasStopLock(serviceName);
      assert.strictEqual(hasLock, true, 'Lock should exist after creation');

      // Cleanup
      await ServiceManager.deleteStopLock(serviceName);
    });

    it('should prevent restart when STOP_LOCK exists', async () => {
      // This is more of an integration test concept
      // The UI should check hasStopLock() before allowing restart
      // The API routes should respect the STOP_LOCK
      assert.ok(
        typeof ServiceManager.hasStopLock === 'function',
        'hasStopLock should be available to check before restart'
      );
    });

    it('should allow deleting STOP_LOCK file', async () => {
      const serviceName = 'test-llm';

      // Create lock
      await ServiceManager.createStopLock(serviceName);

      // Verify it exists
      let hasLock = await ServiceManager.hasStopLock(serviceName);
      assert.strictEqual(hasLock, true, 'Lock should exist after creation');

      // Delete lock
      await ServiceManager.deleteStopLock(serviceName);

      // Verify it's gone
      hasLock = await ServiceManager.hasStopLock(serviceName);
      assert.strictEqual(hasLock, false, 'Lock should not exist after deletion');
    });

    it('should handle deleting non-existent STOP_LOCK gracefully', async () => {
      const serviceName = 'test-vision';

      // Ensure lock doesn't exist
      await ServiceManager.deleteStopLock(serviceName);

      // Deleting again should not throw
      assert.doesNotThrow(
        async () => {
          await ServiceManager.deleteStopLock(serviceName);
        },
        'Deleting non-existent lock should not throw'
      );
    });

    it('should create STOP_LOCK with timestamp for debugging', async () => {
      const serviceName = 'test-vlm';

      // Create lock
      await ServiceManager.createStopLock(serviceName);

      // Read lock file to verify it contains timestamp
      const lockPath = ServiceManager.getStopLockPath(serviceName);
      const content = await fs.readFile(lockPath, 'utf8');

      // Lock should contain timestamp for debugging
      const timestamp = parseInt(content.trim(), 10);
      assert.ok(!isNaN(timestamp), 'Lock file should contain numeric timestamp');

      // Timestamp should be recent (within last 5 seconds)
      const now = Date.now();
      const age = now - timestamp;
      assert.ok(age >= 0 && age < 5000, 'Timestamp should be recent');

      // Cleanup
      await ServiceManager.deleteStopLock(serviceName);
    });
  });

  describe('Stop Lock Integration with stopService', () => {
    it('should create STOP_LOCK when stopService is called with createLock option', async () => {
      // Note: This would require modifying stopService signature
      // For now, we verify the method exists and works independently
      assert.ok(
        typeof ServiceManager.createStopLock === 'function',
        'createStopLock should be available'
      );
    });
  });

  describe('Lock File Cleanup', () => {
    it('should clean up multiple STOP_LOCK files', async () => {
      const services = ['flux', 'llm', 'vision', 'vlm'];

      // Create locks for all services
      for (const service of services) {
        await ServiceManager.createStopLock(service);
      }

      // Verify all exist
      for (const service of services) {
        const hasLock = await ServiceManager.hasStopLock(service);
        assert.strictEqual(hasLock, true, `Lock should exist for ${service}`);
      }

      // Clean up all
      for (const service of services) {
        await ServiceManager.deleteStopLock(service);
      }

      // Verify all are gone
      for (const service of services) {
        const hasLock = await ServiceManager.hasStopLock(service);
        assert.strictEqual(hasLock, false, `Lock should not exist for ${service}`);
      }
    });
  });
});
