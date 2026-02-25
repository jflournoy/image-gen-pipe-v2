/**
 * Resample Routes
 * Handles img2img resample requests for two-stage cartoon→photoreal refinement.
 * Uses Modal image provider with inputImage + denoiseStrength for img2img pipeline.
 */

import express from 'express';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('fs').promises;
const { createImageProvider } = require('../factory/provider-factory.js');

const router = express.Router();

/**
 * POST /api/resample
 * Resample an image using img2img (two-stage cartoon→photoreal refinement)
 *
 * Body:
 *   - imageBase64: base64-encoded input image (required unless imagePath provided)
 *   - imagePath:   path to a local input image file (alternative to imageBase64)
 *   - model:       target model name for the photoreal pass (required)
 *   - prompt:      generation prompt (required)
 *   - denoiseStrength: img2img denoising strength (0.0–1.0, default 0.6)
 *   - steps:       inference steps (optional)
 *   - guidance:    guidance scale (optional)
 *   - sessionId:   session ID for output organisation (optional)
 *   - outputDir:   base output directory (optional, defaults to ./output)
 */
router.post('/', async (req, res) => {
  try {
    const {
      imageBase64,
      imagePath,
      model,
      prompt,
      denoiseStrength,
      steps,
      guidance,
      sessionId,
      outputDir
    } = req.body;

    // Validate required fields
    if (!imageBase64 && !imagePath) {
      return res.status(400).json({
        error: 'imageBase64 or imagePath is required'
      });
    }

    if (!model || model.trim() === '') {
      return res.status(400).json({
        error: 'model is required'
      });
    }

    if (!prompt || prompt.trim() === '') {
      return res.status(400).json({
        error: 'prompt is required and must not be empty'
      });
    }

    // Resolve image buffer
    let imageBuffer = null;
    if (imageBase64) {
      try {
        imageBuffer = Buffer.from(imageBase64, 'base64');
      } catch {
        return res.status(400).json({
          error: 'imageBase64 must be valid base64'
        });
      }
    } else {
      try {
        imageBuffer = await fs.readFile(imagePath);
      } catch (e) {
        return res.status(400).json({
          error: `Could not read image file: ${e.message}`
        });
      }
    }

    const inputBase64 = imageBuffer.toString('base64');
    const finalOutputDir = outputDir || join(process.cwd(), 'output');

    // Create Modal image provider (always Modal for img2img)
    try {
      const imageProvider = createImageProvider({
        provider: 'modal',
        mode: 'real',
        model,
        sessionId: sessionId || 'api-resample',
        outputDir: finalOutputDir
      });

      console.log('[ResampleRoutes] Resampling image', {
        model,
        prompt: prompt.substring(0, 60),
        denoiseStrength,
        steps,
        guidance
      });

      const result = await imageProvider.generateImage(prompt, {
        inputImage: inputBase64,
        denoiseStrength: denoiseStrength !== undefined ? denoiseStrength : 0.6,
        steps,
        guidance,
        sessionId: sessionId || 'api-resample'
      });

      console.log('[ResampleRoutes] Resample completed', {
        imagePath: result.localPath
      });

      // Read the saved image back for base64 response
      let imageData = null;
      if (result.localPath) {
        try {
          const imgBuffer = await fs.readFile(result.localPath);
          imageData = imgBuffer.toString('base64');
        } catch (e) {
          console.warn('[ResampleRoutes] Could not read resampled image file', e);
        }
      }

      return res.json({
        success: true,
        imagePath: result.localPath,
        imageData,
        metadata: result.metadata
      });

    } catch (providerError) {
      // Configuration error → 503
      if (providerError.message.includes('required') || providerError.message.includes('MODAL')) {
        console.warn('[ResampleRoutes] Image provider not configured', providerError.message);
        return res.status(503).json({
          error: `Image service not configured: ${providerError.message}`,
          type: 'configuration'
        });
      }
      throw providerError;
    }

  } catch (error) {
    console.error('[ResampleRoutes] Resample failed', error);
    res.status(500).json({
      error: error.message,
      type: error.constructor.name
    });
  }
});

/**
 * GET /api/resample/health
 * Check Modal image service health
 */
router.get('/health', async (req, res) => {
  try {
    try {
      const imageProvider = createImageProvider({ provider: 'modal', mode: 'real' });
      const health = await imageProvider.healthCheck();
      return res.json(health);
    } catch (providerError) {
      if (providerError.message.includes('required') || providerError.message.includes('MODAL')) {
        return res.status(503).json({
          available: false,
          status: 'not_configured',
          error: providerError.message,
          type: 'configuration'
        });
      }
      throw providerError;
    }
  } catch (error) {
    console.error('[ResampleRoutes] Health check failed', error);
    res.status(500).json({
      available: false,
      status: 'error',
      error: error.message
    });
  }
});

export default router;
