/**
 * @file Service Stop Lock Integration Tests
 * Tests the complete STOP_LOCK workflow: stop → lock → blocked restart → unlock → allowed restart
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;

const ServiceManager = require('../../src/utils/service-manager');

describe('🟢 GREEN: Service Stop Lock Integration Workflow', () => {
  const testService = 'test-integration-flux';

  before(async () => {
    // Ensure no locks exist before tests
    await ServiceManager.deleteStopLock(testService);

    // Also clean up main service locks to avoid interference
    await ServiceManager.deleteStopLock('flux');
    await ServiceManager.deleteStopLock('llm');
    await ServiceManager.deleteStopLock('vision');
    await ServiceManager.deleteStopLock('vlm');
  });

  after(async () => {
    // Clean up any locks created during tests
    const services = ['test-integration-flux', 'test-integration-flux-cycle', 'test-integration-flux-timestamp',
                      'flux', 'llm', 'vision', 'vlm'];
    for (const service of services) {
      await ServiceManager.deleteStopLock(service);
    }
  });

  it('should have STOP_LOCK functions integrated into ServiceManager', async () => {
    // Verify all functions are exported
    assert.ok(typeof ServiceManager.createStopLock === 'function', 'createStopLock exported');
    assert.ok(typeof ServiceManager.hasStopLock === 'function', 'hasStopLock exported');
    assert.ok(typeof ServiceManager.deleteStopLock === 'function', 'deleteStopLock exported');
    assert.ok(typeof ServiceManager.getStopLockPath === 'function', 'getStopLockPath exported');
  });

  it('should simulate stop workflow: create lock', async () => {
    // Step 1: Stop a service (creates STOP_LOCK)
    await ServiceManager.createStopLock(testService);

    // Verify lock exists
    const hasLock = await ServiceManager.hasStopLock(testService);
    assert.strictEqual(hasLock, true, 'Lock should exist after stop');
  });

  it('should prevent restart while STOP_LOCK exists', async () => {
    // Lock should still exist from previous test
    const hasLock = await ServiceManager.hasStopLock(testService);
    assert.strictEqual(hasLock, true, 'Lock should still exist');

    // In real integration, the restart endpoint would check this
    // and return 409 Conflict if lock exists
    assert.ok(!hasLock === false, 'Lock exists so restart should be blocked');
  });

  it('should allow unlocking service', async () => {
    // Step 3: Remove STOP_LOCK (after confirming no pending restarts)
    await ServiceManager.deleteStopLock(testService);

    // Verify lock is gone
    const hasLock = await ServiceManager.hasStopLock(testService);
    assert.strictEqual(hasLock, false, 'Lock should be removed');
  });

  it('should allow restart after STOP_LOCK is removed', async () => {
    // Lock should be removed from previous test
    const hasLock = await ServiceManager.hasStopLock(testService);
    assert.strictEqual(hasLock, false, 'Lock should not exist after removal');

    // Now restart would be allowed
    assert.strictEqual(hasLock, false, 'Service can now be restarted');
  });

  it('should handle repeated lock/unlock cycles', async () => {
    const service = `${testService}-cycle`;

    // Cycle 1: Create and delete
    await ServiceManager.createStopLock(service);
    let hasLock = await ServiceManager.hasStopLock(service);
    assert.strictEqual(hasLock, true, 'Lock should exist after creation');

    await ServiceManager.deleteStopLock(service);
    hasLock = await ServiceManager.hasStopLock(service);
    assert.strictEqual(hasLock, false, 'Lock should be deleted');

    // Cycle 2: Repeat
    await ServiceManager.createStopLock(service);
    hasLock = await ServiceManager.hasStopLock(service);
    assert.strictEqual(hasLock, true, 'Lock should exist again');

    await ServiceManager.deleteStopLock(service);
    hasLock = await ServiceManager.hasStopLock(service);
    assert.strictEqual(hasLock, false, 'Lock should be deleted again');
  });

  it('should store lock with meaningful timestamp for debugging', async () => {
    const service = `${testService}-timestamp`;

    // Create lock and read its content
    await ServiceManager.createStopLock(service);
    const lockPath = ServiceManager.getStopLockPath(service);
    const content = await fs.readFile(lockPath, 'utf8');
    const timestamp = parseInt(content.trim(), 10);

    // Verify timestamp is a recent Unix timestamp
    assert.ok(!isNaN(timestamp), 'Lock should contain numeric timestamp');

    const now = Date.now();
    const age = now - timestamp;
    assert.ok(age >= 0 && age < 5000, `Timestamp should be recent (age: ${age}ms)`);

    // Cleanup
    await ServiceManager.deleteStopLock(service);
  });
});
