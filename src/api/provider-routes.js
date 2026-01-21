/**
 * @file Provider Management Routes
 * API endpoints for runtime provider switching and status
 */

import express from 'express';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const providerConfig = require('../config/provider-config.js');
const axios = require('axios');

const router = express.Router();

// Runtime provider state (overrides config)
let runtimeProviders = {
  llm: null,
  image: null,
  vision: null
};

/**
 * GET /api/providers/status
 * Get current provider configuration and availability
 */
router.get('/status', async (req, res) => {
  try {
    // Current active providers
    const active = {
      llm: runtimeProviders.llm || providerConfig.llm.provider,
      image: runtimeProviders.image || providerConfig.image.provider,
      vision: runtimeProviders.vision || (providerConfig.vision?.provider || 'openai')
    };

    // Check health of local services (including VLM for pairwise ranking)
    const health = {
      localLLM: await checkLocalLLMHealth(),
      flux: await checkFluxHealth(),
      localVision: await checkLocalVisionHealth(),
      vlm: await checkVLMHealth()
    };

    // Determine environment
    const isLocal = process.env.NODE_ENV === 'development' ||
                    req.hostname === 'localhost' ||
                    req.hostname === '127.0.0.1';

    res.json({
      active,
      available: {
        llm: ['openai', 'local-llm'],
        image: ['openai', 'flux'],
        vision: ['openai', 'local']
      },
      health,
      environment: {
        isLocal,
        nodeEnv: process.env.NODE_ENV
      },
      config: {
        localLLM: providerConfig.localLLM,
        flux: {
          apiUrl: providerConfig.flux?.apiUrl,
          model: providerConfig.flux?.model
        },
        localVision: {
          apiUrl: providerConfig.localVision?.apiUrl
        }
      }
    });
  } catch (error) {
    console.error('[Provider Routes] Error getting status:', error);
    res.status(500).json({
      error: 'Failed to get provider status',
      message: error.message
    });
  }
});

/**
 * POST /api/providers/switch
 * Switch providers at runtime
 * Body: { llm?: 'openai'|'local-llm', image?: 'openai'|'flux', vision?: 'openai'|'local' }
 */
router.post('/switch', async (req, res) => {
  try {
    const { llm, image, vision } = req.body;

    // Validate provider names
    const validLLM = ['openai', 'local-llm'];
    const validImage = ['openai', 'flux'];
    const validVision = ['openai', 'local'];

    if (llm && !validLLM.includes(llm)) {
      return res.status(400).json({
        error: 'Invalid LLM provider',
        valid: validLLM
      });
    }

    if (image && !validImage.includes(image)) {
      return res.status(400).json({
        error: 'Invalid image provider',
        valid: validImage
      });
    }

    if (vision && !validVision.includes(vision)) {
      return res.status(400).json({
        error: 'Invalid vision provider',
        valid: validVision
      });
    }

    // Test that local providers are available before switching
    if (llm === 'local-llm') {
      const health = await checkLocalLLMHealth();
      if (!health.available) {
        return res.status(503).json({
          error: 'Local LLM service not available',
          message: 'Start Local LLM service before switching to local LLM'
        });
      }
    }

    if (image === 'flux') {
      const health = await checkFluxHealth();
      if (!health.available) {
        return res.status(503).json({
          error: 'Flux service not available',
          message: 'Start Flux service before switching to local image generation'
        });
      }
    }

    if (vision === 'local') {
      const health = await checkLocalVisionHealth();
      if (!health.available) {
        return res.status(503).json({
          error: 'Local vision service not available',
          message: 'Start local vision service before switching'
        });
      }
    }

    // Update runtime providers
    if (llm) runtimeProviders.llm = llm;
    if (image) runtimeProviders.image = image;
    if (vision) runtimeProviders.vision = vision;

    // Return updated status
    res.json({
      success: true,
      active: {
        llm: runtimeProviders.llm || providerConfig.llm.provider,
        image: runtimeProviders.image || providerConfig.image.provider,
        vision: runtimeProviders.vision || (providerConfig.vision?.provider || 'openai')
      },
      message: 'Providers updated successfully'
    });
  } catch (error) {
    console.error('[Provider Routes] Error switching providers:', error);
    res.status(500).json({
      error: 'Failed to switch providers',
      message: error.message
    });
  }
});

/**
 * GET /api/providers/health
 * Check health of all provider services
 */
