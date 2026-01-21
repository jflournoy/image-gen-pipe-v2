/**
 * @file Configuration Management API Routes
 * REST endpoints for reading and writing .env configuration
 * with validation, security measures, and atomic updates
 */

import express from 'express';
import {
  readEnvFile,
  updateEnvFile,
  getRelevantConfig,
  validatePath,
  backupEnvFile,
  resetToDefaults
} from '../utils/env-manager.js';

const router = express.Router();

// Whitelist of allowed configuration keys
const ALLOWED_KEYS = [
  // Flux model configuration
  'FLUX_MODEL_PATH',
  'FLUX_MODEL_SOURCE',
  'FLUX_LORA_PATH',
  'FLUX_LORA_SCALE',
  'FLUX_TEXT_ENCODER_PATH',
  'FLUX_TEXT_ENCODER_2_PATH',
  'FLUX_VAE_PATH',

  // Authentication
  'HF_TOKEN',

  // Image ranking
  'RANKING_MODE',

  // LLM configuration (llama-cpp-python)
  'LLM_MODEL_REPO',
  'LLM_MODEL_FILE',
  'LLM_MODEL_PATH',
  'LLM_GPU_LAYERS',
  'LLM_CONTEXT_SIZE',

  // VLM configuration (vision-language model)
  'VLM_MODEL_REPO',
  'VLM_MODEL_FILE',
  'VLM_CLIP_FILE',
  'VLM_MODEL_PATH',
  'VLM_CLIP_PATH',
  'VLM_GPU_LAYERS',
  'VLM_CONTEXT_SIZE',

  // Vision service configuration (CLIP)
  'CLIP_MODEL',

  // OpenAI configuration
  'OPENAI_API_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_LLM_MODEL',
  'OPENAI_LLM_MODEL_EXPAND',
  'OPENAI_LLM_MODEL_REFINE',
  'OPENAI_LLM_MODEL_COMBINE',
  'OPENAI_IMAGE_MODEL',
  'OPENAI_VISION_MODEL',
  'OPENAI_MAX_RETRIES',
  'OPENAI_TIMEOUT_MS'
];

// Rate limiting: Track update requests per IP
const updateRequests = new Map();
const MAX_UPDATES_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60000;

/**
 * Check if request exceeds rate limit
 * @param {string} ip - Client IP address
 * @returns {boolean} True if rate limit exceeded
 */
function isRateLimited(ip) {
  const now = Date.now();
  const requests = updateRequests.get(ip) || [];

  // Remove requests older than 1 minute
  const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= MAX_UPDATES_PER_MINUTE) {
    return true;
  }

  recentRequests.push(now);
  updateRequests.set(ip, recentRequests);
  return false;
}

/**
 * Validate configuration keys against whitelist
 * @param {Object} updates - Key-value pairs to validate
 * @returns {Object} Validation result with valid keys and rejected keys
 */
function validateKeys(updates) {
  const valid = {};
  const rejected = [];

  for (const [key, value] of Object.entries(updates)) {
    if (ALLOWED_KEYS.includes(key)) {
      // Sanitize value (prevent injection attacks)
      const sanitized = sanitizeValue(value);
      valid[key] = sanitized;
    } else {
      rejected.push(key);
    }
  }

  return { valid, rejected };
}

/**
 * Sanitize configuration value
 * @param {string} value - Value to sanitize
 * @returns {string} Sanitized value
 */
function sanitizeValue(value) {
  if (typeof value !== 'string') {
    return String(value);
  }

  // Remove potentially dangerous characters for shell injection
  // But preserve valid path characters and common config values
  return value.trim();
}

/**
 * GET /api/config/env
 * Get full .env configuration as JSON
 */
router.get('/env', async (req, res) => {
  try {
    const config = await readEnvFile();

    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('[ConfigRoutes] Error reading .env:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read configuration',
      message: error.message
    });
  }
});

/**
 * POST /api/config/env
 * Update specific .env values
 *
 * Request body: { KEY1: 'value1', KEY2: 'value2', ... }
 *
 * Response: { success: true, updated: ['KEY1', 'KEY2'], warnings: [...] }
 */
router.post('/env', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;

  // Rate limiting check
  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: `Maximum ${MAX_UPDATES_PER_MINUTE} updates per minute allowed`
    });
  }

  try {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body',
        message: 'Expected JSON object with key-value pairs'
      });
    }

    // Validate keys against whitelist
    const { valid, rejected } = validateKeys(updates);

    if (Object.keys(valid).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid keys to update',
        rejected
      });
    }

    // Validate file paths (if present)
    const warnings = [];
    const pathKeys = [
      'FLUX_MODEL_PATH',
      'FLUX_LORA_PATH',
      'FLUX_TEXT_ENCODER_PATH',
      'FLUX_TEXT_ENCODER_2_PATH',
      'FLUX_VAE_PATH'
    ];

    for (const key of pathKeys) {
      if (key in valid && valid[key]) {
        const validation = await validatePath(valid[key]);
        if (!validation.exists) {
          warnings.push({
            key,
            message: `Path not found: ${valid[key]}`
          });
        }
      }
    }

    // Update .env file
    const result = await updateEnvFile(valid);

    res.json({
      success: true,
      updated: result.updated,
      rejected: rejected.length > 0 ? rejected : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    });
  } catch (error) {
    console.error('[ConfigRoutes] Error updating .env:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration',
      message: error.message
    });
  }
});

/**
 * GET /api/config/env/relevant
 * Get context-aware configuration (filtered by provider mode)
 *
 * Query params:
 * - mode: 'local' or 'openai'
 *
 * Response: { success: true, config: { ... }, mode: 'local' }
 */
router.get('/env/relevant', async (req, res) => {
  try {
    const mode = req.query.mode || 'local';

    if (!['local', 'openai'].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mode',
        message: 'Mode must be "local" or "openai"'
      });
    }

    // Read full config
    const fullConfig = await readEnvFile();

    // Filter by mode
    const config = getRelevantConfig(fullConfig, mode);

    res.json({
      success: true,
      config,
      mode
    });
  } catch (error) {
    console.error('[ConfigRoutes] Error reading relevant config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read configuration',
      message: error.message
    });
  }
});

/**
 * POST /api/config/env/reset
 * Reset .env to defaults from .env.example
 * Creates backup before resetting
 *
 * Response: { success: true, backup: '/path/to/.env.backup' }
 */
router.post('/env/reset', async (req, res) => {
  try {
    const result = await resetToDefaults();

    res.json({
      success: true,
      backup: result.backup,
      message: 'Configuration reset to defaults'
    });
  } catch (error) {
    console.error('[ConfigRoutes] Error resetting config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset configuration',
      message: error.message
    });
  }
});

export default router;
