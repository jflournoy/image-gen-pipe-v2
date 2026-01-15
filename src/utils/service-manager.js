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

// Set up logging directory
const LOG_DIR = '/tmp/beam-search-services';
const ensureLogDir = () => {
  try {
    fsSync.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    // Ignore if already exists
  }
};

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
 * @param {string} options.loraPath - Custom LoRA path for Flux service
 * @param {string} options.loraScale - Custom LoRA scale for Flux service
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
    console.error(
      `[ServiceManager] Port ${serviceConfig.port} already in use for ${serviceName}. ` +
      `This may be from a previous session. Try restarting Node.js server or kill the process manually.`
    );
    return {
      success: false,
      error: `Port ${serviceConfig.port} is already in use (may be from previous session)`,
    };
  }

  // Build environment variables
  const serviceEnv = { ...process.env, ...serviceConfig.env };

  // Add HF_TOKEN if provided (for Flux service)
  if (options.hfToken) {
    serviceEnv.HF_TOKEN = options.hfToken;
    console.log(`[ServiceManager] Using provided HF token for ${serviceName}`);
  }

  // Override LoRA settings if provided (allows dynamic configuration)
  if (serviceName === 'flux') {
    if (options.loraPath !== undefined) {
      serviceEnv.FLUX_LORA_PATH = options.loraPath;
      console.log(`[ServiceManager] Using custom LoRA path: ${options.loraPath}`);
    }
    if (options.loraScale !== undefined) {
      serviceEnv.FLUX_LORA_SCALE = options.loraScale;
      console.log(`[ServiceManager] Using custom LoRA scale: ${options.loraScale}`);
    }
  }

  // Ensure log directory exists
  ensureLogDir();

  // Set up log file for this service
  const logFile = path.join(LOG_DIR, `${serviceName}.log`);
  const logStream = fsSync.createWriteStream(logFile, { flags: 'a' });

  // Add timestamp header to log
  logStream.write(`\n\n${'='.repeat(80)}\n`);
  logStream.write(`[${new Date().toISOString()}] Starting ${serviceName} service (PID will follow)\n`);
  logStream.write(`${'='.repeat(80)}\n`);

  // Spawn the service using uv to ensure dependencies are available
  let proc;
  try {
    proc = spawn('uv', ['run', 'python', serviceConfig.script], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],  // Capture stdout and stderr
      env: serviceEnv,
      // uv will use the project's synced virtual environment
    });

    // Pipe stdout and stderr to log file
    if (proc.stdout) {
      proc.stdout.pipe(logStream);
    }
    if (proc.stderr) {
      proc.stderr.pipe(logStream);
    }

    // Unref so parent can exit independently
    proc.unref();
  } catch (error) {
    console.error(`[ServiceManager] Failed to spawn ${serviceName} process:`, error);
    logStream.write(`\n[ERROR] Failed to spawn: ${error.message}\n`);
    logStream.end();
    return {
      success: false,
      error: `Failed to spawn service: ${error.message}`,
    };
  }

  // Write PID file immediately
  // The health polling endpoint will verify the service is actually running
  await writePIDFile(serviceName, proc.pid);

  logStream.write(`\nStarted with PID: ${proc.pid}\n`);
  logStream.write(`Log file: ${logFile}\n`);

  console.log(`[ServiceManager] Started ${serviceName} service (PID: ${proc.pid})`);
  console.log(`[ServiceManager] Service logs: ${logFile}`);

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
