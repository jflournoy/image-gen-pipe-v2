/**
 * Video Generation Routes
 * Handles image-to-video generation requests via Modal WAN service
 */

import express from 'express';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('fs').promises;
const { createVideoProvider } = require('../factory/provider-factory.js');

const router = express.Router();

/**
 * POST /api/video/generate
 * Generate a video from an image (I2V) or from text only (T2V)
 *
 * Body:
 *   - mode: 'i2v' (default) or 't2v' — determines whether image is required
 *   - imageData: base64 image data (required for I2V)
 *   - imagePath: path to local image file (alternative to imageData for I2V)
 *   - prompt (required): motion/animation prompt
 *   - model: video model name (wan2.2-i2v-high, wan2.2-ti2v-5b, wan2.2-t2v-14b)
 *   - steps: inference steps (10-50)
 *   - guidance: guidance scale for high-noise expert (1-10)
 *   - guidance_2: guidance scale for low-noise expert (MoE 14B models only, 1-10)
 *   - fps: frames per second (12-30)
 *   - num_frames: number of frames (17-144)
 *   - height: video height (T2V mode, default 480)
 *   - width: video width (T2V mode, default 832)
 *   - seed: random seed (optional)
 *   - sessionId: session ID for output organization
 *   - outputDir: base output directory
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      mode,
      imageData,
      imagePath,
      prompt,
      model,
      steps,
      guidance,
      guidance_2,
      fps,
      num_frames,
      height,
      width,
      seed,
      sessionId,
      outputDir
    } = req.body;

    const videoMode = mode || 'i2v';

    console.log('[VideoRoutes] Video generation request', {
      mode: videoMode,
      hasImageData: !!imageData,
      imagePath,
      prompt: prompt?.substring(0, 50),
      model,
      steps,
      guidance,
      guidance_2
    });

    // Validate required parameters
    if (!prompt || prompt.trim() === '') {
      return res.status(400).json({
        error: 'prompt is required and must not be empty'
      });
    }

    // Image is required for I2V mode, optional for T2V
    if (videoMode === 'i2v' && !imageData && !imagePath) {
      return res.status(400).json({
        error: 'imageData or imagePath is required for I2V mode'
      });
    }

    // Get image buffer (only for I2V mode or when provided)
    let imageBuffer = null;
    if (imageData) {
      try {
        imageBuffer = Buffer.from(imageData, 'base64');
      } catch {
        return res.status(400).json({
          error: 'imageData must be valid base64'
        });
      }
    } else if (imagePath) {
      try {
        imageBuffer = await fs.readFile(imagePath);
      } catch (e) {
        return res.status(400).json({
          error: `Could not read image file: ${e.message}`
        });
      }
    }

    // Use output directory (same as beam search)
    const finalOutputDir = outputDir || join(process.cwd(), 'output');

    // Create video provider
    try {
      const videoProvider = createVideoProvider({
        sessionId: sessionId || 'api-session',
        outputDir: finalOutputDir
      });

      console.log('[VideoRoutes] Generating video', {
        mode: videoMode,
        prompt: prompt.substring(0, 50),
        model,
        steps,
        guidance,
        guidance_2
      });

      // Generate video
      const result = await videoProvider.generateVideo(
        imageBuffer,
        prompt,
        {
          mode: videoMode,
          model,
          steps,
          guidance,
          guidance_2,
          fps,
          num_frames,
          height,
          width,
          seed
        }
      );

      console.log('[VideoRoutes] Video generated successfully', {
        videoPath: result.videoPath,
        duration: result.metadata?.duration_seconds
      });

      // Read video file for base64 encoding
      let videoData = null;
      if (result.videoPath) {
        try {
          const videoBuffer = await fs.readFile(result.videoPath);
          videoData = videoBuffer.toString('base64');
        } catch (e) {
          console.warn('[VideoRoutes] Could not read generated video file', e);
        }
      }

      return res.json({
        success: true,
        videoPath: result.videoPath,
        videoData,
        format: result.format || 'mp4',
        duration_seconds: result.metadata?.duration_seconds,
        metadata: result.metadata
      });

    } catch (providerError) {
      // Check if this is a configuration error
      if (providerError.message.includes('required') || providerError.message.includes('MODAL')) {
        console.warn('[VideoRoutes] Video provider not configured', providerError.message);
        return res.status(503).json({
          error: `Video service not configured: ${providerError.message}`,
          type: 'configuration'
        });
      }
      throw providerError;
    }

  } catch (error) {
    console.error('[VideoRoutes] Video generation failed', error);
    res.status(500).json({
      error: error.message,
      type: error.constructor.name
    });
  }
});

/**
 * GET /api/video/health
 * Check video service health
 */
router.get('/health', async (req, res) => {
  try {
    try {
      const videoProvider = createVideoProvider();
      const health = await videoProvider.healthCheck();

      return res.json(health);
    } catch (providerError) {
      // Provider not configured
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
    console.error('[VideoRoutes] Video health check failed', error);
    res.status(500).json({
      available: false,
      status: 'error',
      error: error.message
    });
  }
});

export default router;
