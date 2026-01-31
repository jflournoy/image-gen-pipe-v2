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
  } catch {
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

/**
 * Required encoder paths for local Flux models
 * These must all be provided when using a local model to prevent dimension mismatches
 */
const FLUX_REQUIRED_ENCODERS = [
  { key: 'textEncoderPath', name: 'CLIP-L encoder', envVar: 'FLUX_TEXT_ENCODER_PATH' },
  { key: 'textEncoder2Path', name: 'T5-XXL encoder', envVar: 'FLUX_TEXT_ENCODER_2_PATH' },
  { key: 'vaePath', name: 'VAE encoder', envVar: 'FLUX_VAE_PATH' }
];

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
  } catch {
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
  } catch {
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
  } catch {
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
 * Find an available port starting from primary, trying up to maxAttempts
 */
async function findAvailablePort(primaryPort, maxAttempts = 10) {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = primaryPort + offset;
    const inUse = await isServiceRunningOnPort(port);
    if (!inUse) {
      if (offset > 0) {
        console.log(`[ServiceManager] Primary port ${primaryPort} in use, using ${port}`);
      }
      return port;
    }
  }
  return null;
}

// Port file functions for tracking actual port used
function getPortFilePath(serviceName) {
  return path.join('/tmp', `${serviceName}_service.port`);
}

async function writePortFile(serviceName, port) {
  const portPath = getPortFilePath(serviceName);
  await fs.writeFile(portPath, port.toString());
  console.log(`[ServiceManager] Wrote port ${port} to ${portPath}`);
}

async function readPortFile(serviceName) {
  try {
    const content = await fs.readFile(getPortFilePath(serviceName), 'utf8');
    return parseInt(content.trim(), 10);
  } catch {
    return null;
  }
}

