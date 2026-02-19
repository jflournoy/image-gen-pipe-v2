/**
 * Model Coordinator
 * Manages GPU memory by coordinating model loading/unloading across local services.
 * Ensures only one heavy model is loaded at a time on a single GPU.
 */

const axios = require('axios');
const serviceManager = require('./service-manager');

/**
 * Get service URL dynamically from port file, falling back to env var / default.
 * Uses serviceManager.getServiceUrl() as the single canonical source.
 */
function getServiceUrl(service) {
  return serviceManager.getServiceUrl(service);
}

// Backward-compatible static accessor (reads dynamically on each access)
const SERVICE_URLS = new Proxy({}, {
  get(_, service) {
    return getServiceUrl(service);
  }
});

// Delay after unloads to allow GPU memory cleanup (CUDA memory release is async)
// 5000ms default provides buffer for VRAM deallocation when switching Flux (10GB) ↔ VLM (5GB)
const GPU_CLEANUP_DELAY_MS = parseInt(process.env.GPU_CLEANUP_DELAY_MS || '5000', 10);

// Health check timeout - be patient with model loading/busy services
// 30s default allows services time to respond even when busy with other requests
const HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.MODEL_HEALTH_CHECK_TIMEOUT_MS || '30000', 10);

/**
 * GPU Lock - ensures only one model operation runs at a time
 * Prevents race conditions where unload/load operations overlap
 */
let gpuLockQueue = [];
let gpuLockHeld = false;

/**
 * Acquire exclusive GPU lock for model operations
 * Returns a release function that must be called when done
 * @returns {Promise<Function>} Release function to call when operation is complete
 */
