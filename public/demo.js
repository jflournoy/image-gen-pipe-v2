/**
 * Beam Search Demo
 * Real-time message viewer with cost tracking and winner showcase
 */

const WS_URL = window.location.protocol === 'https:'
  ? `wss://${window.location.host}`
  : `ws://${window.location.host}`;

let ws = null;
let currentJobId = null;
let seenImages = new Set(); // Track which images we've already added

// Full candidate tracking for winner showcase
let candidates = new Map(); // candidateId -> full candidate data
let rankings = new Map();   // candidateId -> ranking data
let currentCost = { total: 0, llm: 0, vision: 0, imageGen: 0 };

// Job metadata (including lineage) from live runs
let jobMetadata = null; // Stores metadata with lineage from complete message

// Job reconnection state
let reconnectionBannerId = 'reconnection-banner';

// Connection health tracking
let isConnected = false;
let isJobRunning = false;
let lastMessageTime = Date.now();
let heartbeatCheckInterval = null;
let heartbeatWarningShown = false;

/**
 * Update connection health indicator
 * Shows spinner only when job is running AND connected
 */
function updateConnectionIndicator() {
  const indicator = document.getElementById('connectionIndicator');
  const spinner = document.getElementById('connectionSpinner');
  const statusText = document.getElementById('connectionStatus');

  if (!indicator || !spinner || !statusText) return;

  // Determine state
  const showSpinner = isJobRunning && isConnected;

  // Update spinner
  if (showSpinner) {
    spinner.classList.add('active');
  } else {
    spinner.classList.remove('active');
  }

  // Update indicator class and text
  indicator.classList.remove('connected', 'disconnected', 'active');

  if (isJobRunning && isConnected) {
    indicator.classList.add('active');
    statusText.textContent = 'Processing...';
  } else if (!isConnected && isJobRunning) {
    indicator.classList.add('disconnected');
    statusText.textContent = 'Disconnected';
  } else if (isConnected && !isJobRunning) {
    indicator.classList.add('connected');
    statusText.textContent = 'Connected';
  } else {
    statusText.textContent = 'Ready';
  }
}

/**
 * Start heartbeat monitoring to detect backend crashes
 * If no messages received for 15 seconds during job, mark as potentially crashed
 */
function startHeartbeatMonitoring() {
  // Clear any existing interval
  if (heartbeatCheckInterval) {
    clearInterval(heartbeatCheckInterval);
  }

  // Check every 10 seconds
  heartbeatCheckInterval = setInterval(() => {
    if (!isJobRunning) {
      return; // Don't check if no job running
    }

    const timeSinceLastMessage = Date.now() - lastMessageTime;
    // Use 35s timeout to accommodate initial image generation (typically 20-40s per image)
    const timeout = 35000; // 35 seconds

    if (timeSinceLastMessage > timeout && !heartbeatWarningShown) {
      console.warn('[Heartbeat] No messages for 35s, backend may have crashed');
      addMessage('⚠️ No updates received for 35s - backend may be unresponsive', 'warning');
      heartbeatWarningShown = true; // Only show warning once until messages resume

      // Update connection status but don't disconnect yet
      // (WebSocket close event will handle full disconnect)
    }
  }, 10000);
}

/**
 * Stop heartbeat monitoring
 */
function stopHeartbeatMonitoring() {
  if (heartbeatCheckInterval) {
    clearInterval(heartbeatCheckInterval);
    heartbeatCheckInterval = null;
  }
  heartbeatWarningShown = false; // Reset for next job
}

/**
 * Open image preview modal
 * @param {string} imageUrl - URL of the image to preview
 * @param {string} [imageId] - Optional identifier for the image (e.g., candidate ID)
 */
function openImageModal(imageUrl, imageId = '') {
  const modal = document.getElementById('imageModal');
  const modalImage = document.getElementById('modalImage');
  const modalInfo = document.getElementById('modalInfo');

  modalImage.src = imageUrl;
  modalInfo.textContent = imageId ? `Preview: ${imageId}` : '';
  modal.classList.add('active');

  // Allow Escape key to close
  document.addEventListener('keydown', handleEscapeKey);
}

/**
 * Close image preview modal
 */
function closeImageModal() {
  const modal = document.getElementById('imageModal');
  modal.classList.remove('active');
  document.removeEventListener('keydown', handleEscapeKey);
}

/**
 * Handle Escape key press to close modal
 */
function handleEscapeKey(event) {
  if (event.key === 'Escape') {
    closeImageModal();
  }
}

/**
 * Pricing information for models
 * LLM = text tokens, Vision = image tokens
 */
const modelPricing = {
  'gpt-5-nano': 'Input: $0.025/1M, Output: $0.0025/1M (text tokens)',
  'gpt-5-mini': 'Input: $0.125/1M, Output: $0.0125/1M (text tokens)',
  'gpt-5': 'Input: $0.625/1M, Output: $0.0625/1M (text tokens)',
  'gpt-5.1': 'Input: $0.625/1M, Output: $0.0625/1M (text tokens)',
  'gpt-image-1-mini': 'Input: $2.50/1M, Cached: $0.25/1M, Output: $8.00/1M (image tokens)',
  'gpt-image-1': 'Input: $10.00/1M, Cached: $2.50/1M, Output: $40.00/1M (image tokens)'
};

/**
 * Model pricing per-token rates (in dollars per 1M tokens)
 */
const modelRates = {
  // LLM models (text tokens)
  'gpt-5-nano': { input: 0.025, output: 0.0025 },
  'gpt-5-mini': { input: 0.125, output: 0.0125 },
  'gpt-5': { input: 0.625, output: 0.0625 },
  'gpt-5.1': { input: 0.625, output: 0.0625 },
  // Vision models (image tokens)
  'gpt-image-1-mini': { input: 2.50, output: 8.00 },
  'gpt-image-1': { input: 10.00, output: 40.00 }
};

/**
 * Estimate cost for a beam search run based on parameters
 * @param {number} n - Beam width (candidates at iteration 0)
 * @param {number} m - Keep top (candidates at subsequent iterations)
 * @param {number} maxIterations - Total iterations
 * @param {string} llmModel - LLM model name (for prompt generation)
 * @param {string} visionModel - Vision model name (for image ranking)
 * @returns {Object} { llm, vision, imageGen, total }
 */
