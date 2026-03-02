/**
 * Testing Ground — frontend logic
 */

const LS_IMG_APIKEY = 'testing_openai_apikey_image';
const LS_LLM_APIKEY = 'testing_openai_apikey_llm';
const LS_IMG_PROVIDER = 'testing_img_provider';
const LS_LLM_PROVIDER = 'testing_llm_provider';
const LS_IMG_MODEL = 'testing_img_model';
const LS_LLM_MODEL = 'testing_llm_model';

// All fields to auto-save/restore via localStorage (id → key)
const LS_FIELDS = {
  'img-prompt':          'testing_img_prompt',
  'img-steps':           'testing_img_steps',
  'img-guidance':        'testing_img_guidance',
  'img-seed':            'testing_img_seed',
  'img-width':           'testing_img_width',
  'img-height':          'testing_img_height',
  'img-negative':        'testing_img_negative',
  'img-sampler':         'testing_img_sampler',
  'img-scheduler':       'testing_img_scheduler',
  'img-clipskip':        'testing_img_clipskip',
  'img-flowshift':       'testing_img_flowshift',
  'img-loras':           'testing_img_loras',
  'img-refiner-switch':  'testing_img_refiner_switch',
  'llm-system':          'testing_llm_system',
  'llm-user':            'testing_llm_user',
  'llm-temperature':     'testing_llm_temperature',
};

// Cached model lists from /api/testing/models
let modelCache = null;

// ── Tab switching ──────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Model dropdown helpers ─────────────────────────────────────────────────

function populateModelSelect(selectEl, models, savedValue) {
  selectEl.innerHTML = '';

  // Always offer a "provider default" option first
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '(provider default)';
  selectEl.appendChild(defaultOpt);

  if (!models || models.length === 0) {
    return;
  }

  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    selectEl.appendChild(opt);
  });

  // Restore saved selection if still available
  if (savedValue && models.includes(savedValue)) {
    selectEl.value = savedValue;
  } else if (models.length > 0) {
    // Default to first model (index 1, since index 0 is "provider default")
    selectEl.selectedIndex = 1;
  }
}

function updateImgModelDropdown() {
  const provider = document.getElementById('img-provider').value;
  const select = document.getElementById('img-model');
  const saved = localStorage.getItem(LS_IMG_MODEL);

  if (!modelCache) {
    select.innerHTML = '<option value="">— loading... —</option>';
    return;
  }

  const models = modelCache.image[provider] || [];
  populateModelSelect(select, models, saved);
}

function updateLlmModelDropdown() {
  const provider = document.getElementById('llm-provider').value;
  const select = document.getElementById('llm-model');
  const saved = localStorage.getItem(LS_LLM_MODEL);

  if (!modelCache) {
    select.innerHTML = '<option value="">— loading... —</option>';
    return;
  }

  const models = modelCache.llm[provider] || [];
  populateModelSelect(select, models, saved);
}

async function loadModels() {
  try {
    const resp = await fetch('/api/testing/models');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    modelCache = await resp.json();
  } catch (err) {
    console.warn('[testing] Could not load model list:', err.message);
    // Fall back to empty — user can still type a model name if we add custom input later
    modelCache = { image: {}, llm: {} };
  }
  updateImgModelDropdown();
  updateLlmModelDropdown();
}

// ── Restore saved values ───────────────────────────────────────────────────

function restoreFromStorage() {
  const restoreOne = (id, key) => {
    const v = localStorage.getItem(key);
    if (v !== null) {
      const el = document.getElementById(id);
      if (el) el.value = v;
    }
  };

  restoreOne('img-apikey', LS_IMG_APIKEY);
  restoreOne('llm-apikey', LS_LLM_APIKEY);

  const imgProvider = localStorage.getItem(LS_IMG_PROVIDER);
  if (imgProvider) document.getElementById('img-provider').value = imgProvider;

  const llmProvider = localStorage.getItem(LS_LLM_PROVIDER);
  if (llmProvider) document.getElementById('llm-provider').value = llmProvider;

  Object.entries(LS_FIELDS).forEach(([id, key]) => restoreOne(id, key));
}

// Auto-save all tracked fields on change
Object.entries(LS_FIELDS).forEach(([id, key]) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => localStorage.setItem(key, el.value));
});

// Auto-save checkbox fields separately (value doesn't capture checked state)
const refinerCheckbox = document.getElementById('img-use-refiner');
if (refinerCheckbox) {
  refinerCheckbox.addEventListener('change', () => {
    localStorage.setItem('testing_img_use_refiner', refinerCheckbox.checked ? 'true' : 'false');
  });
}

