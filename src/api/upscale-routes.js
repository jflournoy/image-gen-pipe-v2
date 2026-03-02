/**
 * Upscale Routes
 * Handles standalone image upscaling requests via local Flux service or Modal.
 * Supports Remacri, RealESRGAN, and other RRDBNet-based upscaler models.
 */

import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('fs').promises;
const axios = require('axios');

const router = express.Router();

/**
 * Resolve upscale service URL based on provider.
 * Local: Flux service /upscale endpoint
 * Modal: Modal endpoint with /upscale label
 */
function getUpscaleUrl(provider) {
  if (provider === 'modal') {
    const providerConfig = require('../config/provider-config.js');
    const baseUrl = providerConfig.modal?.apiUrl;
    if (!baseUrl) {
      throw new Error('MODAL_ENDPOINT_URL not configured');
    }
    // Modal fastapi_endpoint label "upscale" → /upscale path
    return baseUrl.replace(/\/generate\/?$/, '/upscale');
  }
  // Default: local Flux service
  const providerConfig = require('../config/provider-config.js');
  return (providerConfig.flux?.apiUrl || 'http://localhost:8001') + '/upscale';
}

/**
 * POST /api/upscale
 * Upscale an image using standalone upscaler
 *
 * Body:
 *   - imageBase64: base64-encoded input image (required unless imagePath provided)
 *   - imagePath:   path to a local input image file (alternative to imageBase64)
 *   - model:       upscaler model name (default: 'remacri')
 *   - provider:    'local' or 'modal' (default: 'local')
 */
router.post('/', async (req, res) => {
  try {
    const { imageBase64, imagePath, model, provider } = req.body;

    // Validate: need either imageBase64 or imagePath
    if (!imageBase64 && !imagePath) {
      return res.status(400).json({
        error: 'imageBase64 or imagePath is required'
      });
    }

    // Resolve image to base64
    let inputBase64 = imageBase64;
    if (!inputBase64 && imagePath) {
      try {
        const imgBuffer = await fs.readFile(imagePath);
        inputBase64 = imgBuffer.toString('base64');
      } catch (e) {
        return res.status(400).json({
          error: `Could not read image file: ${e.message}`
        });
      }
    }

    // Validate base64
    try {
      Buffer.from(inputBase64, 'base64');
    } catch {
      return res.status(400).json({
        error: 'imageBase64 must be valid base64'
      });
    }

    const upscaleProvider = provider || 'local';

    let upscaleUrl;
    try {
      upscaleUrl = getUpscaleUrl(upscaleProvider);
    } catch (configError) {
      return res.status(503).json({
        error: `Upscale service not configured: ${configError.message}`,
        type: 'configuration'
      });
    }

    console.log('[UpscaleRoutes] Upscaling image', {
      model: model || 'remacri',
      provider: upscaleProvider,
      url: upscaleUrl,
    });

    const response = await axios.post(upscaleUrl, {
      imageBase64: inputBase64,
      model: model || 'remacri',
    }, {
      timeout: 120000, // 2 minute timeout (upscaling large images takes time)
      maxContentLength: 100 * 1024 * 1024, // 100MB response limit (4x upscaled images are large)
    });

    console.log('[UpscaleRoutes] Upscale completed', {
      width: response.data.width,
      height: response.data.height,
      model: response.data.metadata?.model,
      time: response.data.metadata?.time,
    });

    return res.json(response.data);

  } catch (error) {
    if (error.response) {
      // Forward error from upscale service
      const status = error.response.status;
      const detail = error.response.data?.detail || error.response.data?.error || error.message;
      console.error('[UpscaleRoutes] Service error', { status, detail });
      return res.status(status).json({ error: detail });
    }
    if (error.code === 'ECONNREFUSED') {
      console.error('[UpscaleRoutes] Cannot reach upscale service');
      return res.status(503).json({
        error: 'Upscale service not running. Start the Flux service first.',
        type: 'connection'
      });
    }
    console.error('[UpscaleRoutes] Upscale failed', error);
    res.status(500).json({
      error: error.message,
      type: error.constructor.name
    });
  }
});

/**
 * GET /api/upscale/health
 * Check upscaler availability
 */
router.get('/health', async (req, res) => {
  try {
    const providerConfig = require('../config/provider-config.js');
    const fluxUrl = providerConfig.flux?.apiUrl || 'http://localhost:8001';

    const response = await axios.get(`${fluxUrl}/upscale/models`, { timeout: 5000 });
    return res.json({
      available: true,
      ...response.data
    });
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        available: false,
        status: 'service_not_running',
        error: 'Flux service not running'
      });
    }
    return res.status(503).json({
      available: false,
      status: 'error',
      error: error.message
    });
  }
});

/**
 * GET /api/upscale/models
 * List available upscaler models
 */
router.get('/models', async (req, res) => {
  try {
    const providerConfig = require('../config/provider-config.js');
    const fluxUrl = providerConfig.flux?.apiUrl || 'http://localhost:8001';

    const response = await axios.get(`${fluxUrl}/upscale/models`, { timeout: 5000 });
    return res.json(response.data);
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Flux service not running',
        type: 'connection'
      });
    }
    return res.status(500).json({
      error: error.message,
      type: error.constructor.name
    });
  }
});

export default router;