router.get('/health', async (req, res) => {
  try {
    const [ollama, flux, localVision] = await Promise.all([
      checkLocalLLMHealth(),
      checkFluxHealth(),
      checkLocalVisionHealth()
    ]);

    res.json({
      ollama,
      flux,
      localVision,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Provider Routes] Error checking health:', error);
    res.status(500).json({
      error: 'Failed to check provider health',
      message: error.message
    });
  }
});

/**
 * Helper: Check Local LLM service health
 */
async function checkLocalLLMHealth() {
  try {
    const provider = new (require('../providers/local-llm-provider.js'))({
      apiUrl: providerConfig.localLLM?.apiUrl || 'http://localhost:8003'
    });

    const health = await provider.healthCheck();
    return {
      available: true,
      status: 'healthy',
      model: health.model,
      device: health.device,
      url: providerConfig.localLLM?.apiUrl
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      error: error.message,
      url: providerConfig.localLLM?.apiUrl
    };
  }
}

/**
 * Helper: Check Flux service health
 */
async function checkFluxHealth() {
  try {
    const provider = new (require('../providers/flux-image-provider.js'))({
      apiUrl: providerConfig.flux?.apiUrl || 'http://localhost:8001'
    });

    const health = await provider.healthCheck();
    return {
      available: true,
      status: 'healthy',
      model: health.model || providerConfig.flux?.model,
      model_loaded: health.model_loaded,
      hf_authenticated: health.hf_authenticated,
      url: providerConfig.flux?.apiUrl
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      error: error.message,
      url: providerConfig.flux?.apiUrl
    };
  }
}

/**
 * Helper: Check local vision service health
 */
async function checkLocalVisionHealth() {
  try {
    const provider = new (require('../providers/local-vision-provider.js'))({
      apiUrl: providerConfig.localVision?.apiUrl || 'http://localhost:8002'
    });

    const health = await provider.healthCheck();
    return {
      available: true,
      status: 'healthy',
      models: health.models || [],
      url: providerConfig.localVision?.apiUrl
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      error: error.message,
      url: providerConfig.localVision?.apiUrl
    };
  }
}

/**
 * Helper: Check VLM service health (for pairwise ranking)
 */
async function checkVLMHealth() {
  try {
    const LocalVLMProvider = require('../providers/local-vlm-provider.js');
    const provider = new LocalVLMProvider({
      apiUrl: 'http://localhost:8004'
    });

    const health = await provider.healthCheck();
    return {
      available: true,
      status: 'healthy',
      model: health.model_repo || 'llava',
      model_loaded: health.model_loaded,
      url: 'http://localhost:8004'
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      error: error.message,
      url: 'http://localhost:8004'
    };
  }
}

/**
 * GET /api/providers/models/status
 * Check which models are available locally
 */
router.get('/models/status', async (req, res) => {
  try {
    const status = {
      localLLM: {
        installed: false,
        model: null
      },
      flux: {
        installed: false,
        modelPath: null
      },
      localVision: {
        installed: false,
        models: []
      }
    };

    // Check Local LLM
    try {
      const llmHealth = await checkLocalLLMHealth();
      status.localLLM.installed = llmHealth.available;
      status.localLLM.model = llmHealth.model;
    } catch (error) {
      console.error('[Models] Error checking Local LLM:', error.message);
    }

    // Check Flux
    try {
      const fluxHealth = await checkFluxHealth();
      status.flux.installed = fluxHealth.available;
      status.flux.modelPath = fluxHealth.model_path || fluxHealth.model;  // Local path or HF repo name
      status.flux.modelName = fluxHealth.model;
      status.flux.modelSource = fluxHealth.model_source || 'huggingface';  // 'local' or 'huggingface'
      status.flux.modelLoaded = fluxHealth.model_loaded;
      // Model is cached if service is available but model not loaded,
      // OR if we can verify it exists in HuggingFace cache
      status.flux.cached = fluxHealth.available && !fluxHealth.model_loaded;
      status.flux.downloaded = status.flux.cached || status.flux.modelLoaded;
    } catch (error) {
      console.error('[Models] Error checking Flux:', error.message);
    }

    // Check Local Vision
    try {
      const visionHealth = await checkLocalVisionHealth();
      status.localVision.installed = visionHealth.available;
      status.localVision.models = visionHealth.models || [];
    } catch (error) {
      console.error('[Models] Error checking Local Vision:', error.message);
    }

    res.json(status);
  } catch (error) {
    console.error('[Models] Error getting model status:', error);
    res.status(500).json({
      error: 'Failed to get model status',
      message: error.message
    });
  }
});

/**
 * POST /api/providers/models/download
 * Download a specific model
 * Body: { type: 'local-llm'|'flux'|'clip', model: 'model-name' }
 */
router.post('/models/download', async (req, res) => {
  const { type, model } = req.body;

  if (!type || !model) {
    return res.status(400).json({
      error: 'Missing required parameters',
      message: 'Both type and model are required'
    });
  }

  try {
    // Set SSE headers for streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendProgress({
      status: 'started',
      type,
      model,
      message: `Starting download of ${model}...`
    });

    if (type === 'local-llm') {
      await downloadLocalLLMModel(model, sendProgress);
    } else if (type === 'flux') {
      await downloadFluxModel(sendProgress);
    } else if (type === 'clip' || type === 'aesthetic') {
      sendProgress({
        status: 'info',
        message: 'Local vision models download requires manual setup. Please see documentation.'
      });
    } else {
      sendProgress({
        status: 'error',
        message: `Unknown model type: ${type}`
      });
    }

    sendProgress({
      status: 'complete',
      message: 'Download process finished'
    });

    res.end();
  } catch (error) {
    console.error('[Models] Download error:', error);
    const sendProgress = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    sendProgress({
      status: 'error',
      message: error.message
    });
    res.end();
  }
});

/**
 * POST /api/providers/flux/model-path
 * Configure custom Flux model path (for locally downloaded models like CivitAI)
 */
router.post('/flux/model-path', async (req, res) => {
  const { modelPath } = req.body;
  const fs = require('fs');

  if (!modelPath) {
    return res.status(400).json({
      error: 'Missing model path',
      message: 'modelPath is required'
    });
  }

  // Validate that the path exists
  if (!fs.existsSync(modelPath)) {
    return res.status(400).json({
      error: 'Invalid model path',
      message: `Model path does not exist: ${modelPath}`
    });
  }

  try {
    // Set the environment variable for the Flux service
    process.env.FLUX_MODEL_PATH = modelPath;

    // Restart Flux service is not automatic - user needs to restart it
    // We just set the env var for when it next starts
    res.json({
      success: true,
      message: 'Custom Flux model path configured. Restart Flux service for changes to take effect.',
      modelPath: modelPath,
      note: 'Run: cd services && .venv/bin/python flux_service.py'
    });
  } catch (error) {
    console.error('[Flux] Error setting model path:', error);
    res.status(500).json({
      error: 'Failed to configure model path',
      message: error.message
    });
  }
});