async function acquireGPULock() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (!gpuLockHeld) {
        gpuLockHeld = true;
        console.log('[ModelCoordinator] GPU lock acquired');
        resolve(() => releaseGPULock());
      } else {
        // Add to queue
        gpuLockQueue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

/**
 * Release the GPU lock, allowing next queued operation to proceed
 */
function releaseGPULock() {
  console.log('[ModelCoordinator] GPU lock released');
  gpuLockHeld = false;
  // Process next in queue if any
  if (gpuLockQueue.length > 0) {
    const next = gpuLockQueue.shift();
    next();
  }
}

/**
 * Execute an async operation while holding the GPU lock
 * Ensures no other GPU operations can start until this completes
 * @param {Function} operation - Async function to execute while holding lock
 * @returns {Promise<*>} Result of the operation
 */
async function withGPULock(operation) {
  const release = await acquireGPULock();
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Execute an operation that requires VLM, holding GPU lock for entire duration
 * Prepares GPU (unloads conflicting models), runs operation, then releases lock
 * Use this instead of prepareForVLM() + operation when you need the lock held during inference
 * @param {Function} operation - Async function to execute (e.g., VLM ranking)
 * @returns {Promise<*>} Result of the operation
 */
async function withVLMOperation(operation) {
  return withGPULock(async () => {
    console.log('[ModelCoordinator] Preparing for VLM operation (holding lock)...');
    // Unload conflicting models
    await Promise.all([
      unloadModel('flux'),
      unloadModel('llm')
    ]);
    await waitForGPUCleanup();
    // Execute VLM operation with lock still held
    return await operation();
  });
}

/**
 * Execute an operation that requires Flux (image gen), holding GPU lock for entire duration
 * @param {Function} operation - Async function to execute (e.g., image generation)
 * @returns {Promise<*>} Result of the operation
 */
async function withImageGenOperation(operation) {
  return withGPULock(async () => {
    console.log('[ModelCoordinator] Preparing for image gen operation (holding lock)...');
    // Unload conflicting models
    await Promise.all([
      unloadModel('llm'),
      unloadModel('vlm')
    ]);
    await waitForGPUCleanup();
    // Execute image gen operation with lock still held
    return await operation();
  });
}

/**
 * Execute an operation that requires LLM, holding GPU lock for entire duration
 * @param {Function} operation - Async function to execute (e.g., prompt refinement)
 * @returns {Promise<*>} Result of the operation
 */
async function withLLMOperation(operation) {
  return withGPULock(async () => {
    console.log('[ModelCoordinator] Preparing for LLM operation (holding lock)...');
    // Unload conflicting models
    await Promise.all([
      unloadModel('flux'),
      unloadModel('vlm')
    ]);
    await waitForGPUCleanup();
    // Execute LLM operation with lock still held
    return await operation();
  });
}

/**
 * Wait for GPU memory to be freed after unload
 * CUDA memory cleanup can be async even after unload HTTP returns 200
 */
async function waitForGPUCleanup() {
  if (GPU_CLEANUP_DELAY_MS > 0) {
    console.log(`[ModelCoordinator] Waiting ${GPU_CLEANUP_DELAY_MS}ms for GPU memory cleanup...`);
    await new Promise(resolve => setTimeout(resolve, GPU_CLEANUP_DELAY_MS));
  }
}

// Track which models are currently loaded
const modelState = {
  llm: false,
  flux: false,
  vision: false,
  vlm: false
};

// Track service intent - whether services SHOULD be running
// This allows detecting crashed services that need restart
const serviceIntent = {
  llm: { shouldBeRunning: false, lastHealthy: null },
  flux: { shouldBeRunning: false, lastHealthy: null },
  vision: { shouldBeRunning: false, lastHealthy: null },
  vlm: { shouldBeRunning: false, lastHealthy: null }
};

// Pluggable service restarter (defaults to no-op, can be injected)
let serviceRestarter = async () => ({ success: false, error: 'No restarter configured' });

/**
 * Mark a service's intended running state
 * @param {string} service - Service name
 * @param {boolean} shouldBeRunning - Whether the service should be running
 */
function markServiceIntent(service, shouldBeRunning) {
  if (serviceIntent[service]) {
    serviceIntent[service].shouldBeRunning = shouldBeRunning;
  }
}

/**
 * Get a service's intent state
 * @param {string} service - Service name
 * @returns {Object} Intent object with shouldBeRunning and lastHealthy
 */
function getServiceIntent(service) {
  return { ...serviceIntent[service] };
}

/**
 * Set the service restarter function (dependency injection)
 * @param {Function} restarter - Async function(serviceName) => { success, error? }
 */
function setServiceRestarter(restarter) {
  serviceRestarter = restarter;
}

/**
 * Check if a service is healthy via its /health endpoint
 * @param {string} service - Service name
 * @returns {Promise<Object>} Health status { healthy, shouldBeRunning, needsRestart }
 */
async function checkServiceHealth(service) {
  const intent = serviceIntent[service];
  const url = `${SERVICE_URLS[service]}/health`;

  try {
    await axios.get(url, { timeout: HEALTH_CHECK_TIMEOUT_MS });
    // Service is healthy - update lastHealthy timestamp
    if (intent) {
      intent.lastHealthy = Date.now();
    }
    return {
      healthy: true,
      shouldBeRunning: intent?.shouldBeRunning || false,
      needsRestart: false
    };
  } catch {
    // Service is not responding
    return {
      healthy: false,
      shouldBeRunning: intent?.shouldBeRunning || false,
      needsRestart: intent?.shouldBeRunning || false
    };
  }
}

/**
 * Ensure a service is healthy, restarting if needed
 * Respects STOP_LOCK - won't restart if lock exists (user manually stopped service)
 * @param {string} service - Service name
 * @returns {Promise<Object>} Result of health check or restart attempt
 */
async function ensureServiceHealth(service) {
  const health = await checkServiceHealth(service);

  if (health.needsRestart) {
    // Check for STOP_LOCK - if present, don't auto-restart
    const hasLock = await serviceManager.hasStopLock(service);
    if (hasLock) {
      console.log(`[ModelCoordinator] Service ${service} needs restart but STOP_LOCK exists - skipping restart`);
      return {
        ...health,
        needsRestart: false,
        blockedByStopLock: true
      };
    }

    console.log(`[ModelCoordinator] Service ${service} needs restart, attempting...`);
    return await serviceRestarter(service);
  }

  return health;
}

/**
 * Check and restart all services that need it
 * @returns {Promise<Object>} Map of service names to their results
 */
async function ensureAllServicesHealthy() {
  const results = {};

  for (const service of Object.keys(serviceIntent)) {
    results[service] = await ensureServiceHealth(service);
  }

  return results;
}

/**
 * Get health report for all services
 * @returns {Promise<Object>} Map of service names to health status
 */
async function getServiceHealthReport() {
  const report = {};

  for (const service of Object.keys(serviceIntent)) {
    report[service] = await checkServiceHealth(service);
  }

  return report;
}

/**
 * Create a service restarter function for injection into providers.
 * Uses the actual port from restart result for health polling (not hardcoded URLs).
 * @param {string} serviceName - Service to restart ('llm', 'vlm', 'flux', 'vision')
 * @returns {Function} Async restarter function that returns { success, port?, error? }
 */
function createServiceRestarter(serviceName) {
  return async () => {
    console.log(`[ModelCoordinator] Attempting to restart ${serviceName} service...`);

    try {
      const result = await serviceManager.restartService(serviceName);

      if (result.success) {
        console.log(`[ModelCoordinator] ${serviceName} service restarted successfully (PID: ${result.pid}, port: ${result.port})`);
        markServiceIntent(serviceName, true);

        // Poll health using the ACTUAL port from restart (not hardcoded URL)
        const healthUrl = `http://localhost:${result.port}/health`;
        const maxWaitTime = 60000; // 60 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          try {
            const health = await axios.get(healthUrl, { timeout: HEALTH_CHECK_TIMEOUT_MS });
            if (health.data.status === 'ok' || health.data.status === 'healthy') {
              console.log(`[ModelCoordinator] ${serviceName} service is healthy after restart`);
              return { success: true, port: result.port };
            }
          } catch {
            // Service not ready yet, wait and retry
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.warn(`[ModelCoordinator] ${serviceName} service started but health check timed out`);
        return { success: false, error: 'Service health check timeout' };
      } else {
        console.error(`[ModelCoordinator] Failed to restart ${serviceName} service: ${result.error}`);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error(`[ModelCoordinator] Exception during ${serviceName} service restart: ${error.message}`);
      return { success: false, error: error.message };
    }
  };
}

// Backward-compatible factory functions
function createLLMServiceRestarter() {
  return createServiceRestarter('llm');
}

function createVLMServiceRestarter() {
  return createServiceRestarter('vlm');
}

/**
 * Unload a model from a service
 * @param {string} service - 'llm', 'flux', or 'vision'
 * @returns {Promise<boolean>} True if successfully unloaded
 */
async function unloadModel(service) {
  try {
    const url = `${SERVICE_URLS[service]}/unload`;
    // Reduced timeout to 5 seconds - don't wait too long
    const response = await axios.post(url, {}, { timeout: 5000 });
    modelState[service] = false;
    console.log(`[ModelCoordinator] Unloaded ${service}: ${response.data.status}`);
    return true;
  } catch (error) {
    // Service might not be running or model already unloaded
    // This is non-critical - log and continue
    console.log(`[ModelCoordinator] Could not unload ${service}: ${error.message}`);
    modelState[service] = false;
    return false;
  }
}

/**
 * Load a model in a service
 * @param {string} service - 'llm', 'flux', or 'vision'
 * @returns {Promise<boolean>} True if successfully loaded
 */
async function loadModel(service) {
  try {
    const url = `${SERVICE_URLS[service]}/load`;
    const response = await axios.post(url, {}, { timeout: 120000 }); // 2 min for model loading
    modelState[service] = true;
    console.log(`[ModelCoordinator] Loaded ${service}: ${response.data.status}`);
    return true;
  } catch (error) {
    console.log(`[ModelCoordinator] Could not load ${service}: ${error.message}`);
    return false;
  }
}

/**
 * Prepare for LLM operations
 * Unloads Flux and VLM to free GPU memory for LLM
 * On 12GB GPU: LLM ~4GB, need to ensure no conflicts
 */
async function prepareForLLM() {
  const release = await acquireGPULock();
  try {
    console.log('[ModelCoordinator] Preparing for LLM operations...');
    // Unload Flux (heaviest) and VLM to free GPU memory
    await Promise.all([
      unloadModel('flux'),
      unloadModel('vlm')
    ]);
    // Wait for GPU memory to be freed (CUDA cleanup is async)
    await waitForGPUCleanup();
    // LLM will load on first request
  } finally {
    release();
  }
}

/**
 * Prepare for image generation
 * Unloads LLM and VLM to free GPU memory for Flux (~10GB)
 */
async function prepareForImageGen() {
  const release = await acquireGPULock();
  try {
    console.log('[ModelCoordinator] Preparing for image generation...');
    // Unload LLM and VLM to free GPU memory - Flux needs ~10GB
    await Promise.all([
      unloadModel('llm'),
      unloadModel('vlm')
    ]);
    // Wait for GPU memory to be freed (CUDA cleanup is async)
    await waitForGPUCleanup();
    // Flux will load on first request
  } finally {
    release();
  }
}

/**
 * Prepare for vision analysis
 * Vision model is small, can coexist with others
 */
async function prepareForVision() {
  console.log('[ModelCoordinator] Preparing for vision analysis...');
  // Vision model is small (~1GB), usually doesn't need coordination
  // But if we're very tight on memory, unload flux
  // await unloadModel('flux');
}

/**
 * Prepare for VLM pairwise comparison
 * VLM is ~5-7GB, needs Flux and LLM unloaded on 12GB GPU
 */
async function prepareForVLM() {
  const release = await acquireGPULock();
  try {
    console.log('[ModelCoordinator] Preparing for VLM comparison...');
    // VLM is ~5-7GB, requires both Flux and LLM unloaded on 12GB GPU
    await Promise.all([
      unloadModel('flux'),
      unloadModel('llm')
    ]);
    // Wait for GPU memory to be freed (CUDA cleanup is async)
    await waitForGPUCleanup();
    // VLM will load on first comparison request
  } finally {
    release();
  }
}

/**
 * Cleanup all models
 */
async function cleanupAll() {
  console.log('[ModelCoordinator] Cleaning up all models...');
  await Promise.all([
    unloadModel('llm'),
    unloadModel('flux'),
    unloadModel('vision'),
    unloadModel('vlm')
  ]);
}

/**
 * Get current model states
 */
function getModelStates() {
  return { ...modelState };
}

module.exports = {
  unloadModel,
  loadModel,
  prepareForLLM,
  prepareForImageGen,
  prepareForVision,
  prepareForVLM,
  cleanupAll,
  getModelStates,
  acquireGPULock,
  releaseGPULock,
  withGPULock,
  withVLMOperation,
  withImageGenOperation,
  withLLMOperation,
  SERVICE_URLS,
  getServiceUrl,
  // Service health tracking and auto-restart
  markServiceIntent,
  getServiceIntent,
  setServiceRestarter,
  checkServiceHealth,
  ensureServiceHealth,
  ensureAllServicesHealthy,
  getServiceHealthReport,
  createServiceRestarter,
  createVLMServiceRestarter,
  createLLMServiceRestarter
};
