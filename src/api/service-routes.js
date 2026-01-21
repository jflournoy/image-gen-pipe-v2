/**
 * @file Service Control API Routes
 * REST endpoints for starting, stopping, and restarting Python services
 */

import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ServiceManager = require('../utils/service-manager');

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
    const result = await ServiceManager.stopService(name);

    res.json({
      success: result.success,
      message: result.message || `Service ${name} stopped successfully`,
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

export default router;
