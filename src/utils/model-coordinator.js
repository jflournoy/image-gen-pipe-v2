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
 * Unloads Flux (heavy) to free GPU memory for LLM
 */
async function prepareForLLM() {
  console.log('[ModelCoordinator] Preparing for LLM operations...');
  // Unload Flux to free GPU memory (it's the heaviest)
  await unloadModel('flux');
  // LLM will load on first request
}

/**
 * Prepare for image generation
 * Unloads LLM to free GPU memory for Flux
 */
async function prepareForImageGen() {
  console.log('[ModelCoordinator] Preparing for image generation...');
  // Unload LLM to free GPU memory
  await unloadModel('llm');
  // Flux will load on first request
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
 * VLM is ~5-7GB, needs Flux unloaded
 */
async function prepareForVLM() {
  console.log('[ModelCoordinator] Preparing for VLM comparison...');
  // VLM is ~5-7GB, requires Flux to be unloaded
  await unloadModel('flux');
  // LLM can coexist with VLM if using different models
  // await unloadModel('llm');
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
  SERVICE_URLS
};
