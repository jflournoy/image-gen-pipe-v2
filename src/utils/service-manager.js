/**
 * @file Service Manager Utility
 * Manages Python service lifecycle (start, stop, restart)
 * Supports cross-session service detection via PID files and port checking
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const net = require('net');

/**
 * Service configuration
 */
const SERVICES = {
  llm: {
    script: path.join(__dirname, '../../services/llm_service.py'),
    port: 8003,
    env: { LLM_PORT: '8003' },
  },
  flux: {
    script: path.join(__dirname, '../../services/flux_service.py'),
    port: 8001,
    env: {
      FLUX_PORT: '8001',
      FLUX_LORA_PATH: process.env.FLUX_LORA_PATH || '',
      FLUX_LORA_SCALE: process.env.FLUX_LORA_SCALE || '1.0',
    },
  },
  vision: {
    script: path.join(__dirname, '../../services/vision_service.py'),
    port: 8002,
    env: { LOCAL_VISION_PORT: '8002' },
  },
  vlm: {
    script: path.join(__dirname, '../../services/vlm_service.py'),
    port: 8004,
    env: { VLM_PORT: '8004' },
  },
};

const PID_DIR = '/tmp';

/**
 * Get PID file path for a service
 */
function getPIDFilePath(serviceName) {
  return path.join(PID_DIR, `${serviceName}_service.pid`);
}

/**
 * Write PID to file
 */
async function writePIDFile(serviceName, pid) {
  const pidPath = getPIDFilePath(serviceName);
  await fs.writeFile(pidPath, pid.toString());
  console.log(`[ServiceManager] Wrote PID ${pid} to ${pidPath}`);
}

/**
 * Read PID from file
 */
async function readPIDFile(serviceName) {
  const pidPath = getPIDFilePath(serviceName);
  try {
    const content = await fs.readFile(pidPath, 'utf8');
    return parseInt(content.trim(), 10);
  } catch (error) {
    return null;
  }
}

/**
 * Delete PID file
 */
async function deletePIDFile(serviceName) {
  const pidPath = getPIDFilePath(serviceName);
  try {
    await fs.unlink(pidPath);
    console.log(`[ServiceManager] Deleted PID file ${pidPath}`);
  } catch (error) {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if a process is running by PID
 */
function isProcessRunning(pid) {
  try {
    // signal 0 doesn't kill, just checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if a port is in use
 */
function isServiceRunningOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(false);
    });

    server.listen(port);
  });
}

/**
 * Check if service is running (via PID file and process check)
 */
async function isServiceRunning(serviceName) {
  const pid = await readPIDFile(serviceName);

  if (!pid) {
    return false;
  }

  // Check if process actually exists
  if (!isProcessRunning(pid)) {
    // Stale PID file - clean it up
    console.log(`[ServiceManager] Stale PID file for ${serviceName}, cleaning up`);
    await deletePIDFile(serviceName);
    return false;
  }

  return true;
}

/**
 * Get service PID
 */
async function getServicePID(serviceName) {
  const pid = await readPIDFile(serviceName);

  if (!pid) {
    return null;
  }

  // Verify process is actually running
  if (!isProcessRunning(pid)) {
    await deletePIDFile(serviceName);
    return null;
  }

  return pid;
}

/**
 * Start a service
 * @param {string} serviceName - Name of the service to start
 * @param {Object} options - Optional configuration
 * @param {string} options.hfToken - HuggingFace token for Flux service
 */
async function startService(serviceName, options = {}) {
  const serviceConfig = SERVICES[serviceName];

  if (!serviceConfig) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  // Check if already running
  const running = await isServiceRunning(serviceName);
  if (running) {
    const pid = await getServicePID(serviceName);
    return {
      success: false,
      error: `Service ${serviceName} is already running (PID: ${pid})`,
      pid,
    };
  }

  // Check if port is in use (might be from different session)
  const portInUse = await isServiceRunningOnPort(serviceConfig.port);
  if (portInUse) {
    console.log(
      `[ServiceManager] Port ${serviceConfig.port} already in use for ${serviceName}`
    );
    return {
      success: false,
      error: `Port ${serviceConfig.port} is already in use`,
    };
  }

  // Build environment variables
  const serviceEnv = { ...process.env, ...serviceConfig.env };

  // Add HF_TOKEN if provided (for Flux service)
  if (options.hfToken) {
    serviceEnv.HF_TOKEN = options.hfToken;
    console.log(`[ServiceManager] Using provided HF token for ${serviceName}`);
  }

  // Spawn the service using uv to ensure dependencies are available
  const proc = spawn('uv', ['run', '--no-project', 'python', serviceConfig.script], {
    detached: true,
    stdio: 'ignore',
    env: serviceEnv,
  });

  // Unref so parent can exit independently
  proc.unref();

  // Write PID file
  await writePIDFile(serviceName, proc.pid);

  console.log(`[ServiceManager] Started ${serviceName} service (PID: ${proc.pid})`);

  return {
    success: true,
    pid: proc.pid,
    port: serviceConfig.port,
  };
}

/**
 * Stop a service
 */
async function stopService(serviceName, options = {}) {
  const { gracefulTimeout = 5000 } = options;

  const pid = await getServicePID(serviceName);

  if (!pid) {
    console.log(`[ServiceManager] Service ${serviceName} is not running`);
    await deletePIDFile(serviceName); // Clean up any stale files
    return {
      success: true,
      message: 'Service was not running',
    };
  }

  console.log(`[ServiceManager] Stopping ${serviceName} service (PID: ${pid})`);

  try {
    // Try graceful shutdown first (SIGTERM)
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit
    const startTime = Date.now();
    while (Date.now() - startTime < gracefulTimeout) {
      if (!isProcessRunning(pid)) {
        console.log(`[ServiceManager] ${serviceName} stopped gracefully`);
        await deletePIDFile(serviceName);
        return { success: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Still running - force kill
    console.log(`[ServiceManager] ${serviceName} didn't stop gracefully, sending SIGKILL`);
    process.kill(pid, 'SIGKILL');

    await deletePIDFile(serviceName);
    return { success: true };
  } catch (error) {
    // Process might have already died
    if (error.code === 'ESRCH') {
      await deletePIDFile(serviceName);
      return { success: true };
    }

    console.error(`[ServiceManager] Error stopping ${serviceName}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Restart a service
 */
async function restartService(serviceName) {
  console.log(`[ServiceManager] Restarting ${serviceName} service`);

  // Stop the service
  await stopService(serviceName);

  // Wait a moment for cleanup
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Start the service
  return await startService(serviceName);
}

/**
 * Get status of all services
 */
async function getAllServiceStatuses() {
  const statuses = {};

  for (const serviceName of Object.keys(SERVICES)) {
    const running = await isServiceRunning(serviceName);
    const pid = running ? await getServicePID(serviceName) : null;

    statuses[serviceName] = {
      running,
      pid,
      port: SERVICES[serviceName].port,
    };
  }

  return statuses;
}

module.exports = {
  startService,
  stopService,
  restartService,
  isServiceRunning,
  isServiceRunningOnPort,
  getServicePID,
  writePIDFile,
  readPIDFile,
  deletePIDFile,
  getAllServiceStatuses,
};