function estimateCost(n, m, maxIterations, llmModel, visionModel) {
  // Default models if not specified
  const llm = llmModel || 'gpt-5-mini';
  const vision = visionModel || 'gpt-image-1-mini';

  // Get pricing rates, fallback to mini if not found
  const llmRate = modelRates[llm] || modelRates['gpt-5-mini'];
  const visionRate = modelRates[vision] || modelRates['gpt-image-1-mini'];

  // Estimated token counts per operation
  // These are based on typical usage patterns from beam search operations
  const llmInputTokens = 500;  // Average prompt input tokens per operation
  const llmOutputTokens = 150; // Average output tokens per operation

  const visionInputTokens = 1000;  // Image tokens for vision analysis per image
  const visionOutputTokens = 50;   // Output tokens per vision evaluation

  // Calculate number of operations
  // Iteration 0: n candidates (image generation)
  // Iterations 1+: m candidates each (image generation)
  const totalImages = n + (maxIterations - 1) * m;

  // LLM operations: expand + refine per candidate per iteration
  // Each image generation needs 2 LLM calls (expand and refine)
  const llmOperations = totalImages * 2;

  // Vision operations: one evaluation per image
  const visionOperations = totalImages;

  // Calculate costs
  const llmCost = (llmOperations * llmInputTokens * llmRate.input +
                   llmOperations * llmOutputTokens * llmRate.output) / 1_000_000;

  const visionCost = (visionOperations * visionInputTokens * visionRate.input +
                      visionOperations * visionOutputTokens * visionRate.output) / 1_000_000;

  // Image generation cost (placeholder, actual cost comes from OpenAI separately)
  // Typically ~$0.025-0.10 per image depending on model
  const imageGenCost = totalImages * 0.04; // Average estimate

  return {
    llm: llmCost,
    vision: visionCost,
    imageGen: imageGenCost,
    total: llmCost + visionCost + imageGenCost,
    breakdown: {
      totalImages,
      llmOperations,
      visionOperations
    }
  };
}

/**
 * Update the cost estimate display based on current parameters
 */
function updateCostEstimate() {
  const n = parseInt(beamWidthSelect.value) || 4;
  const m = parseInt(keepTopSelect.value) || 2;
  const maxIterations = parseInt(document.getElementById('maxIterations').value) || 5;
  const llmModel = document.getElementById('llmModel').value || 'gpt-5-mini';

  // Calculate costs for both mini and standard models
  const costMini = estimateCost(n, m, maxIterations, llmModel, 'gpt-image-1-mini');
  const costStandard = estimateCost(n, m, maxIterations, llmModel, 'gpt-image-1');

  const costSummary = document.getElementById('costSummary');
  if (costSummary) {
    const breakdown = costMini.breakdown;
    const summaryText = `With N=${n}, M=${m}, ${maxIterations} iterations: ~${breakdown.totalImages} images evaluated. ` +
                        `Estimated cost: <strong>$${costMini.total.toFixed(2)}</strong> (mini) or <strong>$${costStandard.total.toFixed(2)}</strong> (standard ranking)`;
    costSummary.innerHTML = summaryText;
  }
}

/**
 * Populate a select dropdown with model options
 * @param {string} selectId - ID of the select element
 * @param {string[]} options - Array of model option strings
 * @param {string} defaultValue - Current default model name
 */
function populateSelect(selectId, options, defaultValue) {
  const select = document.getElementById(selectId);
  if (!select) return;

  // Clear existing options except the first one (default option)
  while (select.options.length > 1) {
    select.remove(1);
  }

  // Add model options with pricing info
  options.forEach(option => {
    const optEl = document.createElement('option');
    optEl.value = option;
    optEl.textContent = option;

    // Add pricing as title tooltip
    if (modelPricing[option]) {
      optEl.title = modelPricing[option];
    }

    select.appendChild(optEl);
  });

  // Update the "Default" option text to show the actual default
  select.options[0].textContent = `Default (${defaultValue})`;
}

/**
 * Load available models from the API and populate the dropdowns
 */
async function loadAvailableModels() {
  try {
    const response = await fetch('/api/available-models');
    if (!response.ok) {
      console.warn('[Models] Failed to fetch available models:', response.status);
      return;
    }

    const data = await response.json();
    console.log('[Models] Loaded available models:', data);

    // Populate LLM model dropdown
    if (data.llm) {
      populateSelect('llmModel', data.llm.options, data.llm.default);
    }

    // Populate image generation model dropdown
    if (data.imageGen) {
      populateSelect('imageModel', data.imageGen.options, data.imageGen.default);
    }

    // Populate vision model dropdown
    if (data.vision) {
      populateSelect('visionModel', data.vision.options, data.vision.default);
    }
  } catch (error) {
    console.warn('[Models] Error loading available models:', error);
  }
}

/**
 * Close modal when clicking outside the image
 */
document.addEventListener('DOMContentLoaded', () => {
  // Restore API key from sessionStorage
  const savedApiKey = sessionStorage.getItem('openaiApiKey');
  if (savedApiKey) {
    document.getElementById('apiKey').value = savedApiKey;
  }

  // Load available models from server
  loadAvailableModels();

  // Initialize cost estimate display
  updateCostEstimate();

  const modal = document.getElementById('imageModal');
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeImageModal();
    }
  });

  // Add keyboard listener for image gallery navigation
  document.addEventListener('keydown', handleImageNavigation);
});

/**
 * Save pending job to localStorage for reconnection on page reload
 * @param {string} jobId - The job ID
 * @param {Object} params - Job parameters (n, m, maxIterations, alpha, temperature)
 */
function savePendingJob(jobId, params = {}) {
  const jobState = {
    jobId,
    startTime: new Date().toISOString(),
    params: {
      n: params.n,
      m: params.m,
      maxIterations: params.maxIterations,
      alpha: params.alpha,
      temperature: params.temperature
    }
  };
  localStorage.setItem('pendingJob', JSON.stringify(jobState));
  console.log(`[Reconnection] Saved pending job: ${jobId} with params:`, jobState.params);
}

/**
 * Clear pending job from localStorage
 */
function clearPendingJob() {
  localStorage.removeItem('pendingJob');
  console.log('[Reconnection] Cleared pending job from localStorage');
}

/**
 * Get pending job from localStorage if it exists
 */
function getPendingJob() {
  const jobData = localStorage.getItem('pendingJob');
  if (!jobData) return null;
  try {
    return JSON.parse(jobData);
  } catch (e) {
    console.warn('[Reconnection] Failed to parse pending job:', e);
    return null;
  }
}

/**
 * Build reconnection banner HTML (no leading/trailing whitespace to avoid text nodes)
 */
function buildReconnectionBanner(jobId, startTime) {
  const elapsedMs = Date.now() - new Date(startTime).getTime();
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = elapsedMinutes > 0 ? `${elapsedMinutes}m ${elapsedSeconds}s` : `${elapsedSeconds}s`;

  return `<div id="${reconnectionBannerId}" class="reconnection-banner" style="position: relative; z-index: 1000; width: 100%; box-sizing: border-box;"><div class="reconnection-content"><span>🔄 Job <strong>${jobId.substring(0, 12)}</strong> is still running</span><span class="reconnection-time">(${timeStr} elapsed)</span></div><div class="reconnection-actions"><button onclick="handleReconnect('${jobId}')" class="reconnect-btn">Reconnect</button><button onclick="handleNewJob()" class="cancel-btn">New Job</button></div></div>`;
}