/**
 * Helper: Download Local LLM model via the Python service
 * Proxies to the LLM service's /download endpoint for real progress tracking
 */
async function downloadLocalLLMModel(modelName, sendProgress) {
  const axios = require('axios');
  const providerConfig = require('../config/provider-config.js');
  const llmUrl = providerConfig.localLLM.apiUrl;

  // First check if LLM service is running
  try {
    await axios.get(`${llmUrl}/health`, { timeout: 5000 });
  } catch (error) {
    sendProgress({
      status: 'error',
      message: 'LLM service is not running. Start it first with: python services/llm_service.py'
    });
    return;
  }

  // Parse model name - could be "repo/model" format or just model name
  let repoId = 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF';
  let filename = '*Q4_K_M.gguf';

  if (modelName.includes('/')) {
    repoId = modelName;
  }

  sendProgress({
    status: 'info',
    progress: 0,
    message: `Requesting download from LLM service: ${repoId}...`
  });

  try {
    // Call the LLM service download endpoint with streaming
    const response = await axios.post(
      `${llmUrl}/download`,
      { repo_id: repoId, filename: filename },
      {
        responseType: 'stream',
        timeout: 600000 // 10 minute timeout for large downloads
      }
    );

    // Forward the SSE stream from Python service
    return new Promise((resolve, reject) => {
      let buffer = '';

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              sendProgress(data);
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });

      response.data.on('end', () => {
        resolve();
      });

      response.data.on('error', (err) => {
        sendProgress({
          status: 'error',
          message: `Stream error: ${err.message}`
        });
        reject(err);
      });
    });

  } catch (error) {
    sendProgress({
      status: 'error',
      message: `Download request failed: ${error.message}`
    });
  }
}

/**
 * Helper: Download Flux model via the Python service
 * Proxies to the Flux service's /download endpoint for progress tracking
 */
async function downloadFluxModel(sendProgress) {
  const axios = require('axios');
  const providerConfig = require('../config/provider-config.js');
  const fluxUrl = providerConfig.flux?.apiUrl || 'http://localhost:8001';

  // First check if Flux service is running
  try {
    await axios.get(`${fluxUrl}/health`, { timeout: 5000 });
  } catch (error) {
    sendProgress({
      status: 'error',
      message: 'Flux service is not running. Start it first with: python services/flux_service.py'
    });
    return;
  }

  // Check if model is already cached
  try {
    const statusResponse = await axios.get(`${fluxUrl}/download/status`, { timeout: 10000 });
    if (statusResponse.data.status === 'cached') {
      sendProgress({
        status: 'complete',
        progress: 100,
        message: statusResponse.data.message || 'Model already downloaded!'
      });
      return;
    }

    sendProgress({
      status: 'info',
      message: 'Flux model not cached. Starting download (~12GB, may take 10-30 minutes)...'
    });
  } catch (error) {
    sendProgress({
      status: 'info',
      message: 'Starting Flux model download...'
    });
  }

  try {
    // Call the Flux service download endpoint with streaming
    const response = await axios.post(
      `${fluxUrl}/download`,
      {},
      {
        responseType: 'stream',
        timeout: 3600000 // 1 hour timeout for large download
      }
    );

    // Forward the SSE stream from Python service
    return new Promise((resolve, reject) => {
      let buffer = '';

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              sendProgress(data);
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });

      response.data.on('end', () => {
        resolve();
      });

      response.data.on('error', (err) => {
        sendProgress({
          status: 'error',
          message: `Stream error: ${err.message}`
        });
        reject(err);
      });
    });

  } catch (error) {
    sendProgress({
      status: 'error',
      message: `Download request failed: ${error.message}`
    });
  }
}

/**
 * GET /api/providers/models
 * Get available models catalog
 */
router.get('/models', (req, res) => {
  res.json({
    localLLM: [
      {
        name: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
        displayName: 'Mistral 7B Instruct (GGUF)',
        description: 'Mistral 7B Instruct - Fast and high quality, good for prompt refinement',
        size: '~4.4 GB (Q4_K_M)',
        recommended: true,
        setupGuide: 'Automatically downloaded by Python service on first start'
      },
      {
        name: 'TheBloke/Llama-2-7B-Chat-GGUF',
        displayName: 'Llama 2 7B Chat (GGUF)',
        description: 'Llama 2 7B Chat - Conversational model, general purpose',
        size: '~4.1 GB (Q4_K_M)',
        recommended: false,
        setupGuide: 'Requires HuggingFace token for download'
      },
      {
        name: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
        displayName: 'TinyLlama 1.1B (GGUF)',
        description: 'TinyLlama 1.1B - Very fast, lower quality, good for testing',
        size: '~0.7 GB (Q4_K_M)',
        recommended: false,
        setupGuide: 'Good for CPU-only systems'
      }
    ],
    flux: [
      {
        name: 'flux-dev',
        description: 'FLUX.1-dev: Best quality, LoRA support, 20-30 steps, ~2-3min (auto fp8)',
        size: '~12 GB',
        recommended: true,
        setupGuide: 'Requires Python service setup with diffusers library'
      },
      {
        name: 'flux-schnell',
        description: 'Fast variant (4 steps, ~30s), limited LoRA ecosystem',
        size: '~12 GB',
        recommended: false,
        setupGuide: 'Requires Python service setup with diffusers library'
      }
    ],
    localVision: [
      {
        name: 'clip-vit-base-patch32',
        description: 'CLIP model for image-text alignment',
        size: '600 MB',
        recommended: true,
        setupGuide: 'Automatically downloaded by Python service on first use'
      },
      {
        name: 'aesthetic_predictor_v2_5',
        description: 'Aesthetic quality scoring model',
        size: '300 MB',
        recommended: true,
        setupGuide: 'Requires manual download and placement'
      }
    ]
  });
});

