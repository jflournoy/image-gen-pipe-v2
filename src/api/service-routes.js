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
 */
router.post('/:name/start', async (req, res) => {
  const { name } = req.params;
  const { hfToken, loraPath, loraScale, modelPath } = req.body;

  // Validate service name
  const validServices = ['llm', 'flux', 'vision', 'vlm'];
  if (!validServices.includes(name)) {
    return res.status(400).json({
      error: 'Invalid service name',
      message: `Service must be one of: ${validServices.join(', ')}`,
    });
  }

  try {
    const result = await ServiceManager.startService(name, { hfToken, modelPath, loraPath, loraScale });

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