/**
 * Handle reconnect button click
 */
function handleReconnect(jobId) {
  console.log(`[Reconnection] User chose to reconnect to ${jobId}`);
  const banner = document.getElementById(reconnectionBannerId);
  if (banner) banner.remove();

  currentJobId = jobId;

  // Mark job as running and start monitoring
  isJobRunning = true;
  lastMessageTime = Date.now();
  startHeartbeatMonitoring();
  updateConnectionIndicator();

  // Restore settings from the pending job state
  const pendingJob = getPendingJob();
  if (pendingJob && pendingJob.params) {
    console.log('[Reconnection] Restoring job settings:', pendingJob.params);
    if (pendingJob.params.n) beamWidthSelect.value = pendingJob.params.n;
    if (pendingJob.params.m) keepTopSelect.value = pendingJob.params.m;
    if (pendingJob.params.maxIterations) document.getElementById('maxIterations').value = pendingJob.params.maxIterations;
    if (pendingJob.params.alpha) {
      document.getElementById('alpha').value = pendingJob.params.alpha;
      document.getElementById('alphaNumber').value = pendingJob.params.alpha;
    }
    if (pendingJob.params.temperature) {
      document.getElementById('temperature').value = pendingJob.params.temperature;
      document.getElementById('temperatureNumber').value = pendingJob.params.temperature;
    }

    // Display restored settings in message
    const settingsStr = `N=${pendingJob.params.n}, M=${pendingJob.params.m}, Iterations=${pendingJob.params.maxIterations}, α=${pendingJob.params.alpha}, T=${pendingJob.params.temperature}`;
    addMessage(`🔄 Reconnecting to job: ${jobId}`, 'event');
    addMessage(`📋 Restored settings: ${settingsStr}`, 'info');
  } else {
    addMessage(`🔄 Reconnecting to job: ${jobId}`, 'event');
  }

  // Disable form inputs
  startBtn.disabled = true;
  stopBtn.disabled = false;
  document.getElementById('prompt').disabled = true;
  beamWidthSelect.disabled = true;
  keepTopSelect.disabled = true;
  document.getElementById('maxIterations').disabled = true;
  document.getElementById('alpha').disabled = true;
  document.getElementById('alphaNumber').disabled = true;
  document.getElementById('temperature').disabled = true;
  document.getElementById('temperatureNumber').disabled = true;

  // Reconnect to WebSocket
  connectWebSocket();
}

/**
 * Handle new job button click
 */
function handleNewJob() {
  console.log('[Reconnection] User chose to start a new job');
  const banner = document.getElementById(reconnectionBannerId);
  if (banner) banner.remove();

  clearPendingJob();
  addMessage('Starting new beam search...', 'event');
}

/**
 * Check for pending jobs on page load
 */
function checkForPendingJob() {
  const pendingJob = getPendingJob();
  if (!pendingJob) return;

  console.log(`[Reconnection] Found pending job: ${pendingJob.jobId}`);

  // Use setTimeout to ensure DOM is ready
  setTimeout(() => {
    // Create and show reconnection banner
    const bannerHTML = buildReconnectionBanner(pendingJob.jobId, pendingJob.startTime);

    // Insert banner at the top of the container
    const container = document.querySelector('.container');
    if (container) {
      // Parse HTML into a temporary container
      const temp = document.createElement('div');
      temp.innerHTML = bannerHTML.trim();

      // Get the banner element (should be the only child after trim)
      const bannerElement = temp.querySelector(`#${reconnectionBannerId}`);

      if (bannerElement && container.firstChild) {
        // Insert banner as the first child
        container.insertBefore(bannerElement, container.firstChild);
        console.log('[Reconnection] Banner inserted into DOM');

        // Verify visibility
        const displayed = window.getComputedStyle(bannerElement).display;
        console.log(`[Reconnection] Banner display: ${displayed}`);
      } else if (bannerElement) {
        container.appendChild(bannerElement);
        console.log('[Reconnection] Banner appended to DOM');
      } else {
        console.error('[Reconnection] Failed to parse banner element from HTML');
      }
    } else {
      console.warn('[Reconnection] Container not found for banner');
    }

    if (typeof addMessage === 'function') {
      addMessage(`🔄 Detected pending job: ${pendingJob.jobId}`, 'info');
    }
  }, 200); // Allow time for DOM to be interactive
}

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const messagesDiv = document.getElementById('messages');
const statusSpan = document.getElementById('status');
const imagesSection = document.querySelector('.images-section');
const imagesGrid = document.getElementById('images-grid');
const beamWidthSelect = document.getElementById('beamWidth');
const keepTopSelect = document.getElementById('keepTop');

/**
 * Populate keepTop dropdown with valid divisors of beamWidth
 * Valid M values: divisors of N where M <= N/2
 */
function updateKeepTopOptions() {
  const n = parseInt(beamWidthSelect.value);
  const currentM = parseInt(keepTopSelect.value) || 1;

  // Clear existing options
  keepTopSelect.innerHTML = '';

  // Find valid M values (divisors of N where M <= N/2)
  const validMs = [];
  for (let m = 1; m <= n / 2; m++) {
    if (n % m === 0) {
      validMs.push(m);
    }
  }

  // Add options with expansion ratio info
  validMs.forEach(m => {
    const option = document.createElement('option');
    option.value = m;
    const expansionRatio = n / m;
    option.textContent = `${m} (${expansionRatio} children ea.)`;
    keepTopSelect.appendChild(option);
  });

  // Try to preserve current selection, otherwise pick middle option
  if (validMs.includes(currentM)) {
    keepTopSelect.value = currentM;
  } else {
    // Pick a reasonable default (prefer 2 if available, otherwise middle)
    keepTopSelect.value = validMs.includes(2) ? 2 : validMs[Math.floor(validMs.length / 2)];
  }
}

// Initialize keepTop options and listen for beamWidth changes
beamWidthSelect.addEventListener('change', () => {
  updateKeepTopOptions();
  updateCostEstimate();
});
updateKeepTopOptions(); // Initialize on page load

// Sync alpha slider and number input
const alphaSlider = document.getElementById('alpha');
const alphaNumber = document.getElementById('alphaNumber');
const alphaValue = document.getElementById('alphaValue');

alphaSlider.addEventListener('input', (e) => {
  alphaNumber.value = e.target.value;
  alphaValue.textContent = e.target.value;
});

alphaNumber.addEventListener('change', (e) => {
  const val = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0.6));
  alphaSlider.value = val;
  alphaNumber.value = val;
  alphaValue.textContent = val.toFixed(1);
});

// Sync temperature slider and number input
const temperatureSlider = document.getElementById('temperature');
const temperatureNumber = document.getElementById('temperatureNumber');
const temperatureValue = document.getElementById('temperatureValue');

