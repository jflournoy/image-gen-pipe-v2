/**
 * @file Service Stop Lock Bulk Operations Tests
 * Tests for stopping/resetting all services at once
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const ServiceManager = require('../../src/utils/service-manager');

describe('Service Stop Lock: Bulk Operations', () => {
  const allServices = ['flux', 'llm', 'vision', 'vlm'];

  before(async () => {
    // Clean up any existing locks
    for (const service of allServices) {
      await ServiceManager.deleteStopLock(service);
    }
  });

  after(async () => {
    // Clean up locks created during tests
    for (const service of allServices) {
      await ServiceManager.deleteStopLock(service);
    }
  });

  describe('Stop All Services', () => {
    it('should create STOP_LOCKs for all services', async () => {
      // Create locks for all services
      for (const service of allServices) {
        await ServiceManager.createStopLock(service);
      }

      // Verify all locks exist
      const locks = await ServiceManager.getAllStopLocks();
      for (const service of allServices) {
        assert.strictEqual(locks[service].hasLock, true, `${service} should have lock`);
      }

      // Cleanup
      for (const service of allServices) {
        await ServiceManager.deleteStopLock(service);
      }
    });

    it('should get lock status for all services at once', async () => {
      // Create locks for some services
      await ServiceManager.createStopLock('flux');
      await ServiceManager.createStopLock('llm');

      // Get all locks
      const locks = await ServiceManager.getAllStopLocks();

      // Verify structure
      assert.ok(locks.flux.hasLock, 'flux should have lock');
      assert.ok(locks.llm.hasLock, 'llm should have lock');
      assert.strictEqual(locks.vision.hasLock, false, 'vision should not have lock');
      assert.strictEqual(locks.vlm.hasLock, false, 'vlm should not have lock');

      // Cleanup
      await ServiceManager.deleteStopLock('flux');
      await ServiceManager.deleteStopLock('llm');
    });
  });

  describe('Reset All Services', () => {
    it('should remove all STOP_LOCKs at once', async () => {
      // Setup: Create locks for all services
      for (const service of allServices) {
        await ServiceManager.createStopLock(service);
      }

      // Verify all locked
      let locks = await ServiceManager.getAllStopLocks();
      for (const service of allServices) {
        assert.strictEqual(locks[service].hasLock, true, `${service} should have lock`);
      }

      // Delete all locks
      for (const service of allServices) {
        await ServiceManager.deleteStopLock(service);
      }

      // Verify all unlocked
      locks = await ServiceManager.getAllStopLocks();
      for (const service of allServices) {
        assert.strictEqual(locks[service].hasLock, false, `${service} should not have lock`);
      }
    });

    it('should handle partial unlock correctly', async () => {
      // Setup: Create locks for all services
      for (const service of allServices) {
        await ServiceManager.createStopLock(service);
      }

      // Delete some locks (flux, llm)
      await ServiceManager.deleteStopLock('flux');
      await ServiceManager.deleteStopLock('llm');

      // Verify partial unlock
      const locks = await ServiceManager.getAllStopLocks();
      assert.strictEqual(locks.flux.hasLock, false, 'flux should be unlocked');
      assert.strictEqual(locks.llm.hasLock, false, 'llm should be unlocked');
      assert.strictEqual(locks.vision.hasLock, true, 'vision should still be locked');
      assert.strictEqual(locks.vlm.hasLock, true, 'vlm should still be locked');

      // Cleanup
      await ServiceManager.deleteStopLock('vision');
      await ServiceManager.deleteStopLock('vlm');
    });
  });

  describe('UI Stop All Workflow', () => {
    it('should support stopping all services with locks', async () => {
      // Simulate UI "Stop All" button workflow:
      // 1. Create STOP_LOCKs for all services
      for (const service of allServices) {
        await ServiceManager.createStopLock(service);
      }

      // 2. Verify all are locked
      const locks = await ServiceManager.getAllStopLocks();
      const lockedServices = Object.entries(locks)
        .filter(([, status]) => status.hasLock)
        .map(([name]) => name)
        .sort();

      assert.deepStrictEqual(
        lockedServices,
        allServices.sort(),
        'All services should be locked'
      );

      // Cleanup
      for (const service of allServices) {
        await ServiceManager.deleteStopLock(service);
      }
    });

    it('should support resetting all services', async () => {
      // Simulate UI "Reset All" button workflow:
      // 1. Create STOP_LOCKs for all services
      for (const service of allServices) {
        await ServiceManager.createStopLock(service);
      }

      // 2. Remove all locks
      for (const service of allServices) {
        await ServiceManager.deleteStopLock(service);
      }

      // 3. Verify none are locked
      const locks = await ServiceManager.getAllStopLocks();
      const lockedServices = Object.entries(locks)
        .filter(([, status]) => status.hasLock)
        .map(([name]) => name);

      assert.strictEqual(lockedServices.length, 0, 'No services should be locked');
    });
  });
});
