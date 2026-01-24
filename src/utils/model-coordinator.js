/**
 * Model Coordinator
 * Manages GPU memory by coordinating model loading/unloading across local services.
 * Ensures only one heavy model is loaded at a time on a single GPU.
 */

const axios = require('axios');

// Service endpoints
const SERVICE_URLS = {
  llm: process.env.LOCAL_LLM_URL || 'http://localhost:8003',
  flux: process.env.FLUX_URL || 'http://localhost:8001',
  vision: process.env.LOCAL_VISION_URL || 'http://localhost:8002',
  vlm: process.env.LOCAL_VLM_URL || 'http://localhost:8004'
};

// Delay after unloads to allow GPU memory cleanup (CUDA memory release is async)
const GPU_CLEANUP_DELAY_MS = parseInt(process.env.GPU_CLEANUP_DELAY_MS || '2000', 10);

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
  SERVICE_URLS
};