/**
 * GET /api/providers/models/recommendations
 * Get recommended models for each provider type
 */
router.get('/models/recommendations', (req, res) => {
  res.json({
    localLLM: [
      {
        name: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
        displayName: 'Mistral 7B Instruct (GGUF)',
        description: 'Mistral 7B Instruct - Fast and high quality, good for prompt refinement',
        size: '~4.4 GB (Q4_K_M)',
        recommended: true,
        setupGuide: 'Automatically downloaded by Python service on first start'
      },
      {
        name: 'TheBloke/Llama-2-7B-Chat-GGUF',
        displayName: 'Llama 2 7B Chat (GGUF)',
        description: 'Llama 2 7B Chat - Conversational model, general purpose',
        size: '~4.1 GB (Q4_K_M)',
        recommended: false,
        setupGuide: 'Requires HuggingFace token for download'
      },
      {
        name: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
        displayName: 'TinyLlama 1.1B (GGUF)',
        description: 'TinyLlama 1.1B - Very fast, lower quality, good for testing',
        size: '~0.7 GB (Q4_K_M)',
        recommended: false,
        setupGuide: 'Good for CPU-only systems'
      }
    ],
    flux: [
      {
        name: 'flux-dev',
        description: 'FLUX.1-dev: Best quality, LoRA support, 20-30 steps, ~2-3min (auto fp8)',
        size: '~12 GB',
        recommended: true,
        setupGuide: 'Requires Python service setup with diffusers library'
      },
      {
        name: 'flux-schnell',
        description: 'Fast variant (4 steps, ~30s), limited LoRA ecosystem',
        size: '~12 GB',
        recommended: false,
        setupGuide: 'Requires Python service setup with diffusers library'
      }
    ],
    localVision: [
      {
        name: 'clip-vit-base-patch32',
        description: 'CLIP model for image-text alignment',
        size: '600 MB',
        recommended: true,
        setupGuide: 'Automatically downloaded by Python service on first use'
      },
      {
        name: 'aesthetic_predictor_v2_5',
        description: 'Aesthetic quality scoring model',
        size: '300 MB',
        recommended: true,
        setupGuide: 'Requires manual download and placement'
      }
    ]
  });
});

/**
 * Service process tracking
 */
const runningServices = new Map(); // service name -> {process, port}

/**
 * Validate HF token format
 * @param {string} token - The token to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateHfToken(token) {
  if (!token) return { valid: true }; // Optional
  if (!token.startsWith('hf_')) {
    return { valid: false, error: 'HF token must start with hf_' };
  }
  if (token.length < 10) {
    return { valid: false, error: 'HF token too short' };
  }
  return { valid: true };
}

/**
 * POST /api/providers/services/start
 * Start a local service
 * Body: { service: 'local-llm'|'flux'|'vision', hfToken?: string, modelPath?: string }
 */
