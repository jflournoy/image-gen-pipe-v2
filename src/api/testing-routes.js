/**
 * Testing Ground Routes
 * Direct provider access for testing prompts without beam search.
 */

import express from 'express';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('fs').promises;
const axios = require('axios');
const OpenAI = require('openai');
const { createImageProvider } = require('../factory/provider-factory.js');
const serviceManager = require('../utils/service-manager.js');

const router = express.Router();

// Static model lists (Modal list is fetched live from provider-routes cache)
const STATIC_MODELS = {
  image: {
    openai: ['gpt-image-1', 'gpt-image-1-mini', 'dall-e-3'],
    flux: ['flux-dev', 'flux-schnell'],
    chroma: ['chroma-1-hd', 'chroma-1'],
    bfl: ['flux-2-pro', 'flux-1.1-pro', 'flux-1-dev'],
    replicate: ['black-forest-labs/flux-schnell', 'black-forest-labs/flux-dev', 'black-forest-labs/flux-1.1-pro'],
    novita: ['flux2-dev', 'flux2-schnell', 'flux2-pro'],
    modal: [] // populated at runtime from /api/providers/modal/models cache
  },
  llm: {
    openai: ['gpt-5-nano', 'gpt-5-mini', 'gpt-5', 'gpt-5.1'],
    'local-llm': [
      'mistralai/Mistral-7B-Instruct-v0.2',
      'TheBloke/Llama-2-7B-Chat-GGUF',
      'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF'
    ]
  }
};

const path = require('path');
const fsSync = require('fs');
const MODAL_CACHE_FILE = path.join(process.cwd(), '.modal-models-cache.json');

