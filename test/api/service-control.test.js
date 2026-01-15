/**
 * @file Service Control API Tests (TDD RED)
 * Tests for starting, stopping, and restarting Python services
 * Supports cross-session service detection
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const API_BASE = 'http://localhost:3000';

/**
 * Helper: Make HTTP request
 */
function makeRequest(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(body))
      } : {}
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch (err) {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Helper: Check if port is in use
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = require('net').createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * Helper: Wait for condition
 */
async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return false;
}

describe('🔴 RED: Service Control API', () => {
  describe('Service Manager Utility', () => {
    it('should have ServiceManager class in utils', () => {
      const serviceManagerPath = path.join(__dirname, '../../src/utils/service-manager.js');
      assert.ok(
        fs.existsSync(serviceManagerPath),
        'ServiceManager utility should exist'
      );
    });

    it('should export startService function', () => {
      const serviceManagerPath = path.join(__dirname, '../../src/utils/service-manager.js');
      const ServiceManager = require(serviceManagerPath);

      assert.ok(
        typeof ServiceManager.startService === 'function',
        'Should export startService function'
      );
    });

    it('should export stopService function', () => {
      const serviceManagerPath = path.join(__dirname, '../../src/utils/service-manager.js');
      const ServiceManager = require(serviceManagerPath);

      assert.ok(
        typeof ServiceManager.stopService === 'function',
        'Should export stopService function'
      );
    });

    it('should export isServiceRunning function', () => {
      const serviceManagerPath = path.join(__dirname, '../../src/utils/service-manager.js');
      const ServiceManager = require(serviceManagerPath);

      assert.ok(
        typeof ServiceManager.isServiceRunning === 'function',
        'Should export isServiceRunning function'
      );
    });

    it('should export getServicePID function', () => {
      const serviceManagerPath = path.join(__dirname, '../../src/utils/service-manager.js');
      const ServiceManager = require(serviceManagerPath);

      assert.ok(
        typeof ServiceManager.getServicePID === 'function',
        'Should export getServicePID function'
      );
    });
  });

  describe('PID File Management', () => {
    it('should write PID file when starting service', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');
      const pidPath = path.join('/tmp', 'test_service.pid');

      // Clean up before test
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);

      // Start a dummy service
      const proc = spawn('sleep', ['30']);
      await ServiceManager.writePIDFile('test', proc.pid);

      assert.ok(fs.existsSync(pidPath), 'PID file should exist');

      // Cleanup
      proc.kill();
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    });

    it('should read PID from file', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');
      const pidPath = path.join('/tmp', 'test_service.pid');

      // Write test PID
      const testPID = 12345;
      fs.writeFileSync(pidPath, testPID.toString());

      const pid = await ServiceManager.readPIDFile('test');
      assert.strictEqual(pid, testPID, 'Should read correct PID');

      // Cleanup
      fs.unlinkSync(pidPath);
    });

    it('should delete PID file when stopping service', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');
      const pidPath = path.join('/tmp', 'test_service.pid');

      // Create test PID file
      fs.writeFileSync(pidPath, '12345');

      await ServiceManager.deletePIDFile('test');
      assert.ok(!fs.existsSync(pidPath), 'PID file should be deleted');
    });
  });

  describe('Process Detection Across Sessions', () => {
    it('should detect service by PID file', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Start a background process
      const proc = spawn('sleep', ['30']);
      const pidPath = path.join('/tmp', 'test_service.pid');
      fs.writeFileSync(pidPath, proc.pid.toString());

      const isRunning = await ServiceManager.isServiceRunning('test');
      assert.ok(isRunning, 'Should detect running service from PID file');

      // Cleanup
      proc.kill();
      fs.unlinkSync(pidPath);
    });

    it('should detect service by port', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Create a dummy server on port
      const server = require('net').createServer();
      await new Promise(resolve => server.listen(9999, resolve));

      const isRunning = await ServiceManager.isServiceRunningOnPort(9999);
      assert.ok(isRunning, 'Should detect service by port');

      // Cleanup
      server.close();
    });

    it('should handle stale PID files', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');
      const pidPath = path.join('/tmp', 'test_service.pid');

      // Write PID that doesn't exist
      fs.writeFileSync(pidPath, '99999');

      const isRunning = await ServiceManager.isServiceRunning('test');
      assert.ok(!isRunning, 'Should detect stale PID');
      assert.ok(!fs.existsSync(pidPath), 'Should clean up stale PID file');
    });
  });

  describe('Service Start/Stop/Restart', () => {
    it('should start service and track PID', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Start flux service
      const result = await ServiceManager.startService('flux');

      assert.ok(result.success, 'Should start successfully');
      assert.ok(result.pid, 'Should return PID');

      // Verify PID file exists
      const pidPath = path.join('/tmp', 'flux_service.pid');
      assert.ok(fs.existsSync(pidPath), 'Should create PID file');

      // Cleanup
      await ServiceManager.stopService('flux');
    });

    it('should stop service by PID', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Start and then stop
      await ServiceManager.startService('flux');
      const result = await ServiceManager.stopService('flux');

      assert.ok(result.success, 'Should stop successfully');

      // Verify service is stopped
      const isRunning = await ServiceManager.isServiceRunning('flux');
      assert.ok(!isRunning, 'Service should be stopped');
    });

    it('should stop service started in different session', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Manually spawn a process (simulating different session)
      const proc = spawn('python', ['-m', 'http.server', '8888']);
      const pidPath = path.join('/tmp', 'test_service.pid');
      fs.writeFileSync(pidPath, proc.pid.toString());

      // Stop via service manager
      const result = await ServiceManager.stopService('test');
      assert.ok(result.success, 'Should stop cross-session service');

      // Verify stopped
      await waitFor(async () => {
        try {
          process.kill(proc.pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    });

    it('should use graceful shutdown (SIGTERM then SIGKILL)', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Start service
      const proc = spawn('sleep', ['30']);
      const pidPath = path.join('/tmp', 'test_service.pid');
      fs.writeFileSync(pidPath, proc.pid.toString());

      let sigTermSent = false;
      let sigKillSent = false;

      // Mock kill to track signals
      const originalKill = process.kill;
      process.kill = (pid, signal) => {
        if (signal === 'SIGTERM') sigTermSent = true;
        if (signal === 'SIGKILL') sigKillSent = true;
        return originalKill(pid, signal);
      };

      await ServiceManager.stopService('test', { gracefulTimeout: 100 });

      process.kill = originalKill;

      assert.ok(sigTermSent, 'Should send SIGTERM first');
      // SIGKILL may or may not be sent depending on process response
    });

    it('should restart service (stop + start)', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Start initial service
      const startResult = await ServiceManager.startService('flux');
      const initialPID = startResult.pid;

      // Restart
      const restartResult = await ServiceManager.restartService('flux');
      assert.ok(restartResult.success, 'Should restart successfully');

      // Verify new PID
      const newPID = await ServiceManager.getServicePID('flux');
      assert.notStrictEqual(newPID, initialPID, 'Should have new PID');

      // Cleanup
      await ServiceManager.stopService('flux');
    });
  });

  describe('POST /api/services/:name/start', () => {
    it('should have start endpoint', async () => {
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/start`);

      // Should not be 404
      assert.notStrictEqual(response.status, 404, 'Endpoint should exist');
    });

    it('should start service and return success', async () => {
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/start`);

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(response.data.success, 'Should indicate success');
      assert.ok(response.data.pid, 'Should return PID');

      // Cleanup
      await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);
    });

    it('should return error if service already running', async () => {
      // Start service
      await makeRequest('POST', `${API_BASE}/api/services/flux/start`);

      // Try to start again
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/start`);

      assert.strictEqual(response.status, 409, 'Should return 409 Conflict');
      assert.ok(response.data.error, 'Should have error message');

      // Cleanup
      await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);
    });

    it('should validate service name', async () => {
      const response = await makeRequest('POST', `${API_BASE}/api/services/invalid-service/start`);

      assert.strictEqual(response.status, 400, 'Should return 400 for invalid service');
      assert.ok(response.data.error, 'Should have error message');
    });

    it('should support all service types (llm, flux, vision, vlm)', async () => {
      const services = ['llm', 'flux', 'vision', 'vlm'];

      for (const service of services) {
        const response = await makeRequest('POST', `${API_BASE}/api/services/${service}/start`);

        // Should not be 400 (invalid service)
        assert.notStrictEqual(
          response.status,
          400,
          `${service} should be a valid service name`
        );

        // Cleanup
        await makeRequest('POST', `${API_BASE}/api/services/${service}/stop`);
      }
    });
  });

  describe('POST /api/services/:name/stop', () => {
    it('should have stop endpoint', async () => {
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);

      // Should not be 404
      assert.notStrictEqual(response.status, 404, 'Endpoint should exist');
    });

    it('should stop running service', async () => {
      // Start service first
      await makeRequest('POST', `${API_BASE}/api/services/flux/start`);

      // Stop it
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(response.data.success, 'Should indicate success');
    });

    it('should handle stopping already stopped service gracefully', async () => {
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);

      // Should not error
      assert.ok([200, 404].includes(response.status), 'Should handle gracefully');
    });

    it('should stop service started in different session', async () => {
      const ServiceManager = require('../../src/utils/service-manager.js');

      // Manually start service (simulate different session)
      const proc = spawn('sleep', ['30']);
      const pidPath = path.join('/tmp', 'flux_service.pid');
      fs.writeFileSync(pidPath, proc.pid.toString());

      // Stop via API
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);

      assert.strictEqual(response.status, 200, 'Should stop cross-session service');

      // Verify stopped
      const stopped = await waitFor(async () => {
        try {
          process.kill(proc.pid, 0);
          return false;
        } catch {
          return true;
        }
      });

      assert.ok(stopped, 'Service should be stopped');
    });
  });

  describe('POST /api/services/:name/restart', () => {
    it('should have restart endpoint', async () => {
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/restart`);

      // Should not be 404
      assert.notStrictEqual(response.status, 404, 'Endpoint should exist');
    });

    it('should restart service with new PID', async () => {
      // Start service
      const startResponse = await makeRequest('POST', `${API_BASE}/api/services/flux/start`);
      const originalPID = startResponse.data.pid;

      // Restart
      const restartResponse = await makeRequest('POST', `${API_BASE}/api/services/flux/restart`);

      assert.strictEqual(restartResponse.status, 200, 'Should return 200');
      assert.ok(restartResponse.data.success, 'Should indicate success');
      assert.ok(restartResponse.data.pid, 'Should return new PID');
      assert.notStrictEqual(restartResponse.data.pid, originalPID, 'Should have new PID');

      // Cleanup
      await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);
    });

    it('should work even if service not running', async () => {
      // Stop to ensure not running
      await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);

      // Restart
      const response = await makeRequest('POST', `${API_BASE}/api/services/flux/restart`);

      assert.strictEqual(response.status, 200, 'Should start if not running');
      assert.ok(response.data.success, 'Should indicate success');

      // Cleanup
      await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);
    });
  });

  describe('GET /api/services/status', () => {
    it('should return status for all services', async () => {
      const response = await makeRequest('GET', `${API_BASE}/api/services/status`);

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(response.data.llm, 'Should include LLM status');
      assert.ok(response.data.flux, 'Should include Flux status');
      assert.ok(response.data.vision, 'Should include Vision status');
      assert.ok(response.data.vlm, 'Should include VLM status');
    });

    it('should indicate if service is running', async () => {
      // Start flux
      await makeRequest('POST', `${API_BASE}/api/services/flux/start`);

      const response = await makeRequest('GET', `${API_BASE}/api/services/status`);

      assert.ok(response.data.flux.running, 'Should show Flux as running');
      assert.ok(response.data.flux.pid, 'Should include PID');

      // Cleanup
      await makeRequest('POST', `${API_BASE}/api/services/flux/stop`);
    });
  });

  describe('Service Routes Integration', () => {
    it('should have service routes registered in server', () => {
      const serverPath = path.join(__dirname, '../../src/api/server.js');
      const content = fs.readFileSync(serverPath, 'utf8');

      assert.ok(
        content.includes('service-routes') || content.includes('services'),
        'Should register service routes'
      );
    });

    it('should have service-routes file', () => {
      const routesPath = path.join(__dirname, '../../src/api/service-routes.js');

      assert.ok(
        fs.existsSync(routesPath),
        'service-routes.js should exist'
      );
    });
  });
});