router.post('/services/start', async (req, res) => {
  const { service, hfToken, modelPath } = req.body;

  if (!service) {
    return res.status(400).json({
      error: 'Missing service parameter',
      message: 'Service name is required'
    });
  }

  // Validate HF token if provided
  const tokenValidation = validateHfToken(hfToken);
  if (!tokenValidation.valid) {
    return res.status(400).json({
      error: 'Invalid HF token format',
      message: tokenValidation.error
    });
  }

  try {
    const { spawn } = require('node:child_process');
    const path = require('path');

    let serviceProcess;
    let port;
    let command;
    let args;

    switch (service) {
      case 'local-llm': {
        // Check if already running
        const health = await checkLocalLLMHealth();
        if (health.available) {
          return res.json({
            status: 'already_running',
            message: 'Local LLM service is already running'
          });
        }

        const servicePath = path.join(process.cwd(), 'services', 'llm_service.py');
        // Use the virtual environment's Python
        command = path.join(process.cwd(), 'services', '.venv', 'bin', 'python');
        args = [servicePath];
        port = 8003;
        break;
      }

      case 'flux': {
        // Check if already running
        const health = await checkFluxHealth();
        if (health.available) {
          return res.json({
            status: 'already_running',
            message: 'Flux service is already running'
          });
        }

        const servicePath = path.join(process.cwd(), 'services', 'flux_service.py');
        // Use the virtual environment's Python
        command = path.join(process.cwd(), 'services', '.venv', 'bin', 'python');
        args = [servicePath];
        port = 8001;
        break;
      }

      case 'vision': {
        // Check if already running
        const health = await checkLocalVisionHealth();
        if (health.available) {
          return res.json({
            status: 'already_running',
            message: 'Local vision service is already running'
          });
        }

        const servicePath = path.join(process.cwd(), 'services', 'vision_service.py');
        // Use the virtual environment's Python
        command = path.join(process.cwd(), 'services', '.venv', 'bin', 'python');
        args = [servicePath];
        port = 8002;
        break;
      }

      default:
        return res.status(400).json({
          error: 'Invalid service',
          message: `Unknown service: ${service}`
        });
    }

    // Build environment with custom settings if provided
    const spawnEnv = { ...process.env };
    if (hfToken) {
      spawnEnv.HF_TOKEN = hfToken;
      console.log(`[Service Start] Passing HF_TOKEN to ${service} service`);
    }

    // Pass custom Flux model path if provided
    if (service === 'flux' && modelPath) {
      spawnEnv.FLUX_MODEL_PATH = modelPath;
      console.log(`[Service Start] Passing FLUX_MODEL_PATH to Flux service: ${modelPath}`);
    }

    // Spawn the service process
    serviceProcess = spawn(command, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv
    });

    // Track startup errors
    let startupError = null;

    // Log output
    serviceProcess.stdout.on('data', (data) => {
      console.log(`[${service}] ${data.toString()}`);
    });

    serviceProcess.stderr.on('data', (data) => {
      console.error(`[${service}] ${data.toString()}`);
    });

    serviceProcess.on('error', (error) => {
      console.error(`[${service}] Failed to start: ${error.message}`);
      startupError = error;
      runningServices.delete(service);
    });

    serviceProcess.on('exit', (code) => {
      console.log(`[${service}] Exited with code ${code}`);
      runningServices.delete(service);
    });

    // Store process reference
    runningServices.set(service, {
      process: serviceProcess,
      port,
      startTime: Date.now()
    });

    // Allow process to run independently
    serviceProcess.unref();

    // Wait a moment for service to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if startup failed
    if (startupError) {
      if (startupError.code === 'ENOENT') {
        const installInstructions = `Python 3 is not installed or ${command} not found in PATH`;

        return res.status(500).json({
          error: 'Command not found',
          message: installInstructions,
          service
        });
      }

      return res.status(500).json({
        error: 'Failed to start service',
        message: startupError.message,
        service
      });
    }

    res.json({
      status: 'started',
      service,
      port,
      pid: serviceProcess.pid,
      message: `${service} service started successfully`
    });

  } catch (error) {
    console.error(`[Service Start] Error starting ${service}:`, error);
    res.status(500).json({
      error: 'Failed to start service',
      message: error.message
    });
  }
});

/**
 * POST /api/providers/services/quick-start
 * Quick-start all local services with optional HF token
 * Body: { hfToken?: string, services?: string[] }
 */
router.post('/services/quick-start', async (req, res) => {
  const { hfToken, services: requestedServices } = req.body;

  // Validate HF token if provided
  const tokenValidation = validateHfToken(hfToken);
  if (!tokenValidation.valid) {
    return res.status(400).json({
      error: 'Invalid HF token format',
      message: tokenValidation.error
    });
  }

  // Default to all services if not specified (including VLM for pairwise ranking)
  const servicesToStart = requestedServices || ['flux', 'vision', 'local-llm', 'vlm'];

  console.log(`[Quick Start] Starting services: ${servicesToStart.join(', ')}`);
  if (hfToken) {
    console.log('[Quick Start] HF token provided - will be passed to services');
  }

  const results = {
    services: {},
    success: true
  };

  // Start each service
  for (const service of servicesToStart) {
    try {
      const { spawn } = require('node:child_process');
      const path = require('path');

      // Check if already running
      let health;
      let port;
      let servicePath;

      switch (service) {
        case 'flux':
          health = await checkFluxHealth();
          port = 8001;
          servicePath = path.join(process.cwd(), 'services', 'flux_service.py');
          break;
        case 'vision':
          health = await checkLocalVisionHealth();
          port = 8002;
          servicePath = path.join(process.cwd(), 'services', 'vision_service.py');
          break;
        case 'local-llm':
          health = await checkLocalLLMHealth();
          port = 8003;
          servicePath = path.join(process.cwd(), 'services', 'llm_service.py');
          break;
        case 'vlm':
          health = await checkVLMHealth();
          port = 8004;
          servicePath = path.join(process.cwd(), 'services', 'vlm_service.py');
          break;
        default:
          results.services[service] = {
            status: 'failed',
            error: `Unknown service: ${service}`
          };
          results.success = false;
          continue;
      }

      if (health.available) {
        results.services[service] = {
          status: 'already_running',
          port,
          hf_authenticated: service === 'flux' ? !!hfToken : undefined
        };
        continue;
      }

      // Build environment with HF_TOKEN if provided
      const spawnEnv = { ...process.env };
      if (hfToken) {
        spawnEnv.HF_TOKEN = hfToken;
      }

      const command = path.join(process.cwd(), 'services', '.venv', 'bin', 'python');
      const serviceProcess = spawn(command, [servicePath], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spawnEnv
      });

      serviceProcess.stdout.on('data', (data) => {
        console.log(`[${service}] ${data.toString()}`);
      });

      serviceProcess.stderr.on('data', (data) => {
        console.error(`[${service}] ${data.toString()}`);
      });

      serviceProcess.on('error', (error) => {
        console.error(`[${service}] Failed to start: ${error.message}`);
      });

      serviceProcess.unref();

      // Store process reference
      runningServices.set(service, {
        process: serviceProcess,
        port,
        startTime: Date.now()
      });

      results.services[service] = {
        status: 'started',
        port,
        pid: serviceProcess.pid,
        hf_authenticated: service === 'flux' ? !!hfToken : undefined
      };

    } catch (error) {
      console.error(`[Quick Start] Error starting ${service}:`, error);
      results.services[service] = {
        status: 'failed',
        error: error.message
      };
      results.success = false;
    }
  }

  // Poll for services to become healthy (Flux takes longer due to torch/diffusers imports)
  const maxWaitTime = 30000; // 30 seconds max wait
  const pollInterval = 2000; // Check every 2 seconds
  const startTime = Date.now();

  console.log('[Quick Start] Waiting for services to become healthy...');

  let finalChecks = [
    { available: false },
    { available: false },
    { available: false }
  ];

  // Poll until all requested services are healthy or timeout
  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    finalChecks = await Promise.all([
      servicesToStart.includes('flux') ? checkFluxHealth().catch(() => ({ available: false })) : { available: true, skipped: true },
      servicesToStart.includes('vision') ? checkLocalVisionHealth().catch(() => ({ available: false })) : { available: true, skipped: true },
      servicesToStart.includes('local-llm') ? checkLocalLLMHealth().catch(() => ({ available: false })) : { available: true, skipped: true }
    ]);

    const allHealthy = finalChecks.every(c => c.available);
    if (allHealthy) {
      console.log(`[Quick Start] All services healthy after ${Math.round((Date.now() - startTime) / 1000)}s`);
      break;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const pending = [];
    if (servicesToStart.includes('flux') && !finalChecks[0].available) pending.push('flux');
    if (servicesToStart.includes('vision') && !finalChecks[1].available) pending.push('vision');
    if (servicesToStart.includes('local-llm') && !finalChecks[2].available) pending.push('local-llm');
    console.log(`[Quick Start] Waiting for: ${pending.join(', ')} (${elapsed}s elapsed)`);
  }

  // Update results with actual health status
  if (servicesToStart.includes('flux')) {
    results.services.flux = {
      ...results.services.flux,
      running: finalChecks[0].available
    };
  }
  if (servicesToStart.includes('vision')) {
    results.services.vision = {
      ...results.services.vision,
      running: finalChecks[1].available
    };
  }
  if (servicesToStart.includes('local-llm')) {
    results.services.localLLM = results.services['local-llm'] ? {
      ...results.services['local-llm'],
      running: finalChecks[2].available
    } : results.services.localLLM;
  }

  results.message = results.success
    ? 'Local services started successfully'
    : 'Some services failed to start';

  res.json(results);
});