/** Read Modal models from disk cache. Returns [] if missing or malformed. */
function readModalCache() {
  try {
    if (fsSync.existsSync(MODAL_CACHE_FILE)) {
      const data = JSON.parse(fsSync.readFileSync(MODAL_CACHE_FILE, 'utf8'));
      return (data.models || []).map(m => (typeof m === 'string' ? m : m.name || m.id || String(m)));
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Derive Modal --models endpoint from the generate endpoint URL and fetch live.
 * Writes result to disk cache. Returns [] on any error.
 */
async function fetchAndCacheModalModels() {
  try {
    const generateUrl = process.env.MODAL_ENDPOINT_URL;
    if (!generateUrl) return [];

    const userMatch = generateUrl.match(/^https?:\/\/([^-]+)--/);
    if (!userMatch) return [];

    const modelsUrl = `https://${userMatch[1]}--models.modal.run/`;
    console.log('[TestingRoutes] Fetching Modal models from:', modelsUrl);

    const resp = await axios.get(modelsUrl, {
      headers: {
        'Modal-Key': process.env.MODAL_TOKEN_ID || '',
        'Modal-Secret': process.env.MODAL_TOKEN_SECRET || ''
      },
      timeout: 300000 // 5 min — Modal cold start can be slow
    });

    const models = (resp.data.models || []).map(m => (typeof m === 'string' ? m : m.name || m.id || String(m)));

    // Persist to disk so future requests use the cache
    try {
      fsSync.writeFileSync(MODAL_CACHE_FILE, JSON.stringify({ models: resp.data.models, timestamp: Date.now() }, null, 2));
      console.log('[TestingRoutes] Modal models cache written:', models.length, 'models');
    } catch (e) {
      console.warn('[TestingRoutes] Could not write Modal cache:', e.message);
    }

    return models;
  } catch (e) {
    console.warn('[TestingRoutes] Modal models fetch failed:', e.message);
    return [];
  }
}

/**
 * GET /api/testing/models
 * Returns model lists for all providers, including Modal models.
 * Reads from disk cache if available; falls back to a live fetch if cache is empty.
 */
router.get('/models', async (req, res) => {
  let modalModels = readModalCache();

  // If cache is empty and Modal is configured, do a live fetch now
  if (modalModels.length === 0 && process.env.MODAL_ENDPOINT_URL) {
    modalModels = await fetchAndCacheModalModels();
  }

  res.json({
    image: { ...STATIC_MODELS.image, modal: modalModels },
    llm: { ...STATIC_MODELS.llm }
  });
});

/**
 * POST /api/testing/image
 * Generate a single image directly using the specified provider.
 *
 * Body:
 *   - prompt (required)
 *   - provider: 'openai' | 'flux' | 'chroma' | 'bfl' | 'modal' | 'replicate' | 'novita'
 *   - model: provider-specific model name (optional)
 *   - steps: inference steps (optional)
 *   - guidance: guidance scale (optional)
 *   - seed: random seed (optional)
 *   - width / height: image dimensions (optional)
 *   - negativePrompt: negative prompt text (optional, Modal/SDXL)
 *   - sampler: sampler name (optional, Modal)
 *   - scheduler: scheduler name (optional, Modal)
 *   - clipSkip: clip skip value (optional, Modal)
 *   - flowShift: flow shift value (optional, Modal sdxl_flow)
 *   - loras: array of {path, scale} objects (optional, Modal/Flux)
 *   - openaiApiKey: required when provider is 'openai'
 */
router.post('/image', async (req, res) => {
  const {
    prompt,
    provider = 'openai',
    model,
    steps,
    guidance,
    seed,
    width,
    height,
    negativePrompt,
    sampler,
    scheduler,
    clipSkip,
    flowShift,
    loras,
    use_refiner,
    refiner_switch,
    openaiApiKey
  } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const start = Date.now();

  try {
    const providerOptions = { provider };

    if (model) providerOptions.model = model;

    // Inject API key for providers that need it
    if (provider === 'openai' || provider === 'dalle') {
      if (!openaiApiKey) {
        return res.status(400).json({ error: 'openaiApiKey is required for OpenAI provider' });
      }
      providerOptions.apiKey = openaiApiKey;
    }

    const sessionId = `test-${Date.now()}`;
    const outputDir = join(process.cwd(), 'output');

    providerOptions.sessionId = sessionId;
    providerOptions.outputDir = outputDir;

    const imageProvider = createImageProvider(providerOptions);

    const genOptions = { sessionId };
    if (steps !== undefined) genOptions.steps = steps;
    if (guidance !== undefined) genOptions.guidance = guidance;
    if (seed !== undefined) genOptions.seed = seed;
    if (width !== undefined) genOptions.width = width;
    if (height !== undefined) genOptions.height = height;
    if (negativePrompt) genOptions.negative_prompt = negativePrompt;
    if (sampler) genOptions.sampler = sampler;
    if (scheduler) genOptions.scheduler = scheduler;
    if (clipSkip !== undefined && clipSkip !== '') genOptions.clip_skip = parseInt(clipSkip, 10);
    if (flowShift !== undefined) genOptions.flow_shift = flowShift;
    if (loras && Array.isArray(loras) && loras.length > 0) genOptions.loras = loras;
    if (use_refiner !== undefined) genOptions.use_refiner = use_refiner;
    if (refiner_switch !== undefined) genOptions.refiner_switch = refiner_switch;

    const result = await imageProvider.generateImage(prompt, genOptions);

    const elapsed = Date.now() - start;

    // Get image as base64 — prefer saved file, fall back to imageUrl
    let imageData = null;
    const imagePath = result.localPath || result.imagePath;
    if (imagePath) {
      try {
        const buf = await fs.readFile(imagePath);
        imageData = buf.toString('base64');
      } catch (e) {
        console.warn('[TestingRoutes] Could not read image file', e.message);
      }
    }

    // Some providers return a URL instead of saving locally
    const imageUrl = result.imageUrl || result.url || null;
    if (!imageData && imageUrl) {
      try {
        const resp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 300000 }); // 5 min for Modal
        imageData = Buffer.from(resp.data).toString('base64');
      } catch (e) {
        console.warn('[TestingRoutes] Could not fetch image from URL', e.message);
      }
    }

    return res.json({
      success: true,
      imageData,
      imageUrl,
      imagePath,
      elapsed,
      provider,
      model: model || null,
      metadata: result.metadata || null
    });

  } catch (err) {
    console.error('[TestingRoutes] Image generation failed', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/testing/llm
 * Send a raw chat message to an LLM provider.
 *
 * Body:
 *   - messages (required): array of { role, content }
 *   - provider: 'openai' | 'local-llm'
 *   - model: model name (optional)
 *   - temperature: 0.0–1.0 (optional)
 *   - openaiApiKey: required when provider is 'openai'
 */
router.post('/llm', async (req, res) => {
  const {
    messages,
    provider = 'local-llm',
    model,
    temperature = 0.7,
    openaiApiKey
  } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const start = Date.now();

  try {
    let text = null;
    let usage = null;

    if (provider === 'openai') {
      if (!openaiApiKey) {
        return res.status(400).json({ error: 'openaiApiKey is required for OpenAI provider' });
      }

      const client = new OpenAI({ apiKey: openaiApiKey });
      const completion = await client.chat.completions.create({
        model: model || 'gpt-5-nano',
        messages,
        temperature
      });

      text = completion.choices[0]?.message?.content || '';
      usage = completion.usage;

    } else if (provider === 'local-llm') {
      const apiUrl = serviceManager.getServiceUrl('llm') || 'http://localhost:8003';
      const llmModel = model || 'mistralai/Mistral-7B-Instruct-v0.2';

      const response = await axios.post(`${apiUrl}/v1/chat/completions`, {
        model: llmModel,
        messages,
        temperature
      });

      text = response.data.choices?.[0]?.message?.content || '';
      usage = response.data.usage;

    } else {
      return res.status(400).json({ error: `Unknown LLM provider: ${provider}` });
    }

    const elapsed = Date.now() - start;

    return res.json({
      success: true,
      text,
      usage,
      elapsed,
      provider,
      model: model || null
    });

  } catch (err) {
    console.error('[TestingRoutes] LLM request failed', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