temperatureSlider.addEventListener('input', (e) => {
  temperatureNumber.value = e.target.value;
  temperatureValue.textContent = e.target.value;
});

temperatureNumber.addEventListener('change', (e) => {
  const val = Math.min(1, Math.max(0, parseFloat(e.target.value) || 1.0));
  temperatureSlider.value = val;
  temperatureNumber.value = val;
  temperatureValue.textContent = val.toFixed(2);
});

// Update cost estimate when parameters change
keepTopSelect.addEventListener('change', updateCostEstimate);
document.getElementById('maxIterations').addEventListener('change', updateCostEstimate);
document.getElementById('llmModel').addEventListener('change', updateCostEstimate);

// Format cost as currency
function formatCost(cost) {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

// Update the live cost display in the header
function updateCostDisplay() {
  let costDisplay = document.getElementById('cost-display');
  if (!costDisplay) {
    // Create cost display element if it doesn't exist
    const statusArea = document.querySelector('.messages-header > div');
    if (statusArea) {
      costDisplay = document.createElement('span');
      costDisplay.id = 'cost-display';
      costDisplay.className = 'cost-indicator';
      statusArea.insertBefore(costDisplay, statusArea.firstChild);
    }
  }

  if (costDisplay && currentCost.total > 0) {
    costDisplay.textContent = `💰 ${formatCost(currentCost.total)}`;
    costDisplay.style.display = 'inline-block';
  }
}

// Format WebSocket messages into readable summaries
function formatMessage(msg) {
  // Handle different message types
  if (msg.type === 'subscribed') {
    return { text: '✓ WebSocket subscribed', type: 'event' };
  }

  if (msg.type === 'error') {
    return { text: `✗ Error: ${msg.message || msg.error || JSON.stringify(msg)}`, type: 'error' };
  }

  if (msg.type === 'candidate' || msg.type === 'candidateProcessed') {
    const iter = msg.iteration !== undefined ? msg.iteration : '?';
    const candId = msg.candidateId !== undefined ? msg.candidateId : '?';
    const globalId = `i${iter}c${candId}`;

    // Store full candidate data for winner showcase
    // Note: candidates may be emitted twice (early for image, later with full data)
    // Use ?? to preserve existing values when new message doesn't have them
    if (msg.type === 'candidate') {
      const existing = candidates.get(globalId) || {};
      const candidateData = {
        ...existing,
        id: globalId,
        iteration: iter,
        candidateId: candId,
        // Use ?? to preserve existing value if msg doesn't have the field
        parentId: msg.parentId ?? existing.parentId,
        imageUrl: msg.imageUrl ?? existing.imageUrl,
        whatPrompt: msg.whatPrompt ?? existing.whatPrompt,
        howPrompt: msg.howPrompt ?? existing.howPrompt,
        combined: msg.combined ?? existing.combined,
        score: msg.score ?? existing.score
      };
      candidates.set(globalId, candidateData);
      console.log(`[Demo] Stored candidate ${globalId}:`, {
        parentId: candidateData.parentId,
        hasImage: !!candidateData.imageUrl,
        hasPrompts: !!candidateData.whatPrompt
      });
    }

    // Show ranking if available (tournament mode), otherwise just the candidate ID
    const rankInfo = msg.ranking?.rank ? ` | rank: #${msg.ranking.rank}` : '';
    return {
      text: `📊 Candidate ${globalId}${rankInfo}`,
      type: 'info'
    };
  }

  if (msg.type === 'iteration') {
    const current = msg.iteration !== undefined ? msg.iteration : '?';
    const total = msg.totalIterations !== undefined ? msg.totalIterations : '?';
    const candCount = msg.candidatesCount !== undefined ? msg.candidatesCount : '?';

    // Update cost from iteration event
    let costInfo = '';
    if (msg.estimatedCost) {
      currentCost = msg.estimatedCost;
      updateCostDisplay();
      costInfo = ` | 💰 ${formatCost(currentCost.total)}`;
    }

    return {
      text: `📈 Iteration ${current}/${total} | ${candCount} candidates${costInfo}`,
      type: 'event'
    };
  }

  if (msg.type === 'ranked' || msg.type === 'ranking') {
    const iter = msg.iteration !== undefined ? msg.iteration : '?';
    const candId = msg.candidateId !== undefined ? msg.candidateId : '?';
    const globalId = `i${iter}c${candId}`;
    const rank = msg.rank !== undefined ? msg.rank : '?';
    const reason = msg.reason ? ` — ${msg.reason}` : '';

    // Clear previous rankings when we see rank #1 (start of new ranking round)
    // This ensures only the FINAL iteration's rankings are kept
    if (rank === 1) {
      console.log('[Demo] New ranking round detected, clearing previous rankings');
      rankings.clear();
      // Also clear ranking data from candidates
      candidates.forEach((c, id) => {
        if (c.ranking) {
          candidates.set(id, { ...c, ranking: undefined });
        }
      });
    }

    // Store ranking data (including global rank for cross-iteration ordering)
    const rankingData = {
      rank: msg.rank,
      globalRank: msg.globalRank,
      globalRankNote: msg.globalRankNote,
      reason: msg.reason,
      strengths: msg.strengths || [],
      weaknesses: msg.weaknesses || []
    };
    rankings.set(globalId, rankingData);
    console.log(`[Demo] Stored ranking for ${globalId}:`, rankingData);

    // Update candidate with ranking
    const existing = candidates.get(globalId) || {};
    candidates.set(globalId, {
      ...existing,
      id: globalId,
      ranking: rankingData
    });

    // Display global rank if available, otherwise iteration rank
    const displayRank = msg.globalRank !== undefined ? msg.globalRank : rank;
    const tiedNote = msg.globalRankNote === 'tied_at_floor' ? ' (tied)' : '';
    return {
      text: `🏆 ${globalId} ranked #${displayRank}${tiedNote}${reason}`,
      type: 'info'
    };
  }

  // Handle global ranking updates (complete cross-iteration ranking)
  if (msg.type === 'globalRanking') {
    console.log(`[Demo] Received global ranking for iteration ${msg.iteration}:`, msg.candidates?.length, 'candidates');
    // Update candidates with global rank data
    if (msg.candidates) {
      msg.candidates.forEach(c => {
        const globalId = `i${c.iteration}c${c.candidateId}`;
        const existing = candidates.get(globalId) || {};
        const existingRanking = existing.ranking || {};
        candidates.set(globalId, {
          ...existing,
          id: globalId,
          imageUrl: c.imageUrl || existing.imageUrl,
          ranking: {
            ...existingRanking,
            globalRank: c.globalRank,
            globalRankNote: c.globalRankNote
          }
        });
      });
    }
    return {
      text: `📊 Global ranking updated (${msg.candidates?.length || 0} candidates)`,
      type: 'event'
    };
  }

  if (msg.type === 'operation') {
    // Update cost display on operations
    updateCostDisplay();

    // If backend provided a custom message, use it
    if (msg.message) {
      return {
        text: msg.message,
        type: 'info'
      };
    }

    // Otherwise construct message from parts
    const candId = msg.candidateId || '?';
    const op = msg.operation || '?';
    const status = msg.status || 'processing';
    const statusEmoji = status === 'completed' ? '✓' : '⟳';

    return {
      text: `${statusEmoji} ${op.charAt(0).toUpperCase() + op.slice(1)} ${candId}`,
      type: 'info'
    };
  }

  if (msg.type === 'step') {
    // Update running cost from step messages
    if (msg.estimatedCost) {
      currentCost = msg.estimatedCost;
      updateCostDisplay();
    }

    // Show error stage messages (candidate failures)
    if (msg.stage === 'error') {
      const candId = msg.candidateId || '?';
      return {
        text: `⚠️ ${candId}: ${msg.message || 'Candidate failed'}`,
        type: 'warning'
      };
    }

    // Show safety retry messages
    if (msg.stage === 'safety') {
      const candId = msg.candidateId || '?';
      const statusType = msg.status === 'failed' ? 'error' :
                         msg.status === 'success' ? 'event' : 'warning';
      return {
        text: msg.message || `⚠️ ${candId}: Safety retry ${msg.status}`,
        type: statusType
      };
    }

    // Don't display other step messages separately, just track cost
    return null;
  }

  if (msg.type === 'complete') {
    // Clear pending job now that it's complete
    clearPendingJob();

    // Mark job as no longer running
    isJobRunning = false;
    stopHeartbeatMonitoring();
    updateConnectionIndicator();

    // Store metadata (including lineage) from complete message
    if (msg.metadata) {
      jobMetadata = msg.metadata;
      console.log('[Demo] Stored job metadata with lineage:', jobMetadata);
    }

    // Show final cost summary
    const costSummary = currentCost.total > 0
      ? ` | Total cost: ${formatCost(currentCost.total)}`
      : '';

    // Trigger winner showcase
    setTimeout(() => showWinnerShowcase(), 100);

    return {
      text: `✅ Beam search complete${costSummary}`,
      type: 'event'
    };
  }

  if (msg.type === 'cancelled') {
    // Mark job as no longer running
    isJobRunning = false;
    stopHeartbeatMonitoring();
    updateConnectionIndicator();

    return {
      text: `⏸ Job cancelled`,
      type: 'warning'
    };
  }

  // Fallback: show raw JSON for unknown types
  return {
    text: JSON.stringify(msg),
    type: 'info'
  };
}

// Add a message to the log
function addMessage(text, type = 'info') {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${type}`;
  msgEl.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  messagesDiv.appendChild(msgEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Image gallery navigation state
let selectedImageIndex = -1;

// Get all image cards in the gallery
function getImageCards() {
  return Array.from(imagesGrid.querySelectorAll('.image-card'));
}

// Calculate grid layout: returns { cols: number of columns, rows: number of rows }
function getGridLayout() {
  const cards = getImageCards();
  if (cards.length === 0) return { cols: 0, rows: 0 };

  // Get grid dimensions from computed styles
  const gridStyle = window.getComputedStyle(imagesGrid);
  const templateColumns = gridStyle.gridTemplateColumns;

  // Count columns by splitting on spaces
  // "repeat(auto-fill, minmax(100px, 1fr))" becomes list of column widths
  const columnWidths = templateColumns.split(' ');
  const cols = columnWidths.length;

  const rows = Math.ceil(cards.length / cols);
  return { cols: Math.max(1, cols), rows };
}

// Get index of image at position (row, col) in the grid
function getIndexFromGridPosition(row, col) {
  const { cols } = getGridLayout();
  return row * cols + col;
}

// Get (row, col) position from image index
function getGridPositionFromIndex(index) {
  const { cols } = getGridLayout();
  const row = Math.floor(index / cols);
  const col = index % cols;
  return { row, col };
}

// Select image at index and scroll into view
function selectImageAtIndex(index) {
  const cards = getImageCards();
  if (index < 0 || index >= cards.length) return;

  // Clear previous selection
  if (selectedImageIndex >= 0 && selectedImageIndex < cards.length) {
    cards[selectedImageIndex].classList.remove('selected');
  }

  // Select new image
  selectedImageIndex = index;
  const selectedCard = cards[index];
  selectedCard.classList.add('selected');
  selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

  console.log(`[Nav] Selected image at index ${index}`);
}

// Handle arrow key navigation
function handleImageNavigation(event) {
  // Only handle if images are visible and gallery has cards
  if (imagesSection.style.display === 'none') return;

  const cards = getImageCards();
  if (cards.length === 0) return;

  // Start navigation if no image selected yet
  if (selectedImageIndex < 0) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      selectImageAtIndex(0);
      event.preventDefault();
    }
    return;
  }

  const { cols } = getGridLayout();
  const { row, col } = getGridPositionFromIndex(selectedImageIndex);
  let newIndex = selectedImageIndex;

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    newIndex = col > 0 ? selectedImageIndex - 1 : selectedImageIndex;
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    newIndex = col < cols - 1 && selectedImageIndex + 1 < cards.length
      ? selectedImageIndex + 1
      : selectedImageIndex;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    newIndex = row > 0 ? selectedImageIndex - cols : selectedImageIndex;
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    const newRow = row + 1;
    const newIndexCandidate = newRow * cols + col;
    newIndex = newIndexCandidate < cards.length ? newIndexCandidate : selectedImageIndex;
  } else if (event.key === 'Escape') {
    // Clear selection on Escape
    event.preventDefault();
    if (selectedImageIndex >= 0) {
      cards[selectedImageIndex].classList.remove('selected');
      selectedImageIndex = -1;
      console.log('[Nav] Cleared image selection');
    }
    return;
  }

  if (newIndex !== selectedImageIndex) {
    selectImageAtIndex(newIndex);
  }
}

// Add image thumbnail to gallery
function addImageThumbnail(iteration, candidateId, imageUrl) {
  if (!imageUrl) return;

  // Create unique key for this image
  const imageKey = `i${iteration}c${candidateId}`;

  // Skip if we've already added this image
  if (seenImages.has(imageKey)) return;
  seenImages.add(imageKey);

  // Show images section if not already visible
  if (imagesSection.style.display === 'none') {
    imagesSection.style.display = 'block';
  }

  // Create image card
  const card = document.createElement('div');
  card.className = 'image-card';
  card.title = `Iteration ${iteration}, Candidate ${candidateId}`;

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = `i${iteration}c${candidateId}`;
  img.style.cursor = 'pointer';
  img.onclick = () => {
    // On click, select this image for keyboard navigation
    const allCards = getImageCards();
    const clickedIndex = allCards.indexOf(card);
    selectImageAtIndex(clickedIndex);
  };
  img.onmouseenter = () => {
    // Show clickable state
    img.style.opacity = '0.8';
  };
  img.onmouseleave = () => {
    img.style.opacity = '1';
  };
  img.ondblclick = () => {
    // Double-click to open modal
    openImageModal(imageUrl, `i${iteration}c${candidateId}`);
  };

  const label = document.createElement('div');
  label.className = 'image-card-label';
  label.textContent = `i${iteration}c${candidateId}`;

  card.appendChild(img);
  card.appendChild(label);
  imagesGrid.appendChild(card);
}

// Clear image selection when starting new job
function clearImageSelection() {
  if (selectedImageIndex >= 0) {
    const cards = getImageCards();
    if (selectedImageIndex < cards.length) {
      cards[selectedImageIndex].classList.remove('selected');
    }
    selectedImageIndex = -1;
  }
}

// Update status indicator
function setStatus(status) {
  statusSpan.className = `status ${status}`;
  statusSpan.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

// Start beam search
async function startBeamSearch() {
  try {
    // Validate API key
    const apiKey = document.getElementById('apiKey').value?.trim();
    if (!apiKey) {
      addMessage('Error: OpenAI API key is required', 'error');
      return;
    }
    if (!apiKey.startsWith('sk-')) {
      addMessage('Error: Invalid API key format. Should start with sk-', 'error');
      return;
    }

    const prompt = document.getElementById('prompt').value.trim();
    if (!prompt) {
      addMessage('Error: Prompt is required', 'error');
      return;
    }

    // Read beam config from linked dropdowns
    const params = {
      prompt,
      n: parseInt(beamWidthSelect.value),
      m: parseInt(keepTopSelect.value),
      maxIterations: parseInt(document.getElementById('maxIterations').value),
      alpha: parseFloat(document.getElementById('alpha').value),
      temperature: parseFloat(document.getElementById('temperature').value)
    };

    // Add selected models (if user selected non-default options)
    const llmModelValue = document.getElementById('llmModel').value;
    const imageModelValue = document.getElementById('imageModel').value;
    const visionModelValue = document.getElementById('visionModel').value;

    if (llmModelValue || imageModelValue || visionModelValue) {
      params.models = {
        ...(llmModelValue && { llm: llmModelValue }),
        ...(imageModelValue && { imageGen: imageModelValue }),
        ...(visionModelValue && { vision: visionModelValue })
      };
    }

    // Reset all tracking for new job
    seenImages.clear();
    candidates.clear();
    rankings.clear();
    currentCost = { total: 0, llm: 0, vision: 0, imageGen: 0 };
    jobMetadata = null; // Reset job metadata for new job
    clearImageSelection(); // Clear any selected image
    imagesGrid.innerHTML = '';
    imagesSection.style.display = 'none';

    // Hide winner showcase if visible
    const showcaseSection = document.getElementById('showcase-section');
    if (showcaseSection) {
      showcaseSection.style.display = 'none';
    }

    // Reset cost display
    const costDisplay = document.getElementById('cost-display');
    if (costDisplay) {
      costDisplay.style.display = 'none';
      costDisplay.textContent = '';
    }

    addMessage(`Starting beam search with: N=${params.n}, M=${params.m}, Iterations=${params.maxIterations}`, 'event');
    setStatus('running');

    // Save API key to sessionStorage for this session
    sessionStorage.setItem('openaiApiKey', apiKey);

    // Start the job via API
    const response = await fetch('/api/beam-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenAI-API-Key': apiKey
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      // Try to get detailed error message from response body
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // Ignore JSON parse errors, use default message
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    currentJobId = data.jobId;
    savePendingJob(currentJobId, params); // Save job and settings for reconnection on reload
    addMessage(`Job started: ${currentJobId}`, 'event');

    // Mark job as running and start monitoring
    isJobRunning = true;
    lastMessageTime = Date.now();
    startHeartbeatMonitoring();
    updateConnectionIndicator();

    // Disable form inputs
    startBtn.disabled = true;
    stopBtn.disabled = false;
    document.getElementById('apiKey').disabled = true;
    document.getElementById('prompt').disabled = true;
    beamWidthSelect.disabled = true;
    keepTopSelect.disabled = true;
    document.getElementById('maxIterations').disabled = true;
    document.getElementById('alpha').disabled = true;
    document.getElementById('alphaNumber').disabled = true;
    document.getElementById('temperature').disabled = true;
    document.getElementById('temperatureNumber').disabled = true;

    // Connect to WebSocket
    connectWebSocket();
  } catch (err) {
    addMessage(`Error: ${err.message}`, 'error');
    setStatus('error');
  }
}

// Connect to WebSocket and listen for messages
function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      updateConnectionIndicator();
      addMessage('WebSocket connected', 'event');
      // Subscribe to this job
      ws.send(JSON.stringify({
        type: 'subscribe',
        jobId: currentJobId
      }));
      addMessage(`Subscribed to job: ${currentJobId}`, 'event');
    };

    ws.onmessage = (event) => {
      // Update last message time for heartbeat monitoring
      lastMessageTime = Date.now();
      heartbeatWarningShown = false; // Reset warning flag when messages resume

      try {
        const msg = JSON.parse(event.data);
        const formatted = formatMessage(msg);

        // formatMessage may return null for messages we track but don't display
        if (formatted) {
          addMessage(formatted.text, formatted.type);
        }

        // Handle subscription errors - job not found or already completed
        if (msg.type === 'error') {
          console.log('[Reconnection] Received error message:', msg.message);
          // Clear the stale pending job since it's no longer valid
          clearPendingJob();
        }

        // Extract and display image if this is a candidate message with an image URL
        if (msg.type === 'candidate' && msg.imageUrl) {
          const iteration = msg.iteration !== undefined ? msg.iteration : 0;
          const candidateId = msg.candidateId !== undefined ? msg.candidateId : 0;
          addImageThumbnail(iteration, candidateId, msg.imageUrl);
        }
      } catch (err) {
        addMessage(`Message parse error: ${err.message}`, 'warning');
      }
    };

    ws.onerror = (err) => {
      isConnected = false;
      updateConnectionIndicator();
      addMessage(`WebSocket error: ${err}`, 'error');
      setStatus('error');
    };

    ws.onclose = () => {
      isConnected = false;
      updateConnectionIndicator();
      addMessage('WebSocket disconnected', 'warning');
      stopBeamSearch(false); // Don't clear pending job on connection loss
    };
  } catch (err) {
    isConnected = false;
    updateConnectionIndicator();
    addMessage(`Connection error: ${err.message}`, 'error');
    setStatus('error');
  }
}

// Stop beam search
// userInitiated: true if user explicitly stopped (clear pending job), false if connection lost (preserve it)
function stopBeamSearch(userInitiated = true) {
  if (userInitiated) {
    clearPendingJob(); // Only clear when user explicitly stops the job
  }

  // Mark job as not running and stop monitoring
  isJobRunning = false;
  stopHeartbeatMonitoring();
  updateConnectionIndicator();

  currentJobId = null;
  if (ws) {
    ws.close();
    ws = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
  document.getElementById('apiKey').disabled = false;
  document.getElementById('prompt').disabled = false;
  beamWidthSelect.disabled = false;
  keepTopSelect.disabled = false;
  document.getElementById('maxIterations').disabled = false;
  document.getElementById('alpha').disabled = false;
  document.getElementById('alphaNumber').disabled = false;
  document.getElementById('temperature').disabled = false;
  document.getElementById('temperatureNumber').disabled = false;

  // Reset images gallery for next job
  clearImageSelection();
  seenImages.clear();
  imagesGrid.innerHTML = '';
  imagesSection.style.display = 'none';

  addMessage('Beam search stopped', 'event');
  setStatus('idle');
}

// Event listeners
startBtn.addEventListener('click', startBeamSearch);
stopBtn.addEventListener('click', () => stopBeamSearch(true)); // User explicitly stopping
document.getElementById('clearBtn').addEventListener('click', () => {
  messagesDiv.innerHTML = '';
  addMessage('Log cleared', 'event');
});

// Build lineage string for a candidate (traces back through parents)
function buildLineage(candidateId) {
  const parts = [];
  let current = candidateId;
  let depth = 0;
  const maxDepth = 10; // Prevent infinite loops

  while (current && depth < maxDepth) {
    parts.unshift(current);
    const candidate = candidates.get(current);

    // Check if we've hit the root (no parent) or invalid data
    if (!candidate) {
      console.log(`[Lineage] No candidate found for ${current}`);
      break;
    }
    if (candidate.parentId === null || candidate.parentId === undefined) {
      // Root candidate (iteration 0) - no parent
      break;
    }

    // Build parent ID - ensure iteration is treated as number
    const parentIteration = Number(candidate.iteration) - 1;
    if (parentIteration < 0) {
      break;
    }
    current = `i${parentIteration}c${candidate.parentId}`;
    depth++;
  }

  return parts.join(' → ');
}

// Build a summary of the ranking structure by iteration
function buildRankingSummary(allCandidates) {
  // Group candidates by iteration
  const byIteration = new Map();
  allCandidates.forEach(c => {
    const iter = c.iteration;
    if (!byIteration.has(iter)) {
      byIteration.set(iter, []);
    }
    byIteration.get(iter).push(c);
  });

  // Sort iterations
  const iterations = Array.from(byIteration.keys()).sort((a, b) => a - b);

  // Build summary HTML
  let html = '<div class="iteration-summary">';
  html += '<h4>By Iteration:</h4>';

  iterations.forEach(iter => {
    const candidates = byIteration.get(iter);
    const ranked = candidates.filter(c => c.ranking?.rank !== undefined);
    const unranked = candidates.filter(c => c.ranking?.rank === undefined);

    html += `<div class="iteration-group">`;
    html += `<strong>Iteration ${iter}</strong>: ${candidates.length} candidates`;

    if (ranked.length > 0) {
      const rankedList = ranked
        .sort((a, b) => a.ranking.rank - b.ranking.rank)
        .map(c => `${c.id} (#${c.ranking.rank})`)
        .join(', ');
      html += `<br><span class="ranked-list">Ranked: ${rankedList}</span>`;
    }

    if (unranked.length > 0) {
      const unrankedList = unranked.map(c => c.id).join(', ');
      html += `<br><span class="unranked-list">Eliminated: ${unrankedList}</span>`;
    }

    html += `</div>`;
  });

  html += '</div>';
  return html;
}