restoreFromStorage();

// Restore checkbox state
const savedUseRefiner = localStorage.getItem('testing_img_use_refiner');
if (savedUseRefiner !== null && refinerCheckbox) {
  refinerCheckbox.checked = savedUseRefiner === 'true';
}

// ── Show/hide API key fields based on provider ──────────────────────────────

// Providers that support advanced Modal-style params
const ADVANCED_PROVIDERS = new Set(['modal', 'flux', 'chroma']);

function updateImgApiKeyVisibility() {
  const provider = document.getElementById('img-provider').value;
  const row = document.getElementById('img-apikey-row');
  row.style.display = (provider === 'openai' || provider === 'dalle') ? '' : 'none';

  // Show/hide advanced params section
  const advanced = document.getElementById('img-advanced');
  advanced.style.display = ADVANCED_PROVIDERS.has(provider) ? '' : 'none';

  localStorage.setItem(LS_IMG_PROVIDER, provider);
  updateImgModelDropdown();
}

function updateLlmApiKeyVisibility() {
  const provider = document.getElementById('llm-provider').value;
  const row = document.getElementById('llm-apikey-row');
  row.style.display = (provider === 'openai') ? '' : 'none';
  localStorage.setItem(LS_LLM_PROVIDER, provider);
  updateLlmModelDropdown();
}

document.getElementById('img-provider').addEventListener('change', updateImgApiKeyVisibility);
document.getElementById('llm-provider').addEventListener('change', updateLlmApiKeyVisibility);

// Save model selections to localStorage
document.getElementById('img-model').addEventListener('change', () => {
  localStorage.setItem(LS_IMG_MODEL, document.getElementById('img-model').value);
});
document.getElementById('llm-model').addEventListener('change', () => {
  localStorage.setItem(LS_LLM_MODEL, document.getElementById('llm-model').value);
});

// Run once on load
updateImgApiKeyVisibility();
updateLlmApiKeyVisibility();

// Load models (will re-run dropdowns once data arrives)
loadModels();

// ── Image generation ────────────────────────────────────────────────────────

