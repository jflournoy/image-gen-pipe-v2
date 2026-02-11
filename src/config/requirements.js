/**
 * Settings Requirements Lookup
 *
 * Central source of truth for what's needed given current settings.
 * Pure functions - no side effects, easy to test.
 */

/**
 * Get all requirements for the given settings
 * @param {Object} settings - Current settings object
 * @param {string} settings.llm - LLM provider: 'openai', 'local-llm', 'modal'
 * @param {string} settings.image - Image provider: 'openai', 'dalle', 'flux', 'bfl', 'modal'
 * @param {string} settings.vision - Vision provider: 'openai', 'gpt-vision', 'local-vision'
 * @param {string} settings.rankingMode - Ranking mode: 'vlm', 'scoring'
 * @returns {Array} Array of requirement objects
 */
function getRequirements(settings = {}) {
  const reqs = [];

  // Normalize settings with defaults
  const llm = settings.llm || 'openai';
  const image = settings.image || 'openai';
  const vision = settings.vision || 'gpt-vision';
  const rankingMode = settings.rankingMode || 'vlm';

  // OpenAI API key requirements
  const needsOpenAI =
    llm === 'openai' ||
    image === 'openai' ||
    image === 'dalle' ||
    vision === 'openai' ||
    vision === 'gpt-vision';

  if (needsOpenAI) {
    reqs.push({
      type: 'apiKey',
      key: 'OPENAI_API_KEY',
      header: 'X-OpenAI-API-Key',
      description: 'OpenAI API key for LLM/image/vision services'
    });
  }

  // BFL API key
  if (image === 'bfl') {
    reqs.push({
      type: 'apiKey',
      key: 'BFL_API_KEY',
      description: 'Black Forest Labs API key for Flux Pro images'
    });
  }

  // Local LLM service
  if (llm === 'local-llm') {
    reqs.push({
      type: 'service',
      name: 'local-llm',
      port: 8003,
      healthPath: '/health',
      description: 'Local LLM service (Mistral)'
    });
  }

  // Flux image service
  if (image === 'flux') {
    reqs.push({
      type: 'service',
      name: 'flux',
      port: 8001,
      healthPath: '/health',
      description: 'Local Flux image generation service'
    });
  }

  // Local vision service (for scoring mode)
  if (rankingMode === 'scoring' || vision === 'local-vision') {
    reqs.push({
      type: 'service',
      name: 'local-vision',
      port: 8002,
      healthPath: '/health',
      description: 'Local vision service (CLIP + aesthetics)'
    });
  }

  // VLM service (for vlm ranking mode)
  if (rankingMode === 'vlm') {
    reqs.push({
      type: 'service',
      name: 'vlm',
      port: 8004,
      healthPath: '/health',
      description: 'VLM service for pairwise tournament ranking'
    });
  }

  // Modal requirements
  if (llm === 'modal' || image === 'modal') {
    reqs.push({
      type: 'env',
      key: 'MODAL_ENDPOINT_URL',
      description: 'Modal web endpoint URL'
    });
    reqs.push({
      type: 'env',
      key: 'MODAL_TOKEN_ID',
      description: 'Modal authentication token ID'
    });
    reqs.push({
      type: 'env',
      key: 'MODAL_TOKEN_SECRET',
      description: 'Modal authentication token secret'
    });
    reqs.push({
      type: 'healthCheck',
      name: 'modal',
      description: 'Modal endpoint health check'
    });
  }

  return reqs;
}

/**
 * Get list of local services that need to be started for these settings
 * @param {Object} settings - Current settings object
 * @returns {Array<string>} Array of service names to start
 */
function getServicesToStart(settings) {
  return getRequirements(settings)
    .filter(r => r.type === 'service')
    .map(r => r.name);
}

/**
 * Check if a specific API key is needed for these settings
 * @param {Object} settings - Current settings object
 * @param {string} keyName - API key name (e.g., 'OPENAI_API_KEY')
 * @returns {boolean} True if the key is required
 */
function needsApiKey(settings, keyName) {
  return getRequirements(settings).some(r => r.type === 'apiKey' && r.key === keyName);
}

/**
 * Check if a specific service needs a health check
 * @param {Object} settings - Current settings object
 * @param {string} serviceName - Service name (e.g., 'modal', 'flux')
 * @returns {boolean} True if health check is needed
 */
function needsHealthCheck(settings, serviceName) {
  return getRequirements(settings).some(
    r => (r.type === 'service' || r.type === 'healthCheck') && r.name === serviceName
  );
}

/**
 * Get requirements grouped by type
 * @param {Object} settings - Current settings object
 * @returns {Object} Requirements grouped by type
 */
function getRequirementsByType(settings) {
  const reqs = getRequirements(settings);
  return {
    apiKeys: reqs.filter(r => r.type === 'apiKey'),
    services: reqs.filter(r => r.type === 'service'),
    envVars: reqs.filter(r => r.type === 'env'),
    healthChecks: reqs.filter(r => r.type === 'healthCheck')
  };
}

module.exports = {
  getRequirements,
  getServicesToStart,
  needsApiKey,
  needsHealthCheck,
  getRequirementsByType
};