async function deletePortFile(serviceName) {
  try {
    await fs.unlink(getPortFilePath(serviceName));
    console.log(`[ServiceManager] Deleted port file for ${serviceName}`);
  } catch {
    // Ignore if file doesn't exist
  }
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
 * Validate Flux encoder paths are configured for local models
 * @param {Object} options - Service start options
 * @param {string} options.modelPath - Custom Flux model path (if using local model)
 * @param {string} options.textEncoderPath - CLIP-L encoder path
 * @param {string} options.textEncoder2Path - T5-XXL encoder path
 * @param {string} options.vaePath - VAE encoder path
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateFluxEncoderPaths(options) {
  const { modelPath } = options;

  // If no model path, using HuggingFace - no validation needed
  if (!modelPath) {
    return { valid: true };
  }

  // Local model detected - require all encoder paths
  const missingPaths = FLUX_REQUIRED_ENCODERS
    .filter(encoder => !options[encoder.key])
    .map(encoder => encoder.name);

  if (missingPaths.length > 0) {
    return {
      valid: false,
      error: `Local Flux model requires encoder paths. Missing: ${missingPaths.join(', ')}`
    };
  }

  // Validate encoder files exist
  const projectRoot = path.join(__dirname, '../../');

  for (const encoder of FLUX_REQUIRED_ENCODERS) {
    const encoderPath = options[encoder.key];
    const fullPath = path.resolve(projectRoot, encoderPath);

    if (!fsSync.existsSync(fullPath)) {
      return {
        valid: false,
        error: `${encoder.name} file does not exist: ${fullPath}`
      };
    }
  }

  return { valid: true };
}

/**
 * Start a service
 * @param {string} serviceName - Name of the service to start
 * @param {Object} options - Optional configuration
 * @param {string} options.hfToken - HuggingFace token for Flux service
 * @param {string} options.modelPath - Custom Flux model path (local .safetensors file)
 * @param {string} options.loraPath - Custom LoRA path for Flux service
 * @param {string} options.loraScale - Custom LoRA scale for Flux service
 * @param {string} options.textEncoderPath - CLIP-L encoder path for local models
 * @param {string} options.textEncoder2Path - T5-XXL encoder path for local models
 * @param {string} options.vaePath - VAE encoder path for local models
 */
async function startService(serviceName, options = {}) {
  const serviceConfig = SERVICES[serviceName];

  if (!serviceConfig) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  // Validate Flux encoder paths if starting Flux service with local model
  if (serviceName === 'flux') {
    console.log('[ServiceManager] Validating Flux encoder configuration...');
    console.log('[ServiceManager] Model path:', options.modelPath || '(using HuggingFace)');
    console.log('[ServiceManager] CLIP-L path:', options.textEncoderPath || '(not set)');
    console.log('[ServiceManager] T5-XXL path:', options.textEncoder2Path || '(not set)');
    console.log('[ServiceManager] VAE path:', options.vaePath || '(not set)');

    const validation = validateFluxEncoderPaths(options);
    if (!validation.valid) {
      console.error(`[ServiceManager] ❌ Validation failed: ${validation.error}`);
      return {
        success: false,
        error: validation.error
      };
    }
    console.log('[ServiceManager] ✅ Encoder configuration valid');
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

  // Find available port with fallback
  const primaryPort = serviceConfig.port;
  const actualPort = await findAvailablePort(primaryPort);

  if (actualPort === null) {
    console.error(
      `[ServiceManager] No available port found for ${serviceName}. ` +
      `Tried ports ${primaryPort}-${primaryPort + 9}`
    );
    return {
      success: false,
      error: `No available port in range ${primaryPort}-${primaryPort + 9}`,
    };
  }

  // Build environment variables
  const serviceEnv = { ...process.env, ...serviceConfig.env };

  // Update environment variable with actual port
  const portEnvKey = Object.keys(serviceConfig.env).find(k => k.includes('PORT'));
  if (portEnvKey) {
    serviceEnv[portEnvKey] = actualPort.toString();
  }

  // Add HF_TOKEN if provided (for Flux service)
  if (options.hfToken) {
    serviceEnv.HF_TOKEN = options.hfToken;
    console.log(`[ServiceManager] Using provided HF token for ${serviceName}`);
  }

  // Override Flux model path, LoRA settings, and encoder paths if provided (allows dynamic configuration)
  if (serviceName === 'flux') {
    const projectRoot = path.join(__dirname, '../../');

    if (options.modelPath !== undefined) {
      const modelPath = path.resolve(projectRoot, options.modelPath);
      serviceEnv.FLUX_MODEL_PATH = modelPath;
      console.log(`[ServiceManager] Using custom Flux model path: ${modelPath}`);
    }
    if (options.loraPath !== undefined) {
      const loraPath = path.resolve(projectRoot, options.loraPath);
      serviceEnv.FLUX_LORA_PATH = loraPath;
      console.log(`[ServiceManager] Using custom LoRA path: ${loraPath}`);
    }
    if (options.loraScale !== undefined) {
      serviceEnv.FLUX_LORA_SCALE = options.loraScale;
      console.log(`[ServiceManager] Using custom LoRA scale: ${options.loraScale}`);
    }
    // Support for local encoder paths (for custom Flux models like CustomModel)
    // Convert relative paths to absolute paths so service can find them regardless of cwd
    if (options.textEncoderPath !== undefined) {
      const encoderPath = path.resolve(projectRoot, options.textEncoderPath);
      serviceEnv.FLUX_TEXT_ENCODER_PATH = encoderPath;
      console.log(`[ServiceManager] Using custom CLIP-L encoder path: ${encoderPath}`);
    }
    if (options.textEncoder2Path !== undefined) {
      const encoderPath = path.resolve(projectRoot, options.textEncoder2Path);
      serviceEnv.FLUX_TEXT_ENCODER_2_PATH = encoderPath;
      console.log(`[ServiceManager] Using custom T5-XXL encoder path: ${encoderPath}`);
    }
    if (options.vaePath !== undefined) {
      const encoderPath = path.resolve(projectRoot, options.vaePath);
      serviceEnv.FLUX_VAE_PATH = encoderPath;
      console.log(`[ServiceManager] Using custom VAE encoder path: ${encoderPath}`);
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
      cwd: path.join(__dirname, '../../'),  // Project root - required for uv to find workspace
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

  // Write port file to track actual port used
  await writePortFile(serviceName, actualPort);

  logStream.write(`\nStarted with PID: ${proc.pid}\n`);
  logStream.write(`Log file: ${logFile}\n`);

  console.log(`[ServiceManager] Started ${serviceName} service (PID: ${proc.pid})`);
  console.log(`[ServiceManager] Service logs: ${logFile}`);

  return {
    success: true,
    pid: proc.pid,
    port: actualPort,
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
        await deletePortFile(serviceName);
        return { success: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Still running - force kill
    console.log(`[ServiceManager] ${serviceName} didn't stop gracefully, sending SIGKILL`);
    process.kill(pid, 'SIGKILL');

    await deletePIDFile(serviceName);
    await deletePortFile(serviceName);
    return { success: true };
  } catch (error) {
    // Process might have already died
    if (error.code === 'ESRCH') {
      await deletePIDFile(serviceName);
      await deletePortFile(serviceName);
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
    const actualPort = running ? await readPortFile(serviceName) : null;

    statuses[serviceName] = {
      running,
      pid,
      port: actualPort || SERVICES[serviceName].port,
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
  validateFluxEncoderPaths,
  findAvailablePort,
  getPortFilePath,
  writePortFile,
  readPortFile,
  deletePortFile,
};
