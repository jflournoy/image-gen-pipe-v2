/**
 * Rate Limiter Registry
 * Global registry for tracking active rate limiters by provider type
 */

const registry = {
  llm: null,
  imageGen: null,
  vision: null
};

/**
 * Register a rate limiter for a specific provider
 * @param {string} providerType - Type of provider ('llm', 'imageGen', 'vision')
 * @param {RateLimiter} limiter - Rate limiter instance
 */
function registerLimiter(providerType, limiter) {
  if (!['llm', 'imageGen', 'vision'].includes(providerType)) {
    throw new Error(`Unknown provider type: ${providerType}`);
  }
  registry[providerType] = limiter;
}

/**
 * Get a registered rate limiter
 * @param {string} providerType - Type of provider ('llm', 'imageGen', 'vision')
 * @returns {RateLimiter|null} Rate limiter instance or null if not registered
 */
function getLimiter(providerType) {
  if (!['llm', 'imageGen', 'vision'].includes(providerType)) {
    throw new Error(`Unknown provider type: ${providerType}`);
  }
  return registry[providerType];
}

/**
 * Get metrics for all registered rate limiters
 * @returns {Object} Metrics for each provider type
 */
function getMetrics() {
  const metrics = {};

  if (registry.llm) {
    metrics.llm = registry.llm.getMetrics();
  } else {
    metrics.llm = { active: 0, queued: 0, limit: 0 };
  }

  if (registry.imageGen) {
    metrics.imageGen = registry.imageGen.getMetrics();
  } else {
    metrics.imageGen = { active: 0, queued: 0, limit: 0 };
  }

  if (registry.vision) {
    metrics.vision = registry.vision.getMetrics();
  } else {
    metrics.vision = { active: 0, queued: 0, limit: 0 };
  }

  return metrics;
}

/**
 * Clear all registered limiters (for testing)
 */
function clearRegistry() {
  registry.llm = null;
  registry.imageGen = null;
  registry.vision = null;
}

module.exports = {
  registerLimiter,
  getLimiter,
  getMetrics,
  clearRegistry
};