/**
 * Helper: Get port for a service
 */
function getServicePort(service) {
  switch (service) {
    case 'local-llm': return 8003;
    case 'flux': return 8001;
    case 'vision': return 8002;
    case 'vlm': return 8004;
    default: return null;
  }
}

/**
 * Helper: Kill process by port (for unmanaged services)
 */
async function killProcessByPort(port) {
  const { exec } = require('node:child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // Find PID listening on port
    const { stdout } = await execAsync(`lsof -t -i:${port} 2>/dev/null || true`);
    const pids = stdout.trim().split('\n').filter(p => p);

    if (pids.length === 0) {
      return { killed: false, reason: 'no_process' };
    }

    // Kill each PID
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid), 'SIGTERM');
        console.log(`[Service Stop] Sent SIGTERM to PID ${pid} on port ${port}`);
      } catch (e) {
        console.log(`[Service Stop] PID ${pid} already terminated`);
      }
    }

    // Wait and force kill if needed
    await new Promise(resolve => setTimeout(resolve, 1000));

    for (const pid of pids) {
      try {
        process.kill(parseInt(pid), 'SIGKILL');
      } catch (e) {
        // Already dead
      }
    }

    return { killed: true, pids };
  } catch (error) {
    console.error(`[Service Stop] Error killing process on port ${port}:`, error);
    return { killed: false, reason: error.message };
  }
}

/**
 * POST /api/providers/services/stop
 * Stop a local service
 * Body: { service: 'local-llm'|'flux'|'vision' }
 */
router.post('/services/stop', async (req, res) => {
  const { service } = req.body;

  if (!service) {
    return res.status(400).json({
      error: 'Missing service parameter',
      message: 'Service name is required'
    });
  }

  try {
    const serviceInfo = runningServices.get(service);

    if (serviceInfo) {
      // Kill managed process
      serviceInfo.process.kill('SIGTERM');

      // Wait a moment for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Force kill if still running
      try {
        serviceInfo.process.kill('SIGKILL');
      } catch (error) {
        // Process already terminated
      }

      runningServices.delete(service);

      res.json({
        status: 'stopped',
        service,
        message: `${service} service stopped successfully`
      });
    } else {
      // Try to kill by port (for unmanaged services started externally)
      const port = getServicePort(service);
      if (!port) {
        return res.status(400).json({
          error: 'Unknown service',
          message: `Unknown service: ${service}`
        });
      }

      const result = await killProcessByPort(port);

      if (result.killed) {
        res.json({
          status: 'stopped',
          service,
          message: `${service} service stopped (unmanaged process on port ${port})`,
          pids: result.pids
        });
      } else {
        res.json({
          status: 'not_running',
          service,
          message: `${service} service is not running on port ${port}`
        });
      }
    }

  } catch (error) {
    console.error(`[Service Stop] Error stopping ${service}:`, error);
    res.status(500).json({
      error: 'Failed to stop service',
      message: error.message
    });
  }
});

/**
 * GET /api/providers/services/status
 * Get status of all services
 */
