/**
 * @file Service Control API Routes
 * REST endpoints for starting, stopping, and restarting Python services
 */

import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ServiceManager = require('../utils/service-manager');
const ModelCoordinator = require('../utils/model-coordinator');

// Wire up the service restarter for auto-restart functionality
ModelCoordinator.setServiceRestarter(async (serviceName) => {
  console.log(`[ServiceRoutes] Auto-restarting crashed service: ${serviceName}`);
  return await ServiceManager.restartService(serviceName);
});

const router = express.Router();

/**
 * GET /api/services/status
 * Get status of all services
 */
router.get('/status', async (req, res) => {
  try {
    const statuses = await ServiceManager.getAllServiceStatuses();
    res.json(statuses);
  } catch (error) {
    console.error('[ServiceRoutes] Error getting service statuses:', error);
    res.status(500).json({
      error: 'Failed to get service statuses',
      message: error.message,
    });
  }
});

/**
 * POST /api/services/:name/start
 * Start a service
 *
 * Request body:
 * - hfToken: HuggingFace API token (optional)
 * - modelPath: Path to custom Flux model (optional)
 * - loraPath: Path to LoRA weights (optional)
 * - loraScale: LoRA strength multiplier (optional, default 1.0)
 * - textEncoderPath: Path to CLIP-L encoder (optional, for custom Flux models)
 * - textEncoder2Path: Path to T5-XXL encoder (optional, for custom Flux models)
 * - vaePath: Path to VAE encoder (optional, for custom Flux models)
 */
router.post('/:name/start', async (req, res) => {
  const { name } = req.params;

  // Defensive check for missing request body
  const body = req.body || {};

  const {
    hfToken,
    loraPath,
    loraScale,
    modelPath,
    textEncoderPath,    // NEW: CLIP-L encoder path
    textEncoder2Path,   // NEW: T5-XXL encoder path
    vaePath            // NEW: VAE encoder path
  } = body;

  // Validate service name
  const validServices = ['llm', 'flux', 'vision', 'vlm'];
  if (!validServices.includes(name)) {
    return res.status(400).json({
      error: 'Invalid service name',
      message: `Service must be one of: ${validServices.join(', ')}`,
    });
  }

  // Validate Flux encoder paths before attempting to start
  if (name === 'flux') {
    const validation = ServiceManager.validateFluxEncoderPaths({
      modelPath,
      textEncoderPath,
      textEncoder2Path,
      vaePath
    });

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid Flux configuration',
        message: validation.error
      });
    }
  }

  try {
    const result = await ServiceManager.startService(name, {
      hfToken,
      modelPath,
      loraPath,
      loraScale,
      textEncoderPath,     // Pass encoder paths to ServiceManager
      textEncoder2Path,
      vaePath
    });

    if (!result.success) {
      return res.status(409).json({
        error: result.error,
        pid: result.pid,
      });
    }

    // Mark service as intended to be running (for auto-restart on crash)
    ModelCoordinator.markServiceIntent(name, true);

    res.json({
      success: true,
      pid: result.pid,
      port: result.port,
      message: `Service ${name} started successfully`,
    });
  } catch (error) {
    console.error(`[ServiceRoutes] Error starting ${name}:`, error);
    res.status(500).json({
      error: 'Failed to start service',
      message: error.message,
    });
  }
});

/**
 * POST /api/services/:name/stop
 * Stop a service
 * Creates STOP_LOCK to prevent auto-restarts during shutdown
 */
router.post('/:name/stop', async (req, res) => {
  const { name } = req.params;

  // Validate service name
  const validServices = ['llm', 'flux', 'vision', 'vlm'];
  if (!validServices.includes(name)) {
    return res.status(400).json({
      error: 'Invalid service name',
      message: `Service must be one of: ${validServices.join(', ')}`,
    });
  }

  try {
    // Create STOP_LOCK to prevent auto-restart during shutdown
    await ServiceManager.createStopLock(name);
    console.log(`[ServiceRoutes] Created STOP_LOCK for ${name} before stopping`);

    const result = await ServiceManager.stopService(name);

    // Mark service as intentionally stopped (don't auto-restart)
    ModelCoordinator.markServiceIntent(name, false);

    res.json({
      success: result.success,
      message: result.message || `Service ${name} stopped successfully (restart prevented by STOP_LOCK)`,
    });
  } catch (error) {
    console.error(`[ServiceRoutes] Error stopping ${name}:`, error);
    res.status(500).json({
      error: 'Failed to stop service',
      message: error.message,
    });
  }
});

