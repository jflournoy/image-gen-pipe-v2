/**
 * @file Quick Service Manager Tests
 * Fast unit tests for core service manager functionality
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ServiceManager = require('../../src/utils/service-manager');

describe('Service Manager - Core Functionality', () => {
  const testPIDPath = path.join('/tmp', 'test_service.pid');

  // Cleanup after all tests
  after(() => {
    if (fs.existsSync(testPIDPath)) {
      fs.unlinkSync(testPIDPath);
    }
  });

  describe('PID File Management', () => {
    it('should write PID file', async () => {
      await ServiceManager.writePIDFile('test', 12345);
      assert.ok(fs.existsSync(testPIDPath), 'PID file should exist');

      const content = fs.readFileSync(testPIDPath, 'utf8');
      assert.strictEqual(content, '12345', 'Should write correct PID');

      fs.unlinkSync(testPIDPath);
    });

    it('should read PID file', async () => {
      fs.writeFileSync(testPIDPath, '98765');

      const pid = await ServiceManager.readPIDFile('test');
      assert.strictEqual(pid, 98765, 'Should read correct PID');

      fs.unlinkSync(testPIDPath);
    });

    it('should return null for non-existent PID file', async () => {
      const pid = await ServiceManager.readPIDFile('nonexistent');
      assert.strictEqual(pid, null, 'Should return null for missing file');
    });

    it('should delete PID file', async () => {
      fs.writeFileSync(testPIDPath, '11111');

      await ServiceManager.deletePIDFile('test');
      assert.ok(!fs.existsSync(testPIDPath), 'PID file should be deleted');
    });
  });

  describe('Process Detection', () => {
    it('should detect stale PID file', async () => {
      // Write PID that definitely doesn't exist
      fs.writeFileSync(testPIDPath, '99999');

      const isRunning = await ServiceManager.isServiceRunning('test');
      assert.strictEqual(isRunning, false, 'Should detect stale PID');

      // Should auto-clean up stale PID
      assert.ok(!fs.existsSync(testPIDPath), 'Should delete stale PID file');
    });

    it('should detect running process', async () => {
      // Start a dummy process
      const proc = spawn('sleep', ['10']);
      fs.writeFileSync(testPIDPath, proc.pid.toString());

      const isRunning = await ServiceManager.isServiceRunning('test');
      assert.strictEqual(isRunning, true, 'Should detect running process');

      // Cleanup
      proc.kill();
      fs.unlinkSync(testPIDPath);
    });
  });

  describe('Port Detection', () => {
    it('should detect port in use', async () => {
      const net = require('net');
      const server = net.createServer();

      await new Promise(resolve => server.listen(19999, resolve));

      const inUse = await ServiceManager.isServiceRunningOnPort(19999);
      assert.strictEqual(inUse, true, 'Should detect port in use');

      server.close();
    });

    it('should detect port not in use', async () => {
      const inUse = await ServiceManager.isServiceRunningOnPort(19998);
      assert.strictEqual(inUse, false, 'Should detect port not in use');
    });
  });

  describe('Module Exports', () => {
    it('should export all required functions', () => {
      assert.ok(typeof ServiceManager.startService === 'function');
      assert.ok(typeof ServiceManager.stopService === 'function');
      assert.ok(typeof ServiceManager.restartService === 'function');
      assert.ok(typeof ServiceManager.isServiceRunning === 'function');
      assert.ok(typeof ServiceManager.getServicePID === 'function');
      assert.ok(typeof ServiceManager.getAllServiceStatuses === 'function');
    });
  });
});