router.get('/services/status', async (req, res) => {
  try {
    const [localLLM, flux, vision] = await Promise.all([
      checkLocalLLMHealth(),
      checkFluxHealth(),
      checkLocalVisionHealth()
    ]);

    res.json({
      localLLM: {
        running: localLLM.available,
        managed: runningServices.has('local-llm'),
        pid: runningServices.get('local-llm')?.process?.pid
      },
      flux: {
        running: flux.available,
        managed: runningServices.has('flux'),
        pid: runningServices.get('flux')?.process?.pid
      },
      vision: {
        running: vision.available,
        managed: runningServices.has('vision'),
        pid: runningServices.get('vision')?.process?.pid
      }
    });
  } catch (error) {
    console.error('[Service Status] Error:', error);
    res.status(500).json({
      error: 'Failed to get service status',
      message: error.message
    });
  }
});

/**
 * GET /api/providers/config
 * Get current provider configuration (runtime or default)
 */
router.get('/config', (req, res) => {
  res.json({
    llm: runtimeProviders.llm || providerConfig.llm.provider,
    image: runtimeProviders.image || providerConfig.image.provider,
    vision: runtimeProviders.vision || (providerConfig.vision?.provider || 'openai'),
    ranking: runtimeProviders.ranking || 'vlm' // Default to VLM for pairwise comparison
  });
});

/**
 * POST /api/providers/configure
 * Configure provider preferences at runtime
 */
router.post('/configure', (req, res) => {
  try {
    const { llm, image, vision, ranking } = req.body;

    // Validate and set runtime providers
    if (llm) {
      const validLLMs = ['openai', 'local-llm'];
      if (validLLMs.includes(llm)) {
        runtimeProviders.llm = llm;
      } else {
        return res.status(400).json({ error: `Invalid LLM provider: ${llm}` });
      }
    }

    if (image) {
      const validImageProviders = ['openai', 'flux'];
      if (validImageProviders.includes(image)) {
        runtimeProviders.image = image;
      } else {
        return res.status(400).json({ error: `Invalid image provider: ${image}` });
      }
    }

    if (vision) {
      const validVisionProviders = ['openai', 'local'];
      if (validVisionProviders.includes(vision)) {
        runtimeProviders.vision = vision;
      } else {
        return res.status(400).json({ error: `Invalid vision provider: ${vision}` });
      }
    }

    if (ranking) {
      const validRankingMethods = ['vlm', 'scoring'];
      if (validRankingMethods.includes(ranking)) {
        runtimeProviders.ranking = ranking;
      } else {
        return res.status(400).json({ error: `Invalid ranking method: ${ranking}` });
      }
    }

    res.json({
      message: 'Providers configured successfully',
      config: {
        llm: runtimeProviders.llm || providerConfig.llm.provider,
        image: runtimeProviders.image || providerConfig.image.provider,
        vision: runtimeProviders.vision || (providerConfig.vision?.provider || 'openai'),
        ranking: runtimeProviders.ranking || 'vlm'
      }
    });
  } catch (error) {
    console.error('[Providers] Configuration error:', error);
    res.status(500).json({ error: 'Failed to configure providers', message: error.message });
  }
});

/**
 * POST /api/providers/quick-local
 * Apply quick local configuration (LLM, Flux, Local Vision, VLM ranking)
 */
router.post('/quick-local', async (req, res) => {
  try {
    const { startServices } = req.body;

    // Apply quick local configuration
    runtimeProviders.llm = 'local-llm';
    runtimeProviders.image = 'flux';
    runtimeProviders.vision = 'local';
    runtimeProviders.ranking = 'vlm';

    const config = {
      llm: 'local-llm',
      image: 'flux',
      vision: 'local',
      ranking: 'vlm'
    };

    // Optionally start services
    if (startServices) {
      try {
        const servicesToStart = ['flux', 'vision', 'local-llm', 'vlm'];
        const startResults = {};

        for (const service of servicesToStart) {
          try {
            const healthCheck = await axios.get(
              `http://localhost:${getServicePort(service)}/health`,
              { timeout: 2000 }
            );
            startResults[service] = { status: 'running', available: true };
          } catch {
            startResults[service] = { status: 'not_running', available: false };
          }
        }

        res.json({
          message: 'Quick local configuration applied',
          config,
          services: startResults
        });
      } catch (error) {
        res.json({
          message: 'Quick local configuration applied (service check failed)',
          config,
          error: error.message
        });
      }
    } else {
      res.json({
        message: 'Quick local configuration applied',
        config
      });
    }
  } catch (error) {
    console.error('[Providers] Quick local error:', error);
    res.status(500).json({ error: 'Failed to apply quick local configuration' });
  }
});

/**
 * GET /api/providers/flux/discovery
 * Discover available Flux models and encoders in local directories
 * Returns a list of available models, encoders, and suggested presets
 */