// Show winner showcase panel with top N candidates
function showWinnerShowcase() {
  // Debug: Log all stored candidates
  console.log('[Demo] All candidates in Map:', Array.from(candidates.entries()));
  console.log('[Demo] All rankings in Map:', Array.from(rankings.entries()));

  // Get ALL candidates with images, sorted by global rank (cross-iteration) if available
  const allCandidates = Array.from(candidates.values())
    .filter(c => c.imageUrl) // Must have an image
    .sort((a, b) => {
      // First sort by global rank (cross-iteration ordering, lower is better)
      // Use globalRank if available, fall back to iteration rank
      const rankA = a.ranking?.globalRank ?? a.ranking?.rank ?? 999;
      const rankB = b.ranking?.globalRank ?? b.ranking?.rank ?? 999;
      if (rankA !== rankB) return rankA - rankB;

      // Then by iteration (higher is more refined)
      if (a.iteration !== b.iteration) return b.iteration - a.iteration;

      // Then by candidateId
      return a.candidateId - b.candidateId;
    });

  console.log('[Demo] Filtered candidates with images:', allCandidates.length);
  allCandidates.forEach(c => {
    console.log(`[Demo]   ${c.id}: globalRank=${c.ranking?.globalRank}, rank=${c.ranking?.rank}, note=${c.ranking?.globalRankNote}, parentId=${c.parentId}`);
  });

  if (allCandidates.length === 0) {
    addMessage('No candidates to display', 'warning');
    return;
  }

  // Use allCandidates instead of rankedCandidates
  const rankedCandidates = allCandidates;

  // Get or create showcase section
  let showcaseSection = document.getElementById('showcase-section');
  if (!showcaseSection) {
    showcaseSection = document.createElement('div');
    showcaseSection.id = 'showcase-section';
    showcaseSection.className = 'showcase-section';
    document.querySelector('.container').appendChild(showcaseSection);
  }

  // Get current top N value (default 3)
  const topNInput = document.getElementById('topN');
  const topN = topNInput ? parseInt(topNInput.value) || 3 : 3;

  // Build showcase HTML
  const topCandidates = rankedCandidates.slice(0, topN);

  // Build full ranking summary
  const rankingSummary = buildRankingSummary(rankedCandidates);

  // Build lineage visualization if available
  // Use jobMetadata from live run, fallback to jobData from historical job, or empty
  const lineageVisualizationData = jobMetadata || allCandidates[0]?.jobData || {
    lineage: allCandidates[0]?.lineage || null,
    date: null,
    sessionId: null
  };
  const lineageHTML = buildLineageVisualization(lineageVisualizationData);

  showcaseSection.innerHTML = `
    ${lineageHTML}
    <div class="showcase-header">
      <h2>🏆 Top Results</h2>
      <div class="topn-selector">
        <label for="topN">Show top:</label>
        <input type="number" id="topN" value="${topN}" min="1" max="${rankedCandidates.length}" onchange="showWinnerShowcase()">
        <span class="total-count">of ${rankedCandidates.length}</span>
      </div>
    </div>
    <div class="showcase-cost">
      💰 Total cost: ${formatCost(currentCost.total)}
      <span class="cost-breakdown">(LLM: ${formatCost(currentCost.llm)} | Vision: ${formatCost(currentCost.vision)} | Images: ${formatCost(currentCost.imageGen)})</span>
    </div>

    <!-- Full Ranking Summary -->
    <details class="ranking-summary" open>
      <summary>📊 Full Ranking Structure (${rankedCandidates.length} candidates)</summary>
      <div class="ranking-table-container">
        <table class="ranking-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Candidate</th>
              <th>Iteration</th>
              <th>Lineage</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${rankedCandidates.map((c) => {
              const lineage = buildLineage(c.id);
              // Use globalRank for display (cross-iteration), fall back to iteration rank
              const globalRank = c.ranking?.globalRank;
              const iterRank = c.ranking?.rank;
              const rank = globalRank ?? iterRank;
              const isTiedAtFloor = c.ranking?.globalRankNote === 'tied_at_floor';
              const displayRank = rank !== undefined ? `#${rank}${isTiedAtFloor ? ' (tied)' : ''}` : `—`;
              const rankClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
              return `
                <tr class="${rank === undefined ? 'unranked-row' : ''} ${rankClass}">
                  <td class="rank-cell">${displayRank}</td>
                  <td class="candidate-cell">
                    <img src="${c.imageUrl}" alt="${c.id}" class="ranking-thumb" onclick="openImageModal('${c.imageUrl}', '${c.id}')">
                    <span>${c.id}</span>
                  </td>
                  <td class="iter-cell">iter ${c.iteration}</td>
                  <td class="lineage-cell">${lineage}</td>
                  <td class="reason-cell">${c.ranking?.reason || (rank !== undefined ? 'No reason' : 'Not ranked')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${rankingSummary}
    </details>

    <div class="showcase-grid">
      ${topCandidates.map((candidate, index) => {
        const ranking = candidate.ranking || {};
        // Use globalRank for display (cross-iteration), fall back to iteration rank
        const globalRank = ranking.globalRank;
        const iterRank = ranking.rank;
        const rank = globalRank ?? iterRank;
        const hasRank = rank !== undefined;
        const isTiedAtFloor = ranking.globalRankNote === 'tied_at_floor';
        const lineage = buildLineage(candidate.id);

        // Medal for ranked candidates, number for others
        let medal;
        if (hasRank) {
          const tiedSuffix = isTiedAtFloor ? ' (tied)' : '';
          medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}${tiedSuffix}`;
        } else {
          medal = `#${index + 1}`;
        }

        return `
          <div class="showcase-card ${index === 0 ? 'winner' : ''} ${!hasRank ? 'unranked' : ''}">
            <div class="showcase-rank">${medal}</div>
            <div class="showcase-image">
              <img src="${candidate.imageUrl}" alt="${candidate.id}" onclick="openImageModal('${candidate.imageUrl}', '${candidate.id}')">
            </div>
            <div class="showcase-id">${candidate.id}${!hasRank ? ' <span class="unranked-badge">unranked</span>' : ''}</div>

            ${hasRank ? `
              <div class="showcase-reason">${ranking.reason || 'Ranked but no reason provided'}</div>
            ` : `
              <div class="showcase-reason unranked-reason">Not in final ranking</div>
            `}

            ${ranking.strengths?.length ? `
              <div class="showcase-feedback strengths">
                <strong>✓ Strengths:</strong> ${ranking.strengths.join(', ')}
              </div>
            ` : ''}

            ${ranking.weaknesses?.length ? `
              <div class="showcase-feedback weaknesses">
                <strong>✗ Weaknesses:</strong> ${ranking.weaknesses.join(', ')}
              </div>
            ` : ''}

            <div class="showcase-lineage">
              <strong>Lineage:</strong> ${lineage}
            </div>

            <details class="showcase-prompts">
              <summary>View Prompts</summary>
              <div class="prompt-section">
                <div class="prompt-label">What (content):</div>
                <div class="prompt-text">${candidate.whatPrompt || 'N/A'}</div>
              </div>
              <div class="prompt-section">
                <div class="prompt-label">How (style):</div>
                <div class="prompt-text">${candidate.howPrompt || 'N/A'}</div>
              </div>
              <div class="prompt-section">
                <div class="prompt-label">Combined:</div>
                <div class="prompt-text">${candidate.combined || 'N/A'}</div>
              </div>
            </details>
          </div>
        `;
      }).join('')}
    </div>
  `;

  showcaseSection.style.display = 'block';

  // Scroll to showcase
  showcaseSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Build visual lineage HTML showing the winner's path from root to final
 * Displays candidate evolution across iterations
 * @param {Object} jobData - Job metadata with lineage array
 * @returns {string} HTML for the lineage visualization
 */
function buildLineageVisualization(jobData) {
  if (!jobData.lineage || jobData.lineage.length === 0) {
    return ''; // No lineage to display
  }

  const lineageSteps = jobData.lineage.map((step, idx) => {
    const isWinner = idx === jobData.lineage.length - 1;
    const imageUrl = step.imageUrl || `/api/demo/images/${jobData.date}/${jobData.sessionId}/iter${step.iteration}-cand${step.candidateId}.png`;

    return `
      <div class="lineage-step" data-iteration="${step.iteration}" data-candidate="${step.candidateId}">
        <div class="lineage-image">
          <img src="${imageUrl}" alt="i${step.iteration}c${step.candidateId}"
               onclick="openImageModal('${imageUrl}', 'i${step.iteration}c${step.candidateId}')"
               onerror="this.style.backgroundColor='#eee'">
        </div>
        <div class="lineage-label">
          <span>i${step.iteration}c${step.candidateId}</span>
          <span class="lineage-iteration">Iteration ${step.iteration}</span>
          ${isWinner ? '<span class="winner-badge">🏆 Winner</span>' : ''}
        </div>
        ${!isWinner ? '<div class="lineage-arrow"></div>' : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="lineage-section">
      <h3>🧬 Winner's Lineage - Path Through the Beam Search</h3>
      <div class="lineage-timeline">
        ${lineageSteps}
      </div>
      <p style="font-size: 12px; color: #666; margin: 10px 0 0 0;">
        Shows the winning candidate selected at each iteration, from root (iteration 0) to final winner
      </p>
    </div>
  `;
}

/**
 * Clear current state
 */
function clearState() {
  candidates.clear();
  rankings.clear();
  seenImages.clear();
  clearImageSelection();
  currentCost = { total: 0, llm: 0, vision: 0, imageGen: 0 };
  messagesDiv.innerHTML = '';
  imagesGrid.innerHTML = '';

  // Hide showcase if exists
  const showcaseSection = document.getElementById('showcase-section');
  if (showcaseSection) {
    showcaseSection.style.display = 'none';
  }
}

// Check for pending jobs and show reconnection banner if needed
checkForPendingJob();

// Initial message
addMessage('Ready. Configure parameters and click "Start Beam Search"', 'event');