/**
 * POST /api/services/:name/restart
 * Restart a service
 * Blocked if STOP_LOCK exists (preventing accidental auto-restart after user stop)
 */
router.post('/:name/restart', async (req, res) => {
  const { name } = req.params;

  // Validate service name
  const validServices = ['llm', 'flux', 'vision', 'vlm'];
  if (!validServices.includes(name)) {
    return res.status(400).json({
      error: 'Invalid service name',
      message: `Service must be one of: ${validServices.join(', ')}`,
    });
  }

  try {
    // Check for STOP_LOCK - if it exists, prevent restart
    const hasLock = await ServiceManager.hasStopLock(name);
    if (hasLock) {
      console.log(`[ServiceRoutes] Restart blocked for ${name}: STOP_LOCK exists`);
      return res.status(409).json({
        error: 'Service restart blocked',
        message: `Service ${name} was manually stopped. Remove STOP_LOCK to allow restarts.`,
      });
    }

    const result = await ServiceManager.restartService(name);

    if (!result.success) {
      return res.status(500).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      pid: result.pid,
      port: result.port,
      message: `Service ${name} restarted successfully`,
    });
  } catch (error) {
    console.error(`[ServiceRoutes] Error restarting ${name}:`, error);
    res.status(500).json({
      error: 'Failed to restart service',
      message: error.message,
    });
  }
});

/**
 * GET /api/services/health
 * Get health status of all services and trigger auto-restart for crashed services
 */
router.get('/health', async (req, res) => {
  try {
    const report = await ModelCoordinator.getServiceHealthReport();
    res.json(report);
  } catch (error) {
    console.error('[ServiceRoutes] Error getting health report:', error);
    res.status(500).json({
      error: 'Failed to get health report',
      message: error.message,
    });
  }
});

/**
 * POST /api/services/ensure-healthy
 * Check all services and auto-restart any that crashed
 */
router.post('/ensure-healthy', async (req, res) => {
  try {
    const results = await ModelCoordinator.ensureAllServicesHealthy();
    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('[ServiceRoutes] Error ensuring service health:', error);
    res.status(500).json({
      error: 'Failed to ensure service health',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/services/:name/stop-lock
 * Remove STOP_LOCK for a service
 * Call this after confirming no pending restarts to allow auto-restart on crashes
 */
router.delete('/:name/stop-lock', async (req, res) => {
  const { name } = req.params;

  // Validate service name
  const validServices = ['llm', 'flux', 'vision', 'vlm'];
  if (!validServices.includes(name)) {
    return res.status(400).json({
      error: 'Invalid service name',
      message: `Service must be one of: ${validServices.join(', ')}`,
    });
  }

  try {
    const hadLock = await ServiceManager.hasStopLock(name);

    if (!hadLock) {
      return res.status(404).json({
        error: 'No STOP_LOCK found',
        message: `Service ${name} does not have an active STOP_LOCK`,
      });
    }

    await ServiceManager.deleteStopLock(name);
    console.log(`[ServiceRoutes] Removed STOP_LOCK for ${name}, restarts now allowed`);

    res.json({
      success: true,
      message: `STOP_LOCK removed for ${name}. Auto-restart on crashes is now enabled.`,
    });
  } catch (error) {
    console.error(`[ServiceRoutes] Error removing STOP_LOCK for ${name}:`, error);
    res.status(500).json({
      error: 'Failed to remove STOP_LOCK',
      message: error.message,
    });
  }
});

export default router;