router.get('/flux/discovery', async (req, res) => {
  try {
    const fs = require('fs').promises;
    const fsSync = require('fs');
    const path = require('path');

    const projectRoot = path.join(__dirname, '../../');
    const checkpointsDir = path.join(projectRoot, 'services/checkpoints');
    const encodersDir = path.join(projectRoot, 'services/encoders');
    const lorasDir = path.join(projectRoot, 'services/loras');

    // Discover available models, encoders, and LoRAs
    const models = await discoverFiles(checkpointsDir, /\.safetensors$/i);
    const encoderFiles = await discoverFiles(encodersDir, /\.safetensors$/i);
    const loraFiles = await discoverFiles(lorasDir, /\.safetensors$/i);

    // Extract encoder types from filenames
    const encoders = {
      clipL: encoderFiles.find(f => /clip[_-]?l/i.test(f)) || 'clip_l.safetensors',
      t5: encoderFiles.find(f => /model\.safetensors/i.test(f)) || 'model.safetensors',
      vae: encoderFiles.find(f => /ae\.safetensors|vae/i.test(f)) || 'ae.safetensors'
    };

    // Generate presets by matching models to encoder configurations
    const presets = generatePresets(models, encodersDir);

    res.json({
      success: true,
      models: models.map(m => ({
        name: m,
        path: `services/checkpoints/${m}`
      })),
      encoders: Object.entries(encoders).reduce((acc, [type, file]) => {
        acc[type] = {
          name: file,
          path: `services/encoders/${file}`
        };
        return acc;
      }, {}),
      loras: loraFiles.map(l => ({
        name: l,
        path: `services/loras/${l}`
      })),
      presets: presets,
      directories: {
        models: checkpointsDir,
        encoders: encodersDir,
        loras: lorasDir
      }
    });
  } catch (error) {
    console.error('[Provider Discovery] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to discover models and encoders',
      message: error.message
    });
  }
});

/**
 * GET /api/providers/flux/models
 * List available Flux models in the local checkpoints directory
 * Returns array of model names with paths
 */
router.get('/flux/models', async (req, res) => {
  try {
    const fs = require('fs').promises;
    const fsSync = require('fs');

    const projectRoot = path.join(__dirname, '../../');
    const checkpointsDir = path.join(projectRoot, 'services/checkpoints');

    // Discover available Flux models
    const models = await discoverFiles(checkpointsDir, /\.safetensors$/i);

    res.json({
      success: true,
      models: models.map(filename => ({
        name: filename,
        path: `services/checkpoints/${filename}`,
        displayName: filename.replace(/\.safetensors$/, '').replace(/_/g, ' ')
      })),
      count: models.length
    });
  } catch (error) {
    console.error('[Flux Models] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list available models',
      message: error.message
    });
  }
});

/**
 * GET /api/providers/flux/config
 * Get current Flux configuration (both .env defaults and active overrides)
 * Allows users to see what's configured and what's been overridden
 */
router.get('/flux/config', async (req, res) => {
  try {
    // .env defaults from environment
    const fluxConfig = {
      env: {
        modelPath: process.env.FLUX_MODEL_PATH || 'services/checkpoints/flux-dev-fp8.safetensors',
        loraPath: process.env.FLUX_LORA_PATH || '',
        loraScale: process.env.FLUX_LORA_SCALE || '',
        textEncoderPath: process.env.FLUX_TEXT_ENCODER_PATH || 'services/encoders/clip_l.safetensors',
        textEncoder2Path: process.env.FLUX_TEXT_ENCODER_2_PATH || 'services/encoders/model.safetensors',
        vaePath: process.env.FLUX_VAE_PATH || 'services/encoders/ae.safetensors'
      }
    };

    res.json({
      success: true,
      config: fluxConfig
    });
  } catch (error) {
    console.error('[Flux Config] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration',
      message: error.message
    });
  }
});

/**
 * Discover files in a directory matching a pattern
 */
async function discoverFiles(dirPath, pattern) {
  try {
    const fs = require('fs').promises;
    const fsSync = require('fs');

    if (!fsSync.existsSync(dirPath)) {
      return [];
    }

    const files = await fs.readdir(dirPath);
    return files.filter(f => pattern.test(f)).sort();
  } catch (error) {
    console.warn(`[Provider Discovery] Warning reading ${dirPath}:`, error.message);
    return [];
  }
}

/**
 * Generate intelligent presets by matching models with encoders using regex patterns
 */
function generatePresets(models, encodersDir) {
  const presets = [];

  // Default preset: use all models with standard encoders
  if (models.length > 0) {
    presets.push({
      name: 'Local Models with Standard Encoders',
      description: 'Use local models with the standard Flux .1 Dev encoders',
      useLocalEncoders: true,
      textEncoderPath: 'services/encoders/clip_l.safetensors',
      textEncoder2Path: 'services/encoders/model.safetensors',
      vaePath: 'services/encoders/ae.safetensors',
      models: models // Apply to all models
    });
  }

  // Smart presets: match model names to encoder patterns
  const presetPatterns = [
    {
      name: 'PixelWave',
      pattern: /pixelwave/i,
      description: 'PixelWave fine-tuned Flux model'
    },
    {
      name: 'Flux Dev',
      pattern: /flux.*dev|flux\.1.*dev/i,
      description: 'Flux .1 Dev model variants'
    }
  ];

  // For each pattern, find matching models and create presets
  presetPatterns.forEach(preset => {
    const matchedModels = models.filter(m => preset.pattern.test(m));

    if (matchedModels.length > 0) {
      presets.push({
        name: preset.name,
        description: preset.description,
        useLocalEncoders: true,
        textEncoderPath: 'services/encoders/clip_l.safetensors',
        textEncoder2Path: 'services/encoders/model.safetensors',
        vaePath: 'services/encoders/ae.safetensors',
        models: matchedModels
      });
    }
  });

  return presets;
}

/**
 * Get the current runtime providers (for use by other modules)
 */
export function getRuntimeProviders() {
  return {
    llm: runtimeProviders.llm || providerConfig.llm.provider,
    image: runtimeProviders.image || providerConfig.image.provider,
    vision: runtimeProviders.vision || (providerConfig.vision?.provider || 'openai'),
    ranking: runtimeProviders.ranking || 'vlm'
  };
}

export default router;