document.getElementById('img-generate-btn').addEventListener('click', async () => {
  const prompt = document.getElementById('img-prompt').value.trim();
  const provider = document.getElementById('img-provider').value;
  const model = document.getElementById('img-model').value.trim() || undefined;
  const steps = parseOptionalInt('img-steps');
  const guidance = parseOptionalFloat('img-guidance');
  const seed = parseOptionalInt('img-seed');
  const width = parseOptionalInt('img-width');
  const height = parseOptionalInt('img-height');
  const openaiApiKey = document.getElementById('img-apikey').value.trim() || undefined;

  // Advanced params (only read when panel is visible)
  const isAdvanced = ADVANCED_PROVIDERS.has(provider);
  const negativePrompt = isAdvanced ? document.getElementById('img-negative').value.trim() || undefined : undefined;
  const sampler = isAdvanced ? document.getElementById('img-sampler').value || undefined : undefined;
  const scheduler = isAdvanced ? document.getElementById('img-scheduler').value || undefined : undefined;
  const clipSkip = isAdvanced ? document.getElementById('img-clipskip').value || undefined : undefined;
  const flowShift = isAdvanced ? parseOptionalFloat('img-flowshift') : undefined;
  const useRefiner = isAdvanced ? document.getElementById('img-use-refiner')?.checked || false : undefined;
  const refinerSwitch = isAdvanced ? parseOptionalFloat('img-refiner-switch') : undefined;
  let loras;
  if (isAdvanced) {
    const lorasRaw = document.getElementById('img-loras').value.trim();
    if (lorasRaw) {
      try { loras = JSON.parse(lorasRaw); } catch { /* ignore malformed JSON */ }
    }
  }

  const errEl = document.getElementById('img-error');
  errEl.textContent = '';

  if (!prompt) {
    errEl.textContent = 'Prompt is required.';
    return;
  }

  if ((provider === 'openai' || provider === 'dalle') && !openaiApiKey) {
    errEl.textContent = 'OpenAI API key is required for this provider.';
    return;
  }

  if (openaiApiKey) localStorage.setItem(LS_IMG_APIKEY, openaiApiKey);
  if (model) localStorage.setItem(LS_IMG_MODEL, model);

  setImgLoading(true);
  document.getElementById('image-result').classList.add('hidden');

  try {
    const body = { prompt, provider };
    if (model) body.model = model;
    if (steps !== undefined) body.steps = steps;
    if (guidance !== undefined) body.guidance = guidance;
    if (seed !== undefined) body.seed = seed;
    if (width !== undefined) body.width = width;
    if (height !== undefined) body.height = height;
    if (openaiApiKey) body.openaiApiKey = openaiApiKey;
    if (negativePrompt) body.negativePrompt = negativePrompt;
    if (sampler) body.sampler = sampler;
    if (scheduler) body.scheduler = scheduler;
    if (clipSkip) body.clipSkip = clipSkip;
    if (flowShift !== undefined) body.flowShift = flowShift;
    if (loras) body.loras = loras;
    if (useRefiner !== undefined) body.use_refiner = useRefiner;
    if (refinerSwitch !== undefined) body.refiner_switch = refinerSwitch;

    const resp = await fetch('/api/testing/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await resp.json();

    if (!resp.ok || !data.success) {
      errEl.textContent = data.error || 'Generation failed.';
      return;
    }

    const imgEl = document.getElementById('img-output');
    const src = data.imageData
      ? 'data:image/png;base64,' + data.imageData
      : data.imageUrl;
    if (!src) {
      errEl.textContent = 'Generation succeeded but no image data was returned.';
      return;
    }
    imgEl.src = src;

    const dlLink = document.getElementById('img-download');
    dlLink.href = src;
    dlLink.download = `test-${Date.now()}.png`;

    const metaEl = document.getElementById('img-meta');
    const parts = [
      `provider: ${data.provider}`,
      data.model ? `model: ${data.model}` : null,
      `elapsed: ${(data.elapsed / 1000).toFixed(1)}s`
    ].filter(Boolean);
    metaEl.textContent = parts.join(' · ');

    document.getElementById('image-result').classList.remove('hidden');

  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    setImgLoading(false);
  }
});

function setImgLoading(on) {
  document.getElementById('img-generate-btn').disabled = on;
  document.getElementById('img-spinner').style.display = on ? '' : 'none';
}

// ── LLM ────────────────────────────────────────────────────────────────────

document.getElementById('llm-generate-btn').addEventListener('click', async () => {
  const system = document.getElementById('llm-system').value.trim();
  const user = document.getElementById('llm-user').value.trim();
  const provider = document.getElementById('llm-provider').value;
  const model = document.getElementById('llm-model').value.trim() || undefined;
  const temperature = parseFloat(document.getElementById('llm-temperature').value) || 0.7;
  const openaiApiKey = document.getElementById('llm-apikey').value.trim() || undefined;

  const errEl = document.getElementById('llm-error');
  errEl.textContent = '';

  if (!user) {
    errEl.textContent = 'User message is required.';
    return;
  }

  if (provider === 'openai' && !openaiApiKey) {
    errEl.textContent = 'OpenAI API key is required for this provider.';
    return;
  }

  if (openaiApiKey) localStorage.setItem(LS_LLM_APIKEY, openaiApiKey);
  if (model) localStorage.setItem(LS_LLM_MODEL, model);

  setLlmLoading(true);
  document.getElementById('llm-result').classList.add('hidden');

  try {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    const body = { messages, provider, temperature };
    if (model) body.model = model;
    if (openaiApiKey) body.openaiApiKey = openaiApiKey;

    const resp = await fetch('/api/testing/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await resp.json();

    if (!resp.ok || !data.success) {
      errEl.textContent = data.error || 'Request failed.';
      return;
    }

    document.getElementById('llm-text-output').textContent = data.text;

    const metaEl = document.getElementById('llm-meta');
    const parts = [
      `provider: ${data.provider}`,
      data.model ? `model: ${data.model}` : null,
      `elapsed: ${(data.elapsed / 1000).toFixed(1)}s`
    ];
    if (data.usage) {
      parts.push(`tokens: ${data.usage.prompt_tokens || 0} in / ${data.usage.completion_tokens || 0} out`);
    }
    metaEl.textContent = parts.filter(Boolean).join(' · ');

    document.getElementById('llm-result').classList.remove('hidden');

  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    setLlmLoading(false);
  }
});

function setLlmLoading(on) {
  document.getElementById('llm-generate-btn').disabled = on;
  document.getElementById('llm-spinner').style.display = on ? '' : 'none';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseOptionalInt(id) {
  const v = document.getElementById(id).value.trim();
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

function parseOptionalFloat(id) {
  const v = document.getElementById(id).value.trim();
  if (!v) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}
