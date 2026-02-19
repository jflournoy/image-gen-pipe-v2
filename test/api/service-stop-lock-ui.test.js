/**
 * @file Service Stop Lock UI Integration Tests
 * Tests the UI-facing endpoints for clearing stop locks
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const ServiceManager = require('../../src/utils/service-manager');

describe('UI: Service Stop Lock Clearing', () => {
  const testServices = ['flux', 'llm', 'vision', 'vlm'];

  before(async () => {
    // Clean up any existing locks from all possible services
    // This is more thorough to handle cross-test cleanup
    await ServiceManager.deleteStopLock('flux');
    await ServiceManager.deleteStopLock('llm');
    await ServiceManager.deleteStopLock('vision');
    await ServiceManager.deleteStopLock('vlm');
    // Also clean up test-prefixed ones
    await ServiceManager.deleteStopLock('test-flux');
    await ServiceManager.deleteStopLock('test-llm');
    await ServiceManager.deleteStopLock('test-vision');
    await ServiceManager.deleteStopLock('test-vlm');
  });

  after(async () => {
    // Clean up locks created during tests
    for (const service of testServices) {
      await ServiceManager.deleteStopLock(service);
    }
  });

  describe('Status Endpoint Enhancement', () => {
    it('should have getAllStopLocks function in ServiceManager', () => {
      assert.ok(
        typeof ServiceManager.getAllStopLocks === 'function',
        'ServiceManager should export getAllStopLocks function'
      );
    });

    it('should get stop lock status for all services', async () => {
      // Create locks for flux and llm
      await ServiceManager.createStopLock('flux');
      await ServiceManager.createStopLock('llm');

      // Get all locks
      const locks = await ServiceManager.getAllStopLocks();

      // Verify structure
      assert.ok(locks.flux, 'flux should be in locks');
      assert.ok(locks.llm, 'llm should be in locks');
      assert.ok(locks.vision, 'vision should be in locks');
      assert.ok(locks.vlm, 'vlm should be in locks');

      // Verify lock status
      assert.strictEqual(locks.flux.hasLock, true, 'flux should have lock');
      assert.strictEqual(locks.llm.hasLock, true, 'llm should have lock');
      assert.strictEqual(locks.vision.hasLock, false, 'vision should not have lock');
      assert.strictEqual(locks.vlm.hasLock, false, 'vlm should not have lock');
    });

    it('should include lock paths in lock status', async () => {
      await ServiceManager.createStopLock('flux');

      const locks = await ServiceManager.getAllStopLocks();

      assert.ok(locks.flux.lockPath, 'lockPath should be included');
      assert.ok(locks.flux.lockPath.includes('flux'), 'lockPath should include service name');
      assert.ok(locks.flux.lockPath.includes('STOP_LOCK'), 'lockPath should include STOP_LOCK marker');

      await ServiceManager.deleteStopLock('flux');
    });
  });

  describe('UI Reset Workflow', () => {
    it('should allow UI to clear a single STOP_LOCK', async () => {
      const service = 'flux';

      // Simulate: Service stopped (lock created)
      await ServiceManager.createStopLock(service);
      let hasLock = await ServiceManager.hasStopLock(service);
      assert.strictEqual(hasLock, true, 'Lock should exist after stop');

      // Simulate: UI "Reset" button clicked (delete lock)
      await ServiceManager.deleteStopLock(service);
      hasLock = await ServiceManager.hasStopLock(service);
      assert.strictEqual(hasLock, false, 'Lock should be removed after reset');
    });

    it('should allow UI to clear multiple STOP_LOCKs', async () => {
      // Simulate: Multiple services stopped
      await ServiceManager.createStopLock('flux');
      await ServiceManager.createStopLock('llm');
      await ServiceManager.createStopLock('vision');

      // Get locks before clear
      let locks = await ServiceManager.getAllStopLocks();
      const lockedBefore = Object.entries(locks)
        .filter(([, status]) => status.hasLock)
        .map(([name]) => name);
      assert.strictEqual(lockedBefore.length, 3, 'Should have 3 locks');

      // Simulate: UI "Reset All" button clicked
      for (const service of lockedBefore) {
        await ServiceManager.deleteStopLock(service);
      }

      // Verify all locks removed
      locks = await ServiceManager.getAllStopLocks();
      const lockedAfter = Object.entries(locks)
        .filter(([, status]) => status.hasLock)
        .map(([name]) => name);
      assert.strictEqual(lockedAfter.length, 0, 'Should have 0 locks after reset all');
    });
  });

  describe('Partial Reset Workflow', () => {
    it('should allow selective clearing of STOP_LOCKs', async () => {
      // Ensure clean state - delete any existing locks
      await ServiceManager.deleteStopLock('flux');
      await ServiceManager.deleteStopLock('llm');
      await ServiceManager.deleteStopLock('vision');
      await ServiceManager.deleteStopLock('vlm');

      // Setup: Create locks for multiple services
      await ServiceManager.createStopLock('flux');
      await ServiceManager.createStopLock('llm');
      await ServiceManager.createStopLock('vision');

      // Get initial state - verify exactly 3 locks
      let locks = await ServiceManager.getAllStopLocks();
      let lockedServices = Object.entries(locks)
        .filter(([, status]) => status.hasLock)
        .map(([name]) => name)
        .sort();
      assert.deepStrictEqual(
        lockedServices,
        ['flux', 'llm', 'vision'].sort(),
        `Should have exactly 3 locked services (flux, llm, vision), got: ${lockedServices}`
      );

      // Clear only flux
      await ServiceManager.deleteStopLock('flux');

      // Verify state
      locks = await ServiceManager.getAllStopLocks();
      lockedServices = Object.entries(locks)
        .filter(([, status]) => status.hasLock)
        .map(([name]) => name)
        .sort();
      assert.deepStrictEqual(
        lockedServices,
        ['llm', 'vision'].sort(),
        'Should have llm and vision locked after clearing flux'
      );

      // Cleanup
      await ServiceManager.deleteStopLock('llm');
      await ServiceManager.deleteStopLock('vision');
    });
  });

  describe('UI Message Generation', () => {
    it('should provide clear messages for locked vs unlocked services', async () => {
      // Setup: Create lock for flux
      await ServiceManager.createStopLock('flux');

      // Get status
      const locks = await ServiceManager.getAllStopLocks();

      // Messages that UI could display
      const fluxMessage = locks.flux.hasLock
        ? 'Stopped by user - click reset to allow restarts'
        : 'Running';
      const llmMessage = locks.llm.hasLock
        ? 'Stopped by user - click reset to allow restarts'
        : 'Running';

      assert.strictEqual(fluxMessage, 'Stopped by user - click reset to allow restarts');
      assert.strictEqual(llmMessage, 'Running');

      // Cleanup
      await ServiceManager.deleteStopLock('flux');
    });
  });
});
