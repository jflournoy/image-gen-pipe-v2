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
let needsOpenAIKey = true; // Tracks if current providers require OpenAI API key
let lastMessageTime = Date.now();
let heartbeatCheckInterval = null;
let heartbeatWarningShown = false;

/**
 * Job History - Privacy-first localStorage tracking
 * Stores only YOUR jobs on YOUR device, no server tracking
 */

/**
 * Save a completed job to localStorage history
 * @param {Object} job - Job info {sessionId, timestamp, prompt, date}
 */
function saveJobToHistory(job) {
  try {
    const history = JSON.parse(localStorage.getItem('myJobHistory') || '[]');

    // Prevent duplicates
    if (history.some(j => j.sessionId === job.sessionId)) {
      return;
    }

    history.unshift(job); // Add to beginning (most recent first)

    // Keep only last 50 jobs
    if (history.length > 50) {
      history.length = 50;
    }

    localStorage.setItem('myJobHistory', JSON.stringify(history));
    console.log('[Job History] Saved job:', job.sessionId);

    // Update the count badge
    if (typeof updateMyJobsCount === 'function') {
      updateMyJobsCount();
    }
  } catch (error) {
    console.warn('[Job History] Failed to save:', error);
  }
}

/**
 * Get user's job history from localStorage
 * @returns {Array} Array of job objects
 */
function getJobHistory() {
  try {
    return JSON.parse(localStorage.getItem('myJobHistory') || '[]');
  } catch (error) {
    console.warn('[Job History] Failed to load:', error);
    return [];
  }
}

/**
 * Clear all job history
 */
function clearJobHistory() {
  try {
    localStorage.removeItem('myJobHistory');
    console.log('[Job History] Cleared all history');
  } catch (error) {
    console.warn('[Job History] Failed to clear:', error);
  }
}

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

// Track current image index and context for modal navigation
let currentModalImageIndex = -1;
let currentModalContext = 'grid'; // 'grid' or 'showcase'
let currentModalImageId = ''; // Track current image ID for prompt display

/**
 * Open image modal from showcase context
 * Finds the clicked image's index among all showcase images
 * @param {HTMLElement} imgElement - The clicked image element
 */
window.openShowcaseImageModal = function(imgElement) {
  const showcaseSection = document.getElementById('showcase-section');
  if (!showcaseSection) return;

  // Get all clickable images in showcase (lineage + ranking table + showcase cards)
  const lineageImages = Array.from(showcaseSection.querySelectorAll('.lineage-image img'));
  const rankingThumbs = Array.from(showcaseSection.querySelectorAll('.ranking-thumb'));
  const showcaseImages = Array.from(showcaseSection.querySelectorAll('.showcase-image img'));
  const allShowcaseImages = [...lineageImages, ...rankingThumbs, ...showcaseImages];

  const index = allShowcaseImages.indexOf(imgElement);
  const imageId = imgElement.alt || 'Showcase image';
  openImageModal(imgElement.src, imageId, index, 'showcase');
};

/**
 * Open image preview modal
 * @param {string} imageUrl - URL of the image to preview
 * @param {string} [imageId] - Optional identifier for the image (e.g., candidate ID)
 * @param {number} [imageIndex] - Index in the collection for arrow key navigation
 * @param {string} [context] - Context: 'grid' (generated images) or 'showcase' (top results)
 */
function openImageModal(imageUrl, imageId = '', imageIndex = -1, context = 'grid') {
  const modal = document.getElementById('imageModal');
  const modalImage = document.getElementById('modalImage');
  const modalInfo = document.getElementById('modalInfo');
  const showPromptsBtn = document.getElementById('showPromptsBtn');

  modalImage.src = imageUrl;
  modalInfo.textContent = imageId ? `Preview: ${imageId}` : '';
  modal.classList.add('active');
  currentModalImageIndex = imageIndex;
  currentModalContext = context;
  currentModalImageId = imageId;

  // Show/hide prompts button based on whether we have candidate data
  if (showPromptsBtn) {
    const candidate = candidates.get(imageId);
    if (candidate && (candidate.whatPrompt || candidate.howPrompt || candidate.combined)) {
      showPromptsBtn.style.display = 'block';
      showPromptsBtn.disabled = false;
    } else {
      showPromptsBtn.style.display = 'none';
    }
  }

  // Allow Escape and arrow keys for navigation
  document.addEventListener('keydown', handleModalKeydown);
}

/**
 * Close image preview modal
 */
function closeImageModal() {
  const modal = document.getElementById('imageModal');
  modal.classList.remove('active');
  currentModalImageIndex = -1;
  currentModalImageId = '';
  document.removeEventListener('keydown', handleModalKeydown);
}

/**
 * Show prompts for the currently previewed image
 */
window.showPromptsForCurrentImage = function() {
  if (!currentModalImageId) {
    console.warn('No image ID available for prompts');
    return;
  }

  const candidate = candidates.get(currentModalImageId);
  if (!candidate) {
    console.warn('No candidate data found for', currentModalImageId);
    return;
  }

  const modal = document.getElementById('promptsModal');
  const title = document.getElementById('promptsModalTitle');
  const body = document.getElementById('promptsModalBody');

  // Set title
  title.textContent = `Prompts for ${currentModalImageId}`;

  // Build prompts HTML
  let html = '';

  // Add metadata
  html += '<div class="prompt-meta">';
  html += `<strong>Candidate ID:</strong> ${currentModalImageId}<br>`;
  if (candidate.iteration !== undefined) {
    html += `<strong>Iteration:</strong> ${candidate.iteration}<br>`;
  }
  if (candidate.ranking?.rank !== undefined) {
    html += `<strong>Rank:</strong> ${candidate.ranking.rank}<br>`;
  }
  if (candidate.score !== undefined) {
    html += `<strong>Score:</strong> ${candidate.score.toFixed(4)}<br>`;
  }
  if (candidate.parentId) {
    html += `<strong>Parent:</strong> ${candidate.parentId}`;
  }
  html += '</div>';

  // Add prompts
  if (candidate.combined) {
    html += '<div class="prompt-section">';
    html += '<h3>Combined Prompt</h3>';
    html += `<p>${escapeHtml(candidate.combined)}</p>`;
    html += '</div>';
  }

  if (candidate.whatPrompt) {
    html += '<div class="prompt-section">';
    html += '<h3>What Prompt (Content)</h3>';
    html += `<p>${escapeHtml(candidate.whatPrompt)}</p>`;
    html += '</div>';
  }

  if (candidate.howPrompt) {
    html += '<div class="prompt-section">';
    html += '<h3>How Prompt (Style)</h3>';
    html += `<p>${escapeHtml(candidate.howPrompt)}</p>`;
    html += '</div>';
  }

  if (!candidate.combined && !candidate.whatPrompt && !candidate.howPrompt) {
    html += '<p style="color: #999; text-align: center;">No prompt data available for this candidate.</p>';
  }

  body.innerHTML = html;
  modal.classList.add('active');

  // Allow Escape key to close
  document.addEventListener('keydown', handlePromptsModalKeydown);
};

/**
 * Close prompts modal
 */
window.closePromptsModal = function() {
  const modal = document.getElementById('promptsModal');
  modal.classList.remove('active');
  document.removeEventListener('keydown', handlePromptsModalKeydown);
};

/**
 * Handle keyboard events for prompts modal
 */
function handlePromptsModalKeydown(e) {
  if (e.key === 'Escape') {
    window.closePromptsModal();
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get clickable images from the current context (grid or showcase)
 */
function getContextImages() {
  if (currentModalContext === 'showcase') {
    // Get all showcase images (lineage + ranking table thumbnails + showcase cards)
    const showcaseSection = document.getElementById('showcase-section');
    if (!showcaseSection) return [];
    // Combine lineage images, ranking table thumbnails, and showcase card images
    const lineageImages = Array.from(showcaseSection.querySelectorAll('.lineage-image img'));
    const rankingThumbs = Array.from(showcaseSection.querySelectorAll('.ranking-thumb'));
    const showcaseImages = Array.from(showcaseSection.querySelectorAll('.showcase-image img'));
    return [...lineageImages, ...rankingThumbs, ...showcaseImages];
  } else {
    // Get grid images (as cards for consistency with existing code)
    return getImageCards();
  }
}

/**
 * Handle keydown events in modal (Escape to close, arrows to navigate)
 */
function handleModalKeydown(event) {
  if (event.key === 'Escape') {
    closeImageModal();
    return;
  }

  // Arrow key navigation between images
  const images = getContextImages();
  if (images.length === 0 || currentModalImageIndex < 0) return;

  let newIndex = currentModalImageIndex;

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    newIndex = currentModalImageIndex > 0 ? currentModalImageIndex - 1 : currentModalImageIndex;
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    newIndex = currentModalImageIndex < images.length - 1 ? currentModalImageIndex + 1 : currentModalImageIndex;
  }

  if (newIndex !== currentModalImageIndex) {
    // Navigate to new image
    if (currentModalContext === 'showcase') {
      // Showcase images are direct img elements
      const img = images[newIndex];
      const imageId = img.alt || `Image ${newIndex + 1}`;
      openImageModal(img.src, imageId, newIndex, 'showcase');
    } else {
      // Grid images are wrapped in cards
      const card = images[newIndex];
      const img = card.querySelector('img');
      const label = card.querySelector('.image-card-label');
      if (img && label) {
        openImageModal(img.src, label.textContent, newIndex, 'grid');
      }
    }
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

  // Update iteration warning
  updateIterationWarning(n, m, maxIterations, costMini);
}

/**
 * Update the iteration warning display based on parameter combination costs
 * @param {number} n - Beam width (candidates at iteration 0)
 * @param {number} m - Keep top (candidates at subsequent iterations)
 * @param {number} maxIterations - Total iterations
 * @param {Object} costData - Cost estimation result with breakdown
 */
function updateIterationWarning(n, m, maxIterations, costData) {
  const warningBox = document.getElementById('iterationWarning');
  const warningMsg = document.getElementById('warningMessage');

  if (!warningBox || !warningMsg) return;

  // Calculate pairwise comparison count per iteration
  const comparisonsPerIteration = m * (m - 1) / 2;
  const totalComparisons = comparisonsPerIteration * (maxIterations - 1); // -1 because first iteration is generation only

  const { breakdown } = costData;
  const totalImages = breakdown.totalImages;

  // Determine if we should show warning
  let showWarning = false;
  let warningText = '';

  // Warning 1: High total images
  if (totalImages > 60) {
    showWarning = true;
    warningText = `<strong>Very High Comparison Overhead:</strong> You're evaluating ~${totalImages} images. This requires ${totalComparisons} pairwise comparisons, which is the most expensive operation. Reduce Keep Top (M=${m}) or Iterations (${maxIterations}) to lower costs.`;
  }
  // Warning 2: M too high with moderate iterations
  else if (m >= 5 && maxIterations >= 3) {
    showWarning = true;
    warningText = `<strong>Expensive Configuration:</strong> Keep Top (M=${m}) with ${maxIterations} iterations creates ${totalComparisons} comparisons. Consider reducing M to 2-4 or iterations to 2.`;
  }
  // Warning 3: Moderate high cost
  else if (totalComparisons > 30) {
    showWarning = true;
    warningText = `<strong>Elevated Comparison Cost:</strong> ${totalComparisons} pairwise comparisons needed. Each comparison uses the vision model (expensive). Consider lower Keep Top or fewer iterations.`;
  }

  if (showWarning) {
    warningMsg.innerHTML = warningText;
    warningBox.style.display = 'block';
  } else {
    warningBox.style.display = 'none';
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

  // Initialize ranking mode from localStorage or default to 'vlm'
  const savedRankingMode = localStorage.getItem('rankingMode') || 'vlm';
  const rankingModeSelect = document.getElementById('rankingMode');
  if (rankingModeSelect) {
    rankingModeSelect.value = savedRankingMode;
    // Check VLM health on page load
    updateRankingModeUI(savedRankingMode);

    // Update indicator when selection changes
    rankingModeSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      localStorage.setItem('rankingMode', mode);
      updateRankingModeUI(mode);
    });
  }
});

/**
 * Check VLM service health and update indicator
 */
async function checkVLMHealth() {
  const indicator = document.getElementById('vlmHealth');
  if (!indicator) return;

  try {
    const response = await fetch('http://localhost:8004/health', { timeout: 3000 });
    if (response.ok) {
      const data = await response.json();
      indicator.textContent = data.model_loaded ? 'VLM Ready' : 'VLM Available';
      indicator.style.background = '#4CAF50';
      indicator.style.color = 'white';
      indicator.title = `Model: ${data.model_repo || 'LLaVA'}`;
      return true;
    }
  } catch (e) {
    // Service unavailable
  }

  indicator.textContent = 'VLM Offline';
  indicator.style.background = '#f44336';
  indicator.style.color = 'white';
  indicator.title = 'VLM service not running. Start with: cd services && .venv/bin/python vlm_service.py';
  return false;
}

/**
 * Update UI based on ranking mode selection
 */
function updateRankingModeUI(mode) {
  const indicator = document.getElementById('vlmHealth');

  if (mode === 'vlm') {
    // Check VLM health when VLM mode selected
    checkVLMHealth().then(healthy => {
      if (!healthy) {
        console.warn('[Ranking] VLM mode selected but service unavailable');
      }
    });
  } else {
    // Score-based mode doesn't need VLM
    if (indicator) {
      indicator.textContent = 'Not needed';
      indicator.style.background = '#9e9e9e';
      indicator.style.color = 'white';
      indicator.title = 'Score-based ranking uses Vision scores only';
    }
  }
}

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
      maxIterations: params.iterations,
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
window.handleReconnect = function(jobId) {
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
};

/**
 * Handle new job button click
 */
window.handleNewJob = function() {
  console.log('[Reconnection] User chose to start a new job');
  const banner = document.getElementById(reconnectionBannerId);
  if (banner) banner.remove();

  clearPendingJob();
  addMessage('Starting new beam search...', 'event');
};

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
      // Check if this is an image generation message and append LoRA info if available
      if (msg.message.includes('image') && msg.status === 'starting') {
        const localLoraPath = localStorage.getItem('fluxLoraPath');
        if (localLoraPath) {
          const filename = localLoraPath.split('/').pop();
          const scale = localStorage.getItem('fluxLoraScale') || '0.8';
          return {
            text: msg.message + ` [Using LoRA: ${filename} @ ${scale}]`,
            type: 'info'
          };
        }
      }
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

    // Show step messages if they have a custom message
    // This provides visibility during long-running operations like image generation
    if (msg.message) {
      const msgType = msg.status === 'complete' ? 'event' : 'info';
      return {
        text: msg.message,
        type: msgType
      };
    }

    // Don't display generic step messages without custom message
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

      // Save to localStorage for "My Jobs" history
      saveJobToHistory({
        sessionId: msg.metadata.sessionId,
        timestamp: msg.timestamp || new Date().toISOString(),
        prompt: msg.metadata.userPrompt || jobMetadata.userPrompt || 'Unknown prompt',
        date: msg.metadata.date
      });
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
      text: '⏸ Job cancelled',
      type: 'warning'
    };
  }

  if (msg.type === 'warning') {
    return {
      text: msg.message || 'Warning',
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

// Get all image cards in the gallery
function getImageCards() {
  return Array.from(imagesGrid.querySelectorAll('.image-card'));
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
    // Single click to open modal with navigation
    const allCards = getImageCards();
    const clickedIndex = allCards.indexOf(card);
    openImageModal(imageUrl, `i${iteration}c${candidateId}`, clickedIndex);
  };
  img.onmouseenter = () => {
    // Show clickable state
    img.style.opacity = '0.8';
  };
  img.onmouseleave = () => {
    img.style.opacity = '1';
  };

  const label = document.createElement('div');
  label.className = 'image-card-label';
  label.textContent = `i${iteration}c${candidateId}`;

  card.appendChild(img);
  card.appendChild(label);
  imagesGrid.appendChild(card);
}

// Update status indicator
function setStatus(status) {
  statusSpan.className = `status ${status}`;
  statusSpan.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

// Start beam search
async function startBeamSearch() {
  try {
    // Validate API key only if OpenAI providers are being used
    const apiKey = document.getElementById('apiKey').value?.trim();
    if (needsOpenAIKey) {
      if (!apiKey) {
        addMessage('Error: OpenAI API key is required (OpenAI providers are active)', 'error');
        return;
      }
      if (!apiKey.startsWith('sk-')) {
        addMessage('Error: Invalid API key format. Should start with sk-', 'error');
        return;
      }
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
      iterations: parseInt(document.getElementById('maxIterations').value),
      alpha: parseFloat(document.getElementById('alpha').value),
      temperature: parseFloat(document.getElementById('temperature').value),
      rankingMode: document.getElementById('rankingMode')?.value || 'vlm'
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

    addMessage(`Starting beam search with: N=${params.n}, M=${params.m}, Iterations=${params.iterations}`, 'event');

    // Check and display LoRA status if using local Flux
    if (document.getElementById('imageProvider')?.value === 'flux' || document.getElementById('imageProvider')?.value === 'local') {
      const loraPath = localStorage.getItem('fluxLoraPath');
      const loraScale = localStorage.getItem('fluxLoraScale') || '0.8';
      if (loraPath) {
        const filename = loraPath.split('/').pop();
        addMessage(`🔄 Using Flux with LoRA: ${filename} (scale: ${loraScale})`, 'event');
      } else {
        addMessage('🔄 Using Flux without LoRA', 'event');
      }
    }

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
          const errorText = msg.message || msg.error || 'Unknown error';
          console.log('[Reconnection] Received error message:', errorText);
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

    // Send cancel request to backend to abort any ongoing operations in services
    if (currentJobId) {
      console.log(`[UI] User stopped job ${currentJobId}, requesting backend cancellation...`);
      fetch(`/api/demo/cancel/${currentJobId}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            console.log(`[UI] Job ${currentJobId} cancellation request sent to backend`);
            addMessage('⏹ Cancelling job and stopping service tasks...', 'event');
          }
        })
        .catch(err => console.warn(`[UI] Could not send cancellation request:`, err));
    }
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

    html += '<div class="iteration-group">';
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

    html += '</div>';
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
              const displayRank = rank !== undefined ? `#${rank}${isTiedAtFloor ? ' (tied)' : ''}` : '—';
              const rankClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
              return `
                <tr class="${rank === undefined ? 'unranked-row' : ''} ${rankClass}">
                  <td class="rank-cell">${displayRank}</td>
                  <td class="candidate-cell">
                    <img src="${c.imageUrl}" alt="${c.id}" class="ranking-thumb" onclick="openShowcaseImageModal(this)">
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
              <img src="${candidate.imageUrl}" alt="${candidate.id}" onclick="openShowcaseImageModal(this)">
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
               onclick="openShowcaseImageModal(this)"
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
 * My Jobs Modal Functions
 */

/**
 * Show My Jobs modal with user's job history
 */
function showMyJobs() {
  const modal = document.getElementById('myJobsModal');
  const jobsList = document.getElementById('myJobsList');
  const history = getJobHistory();

  if (history.length === 0) {
    jobsList.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No jobs yet. Complete a beam search to see it here!</p>';
  } else {
    jobsList.innerHTML = history.map(job => {
      const date = new Date(job.timestamp);
      const promptPreview = job.prompt.length > 80 ? job.prompt.substring(0, 80) + '...' : job.prompt;

      return `
        <div style="border: 1px solid #ddd; border-radius: 4px; padding: 15px; margin-bottom: 10px; background: #fafafa; cursor: pointer; transition: all 0.2s;"
             onmouseover="this.style.background='#f0f0f0'; this.style.borderColor='#4CAF50'"
             onmouseout="this.style.background='#fafafa'; this.style.borderColor='#ddd'"
             onclick="loadJob('${job.sessionId}')">
          <div style="font-weight: bold; margin-bottom: 5px; color: #333;">
            ${promptPreview}
          </div>
          <div style="font-size: 11px; color: #666;">
            Session: ${job.sessionId} |
            ${date.toLocaleDateString()} ${date.toLocaleTimeString()}
          </div>
        </div>
      `;
    }).join('');
  }

  modal.style.display = 'flex';
}

/**
 * Close My Jobs modal
 */
function closeMyJobsModal() {
  const modal = document.getElementById('myJobsModal');
  modal.style.display = 'none';
}

/**
 * Load a specific job (navigate to session view)
 * @param {string} sessionId - Session ID to load
 */
function loadJob(sessionId) {
  // For now, we'll show an alert. In the future, this could navigate to a session detail view
  // or trigger loading the session's showcase
  alert(`Loading session ${sessionId}...\n\nFeature coming soon: View full session details and re-display results!`);
  closeMyJobsModal();
}

/**
 * Confirm before clearing all history
 */
function confirmClearHistory() {
  if (confirm('Clear all job history?\n\nThis will remove all saved jobs from your device. This cannot be undone.')) {
    clearJobHistory();
    showMyJobs(); // Refresh the modal
  }
}

/**
 * Update My Jobs count badge
 */
function updateMyJobsCount() {
  const history = getJobHistory();
  const badge = document.getElementById('myJobsCount');

  if (history.length > 0) {
    badge.textContent = history.length;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * Provider Settings Modal Functions
 */

/**
 * Show provider settings modal and load current status
 */
async function showProviderSettings() {
  const modal = document.getElementById('providerModal');
  modal.style.display = 'flex';
  modal.classList.add('active');

  // Load saved HF token
  const savedToken = loadHfToken();
  const hfTokenInput = document.getElementById('hfTokenInput');
  if (hfTokenInput && savedToken) {
    hfTokenInput.value = savedToken;
  }

  // Load current provider status and model status
  await Promise.all([
    loadProviderStatus(),
    loadModelStatus()
  ]);

  // Update HF token status indicator
  try {
    const healthResponse = await fetch('/api/providers/health');
    const health = await healthResponse.json();
    updateHfTokenStatus(health.flux);
  } catch (e) {
    // Ignore - status will show based on token presence
    updateHfTokenStatus(null);
  }

  // Initialize mode card highlighting based on current providers
  initializeModeCardHighlighting();

  // Initialize Flux model configuration UI
  initializeFluxModelConfig();

  // Initialize Flux LoRA configuration UI
  initializeFluxLoraConfig();
}

/**
 * Initialize Flux model configuration section
 */
function initializeFluxModelConfig() {
  const imageProvider = document.getElementById('imageProvider');
  const fluxModelConfig = document.getElementById('fluxModelConfig');
  const modelSourceRadios = document.querySelectorAll('input[name="fluxModelSource"]');

  // Show/hide Flux config based on image provider selection
  if (imageProvider) {
    imageProvider.addEventListener('change', () => {
      if (imageProvider.value === 'flux') {
        fluxModelConfig.style.display = 'block';
      } else {
        fluxModelConfig.style.display = 'none';
      }
    });

    // Initial state
    if (imageProvider.value === 'flux') {
      fluxModelConfig.style.display = 'block';
    }
  }

  // Handle model source toggle (HuggingFace vs Local)
  modelSourceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      toggleFluxModelSource(radio.value);
    });
  });
}

/**
 * Toggle between HuggingFace and Local model sources
 */
function toggleFluxModelSource(source) {
  const hfSection = document.getElementById('hfModelSection');
  const localSection = document.getElementById('localModelSection');

  if (source === 'local') {
    hfSection.style.display = 'none';
    localSection.style.display = 'block';
  } else {
    hfSection.style.display = 'block';
    localSection.style.display = 'none';
  }
}

/**
 * Set custom Flux model path
 */
async function setFluxModelPath() {
  const pathInput = document.getElementById('fluxCustomPath');
  const statusDiv = document.getElementById('fluxModelPathStatus');
  const modelPath = pathInput.value.trim();

  if (!modelPath) {
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#fff3cd';
    statusDiv.style.color = '#856404';
    statusDiv.textContent = 'Please enter a model path';
    return;
  }

  // Basic client-side validation
  if (!modelPath.startsWith('/')) {
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#fff3cd';
    statusDiv.style.color = '#856404';
    statusDiv.textContent = 'Path must be absolute (start with /)';
    return;
  }

  try {
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#e3f2fd';
    statusDiv.style.color = '#1565c0';
    statusDiv.textContent = 'Setting custom model path...';

    const response = await fetch('/api/providers/flux/model-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath })
    });

    const result = await response.json();

    if (response.ok) {
      statusDiv.style.background = '#d4edda';
      statusDiv.style.color = '#155724';
      statusDiv.innerHTML = `
        <strong>✓ Success!</strong> ${result.message}<br>
        <small style="margin-top: 4px; display: block;">${result.note}</small>
      `;
      addMessage(`Custom Flux model configured: ${modelPath}`, 'event');
    } else {
      statusDiv.style.background = '#f8d7da';
      statusDiv.style.color = '#721c24';
      statusDiv.textContent = `Error: ${result.message || result.error}`;
    }
  } catch (error) {
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#f8d7da';
    statusDiv.style.color = '#721c24';
    statusDiv.textContent = `Error: ${error.message}`;
  }
}

/**
 * Display current model source in UI
 */
async function displayModelSource() {
  try {
    const response = await fetch('/api/providers/models/status');
    const status = await response.json();

    if (status.flux && status.flux.modelSource) {
      const currentHfModel = document.getElementById('currentHfModel');
      const pathInput = document.getElementById('fluxCustomPath');

      if (status.flux.modelSource === 'local' && status.flux.modelPath) {
        // Show local path
        if (pathInput) {
          pathInput.value = status.flux.modelPath;
        }
        // Select local radio button
        const localRadio = document.querySelector('input[name="fluxModelSource"][value="local"]');
        if (localRadio) {
          localRadio.checked = true;
          toggleFluxModelSource('local');
        }
      } else {
        // Show HuggingFace model
        if (currentHfModel) {
          currentHfModel.textContent = status.flux.modelName || 'FLUX.1-dev';
        }
      }
    }
  } catch (error) {
    console.error('[UI] Error displaying model source:', error);
  }
}

/**
 * Initialize Flux LoRA configuration
 */
function initializeFluxLoraConfig() {
  // Load saved settings from localStorage
  const savedLoraPath = localStorage.getItem('fluxLoraPath') || 'services/loras/flux-custom-lora.safetensors';
  const savedLoraScale = localStorage.getItem('fluxLoraScale') || '0.8';

  const loraPathInput = document.getElementById('fluxLoraPath');
  const loraScaleInput = document.getElementById('fluxLoraScale');
  const loraScaleValue = document.getElementById('fluxLoraScaleValue');

  if (loraPathInput) loraPathInput.value = savedLoraPath;
  if (loraScaleInput) loraScaleInput.value = savedLoraScale;
  if (loraScaleValue) loraScaleValue.textContent = savedLoraScale;

  // Add event listener for scale slider
  if (loraScaleInput) {
    loraScaleInput.addEventListener('input', (e) => {
      if (loraScaleValue) {
        loraScaleValue.textContent = e.target.value;
      }
    });
  }

  // Check initial status
  checkFluxLoraStatus();
}

/**
 * Save Flux LoRA settings to localStorage
 */
async function saveFluxLoraSettings() {
  const loraPathInput = document.getElementById('fluxLoraPath');
  const loraScaleInput = document.getElementById('fluxLoraScale');
  const statusText = document.getElementById('fluxLoraStatusText');

  if (!loraPathInput || !loraScaleInput) return;

  const loraPath = loraPathInput.value.trim();
  const loraScale = loraScaleInput.value;

  // Save to localStorage
  localStorage.setItem('fluxLoraPath', loraPath);
  localStorage.setItem('fluxLoraScale', loraScale);

  // Update status
  if (statusText) {
    statusText.textContent = 'Settings saved! Restart Flux service to apply.';
    statusText.style.color = '#4CAF50';
  }

  console.log('[UI] Saved LoRA settings:', { loraPath, loraScale });

  // Note: These settings will be applied when the Flux service is next started/restarted
  // The service reads from .env which should be updated with these values
}

/**
 * Check Flux LoRA status from the service
 */
async function checkFluxLoraStatus() {
  const statusText = document.getElementById('fluxLoraStatusText');

  try {
    const response = await fetch('http://localhost:8001/lora/status');
    if (!response.ok) {
      throw new Error('Service not available');
    }

    const status = await response.json();

    if (statusText) {
      if (status.loaded) {
        // LoRA is already loaded in memory
        const filename = status.path.split('/').pop();
        statusText.innerHTML = `
          <strong>✅ LoRA Active</strong><br>
          <small>File: ${filename}</small><br>
          <small>Scale: ${status.scale}</small>
        `;
        statusText.style.color = '#4CAF50';
      } else if (status.configured) {
        // LoRA is configured but not loaded yet (will load on first generation)
        const filename = status.configured_path.split('/').pop();
        statusText.innerHTML = `
          <strong>⚙️ LoRA Configured</strong><br>
          <small>File: ${filename}</small><br>
          <small>Scale: ${status.default_scale}</small><br>
          <small style="font-style: italic; color: #FF8C00;">Will load on first generation</small>
        `;
        statusText.style.color = '#FF9800';
      } else {
        // LoRA not configured
        statusText.textContent = '❌ Not configured';
        statusText.style.color = '#999';
      }
    }

    console.log('[UI] LoRA status:', status);
  } catch (error) {
    if (statusText) {
      statusText.textContent = '⚠️ Flux service not running';
      statusText.style.color = '#f44336';
    }
    console.error('[UI] Error checking LoRA status:', error);
  }
}

/**
 * Initialize mode card highlighting based on current provider selections
 */
function initializeModeCardHighlighting() {
  const llmProvider = document.getElementById('llmProvider')?.value;
  const imageProvider = document.getElementById('imageProvider')?.value;
  const visionProvider = document.getElementById('visionProvider')?.value;

  const openaiCard = document.getElementById('openaiModeCard');
  const localCard = document.getElementById('localModeCard');
  const configSection = document.getElementById('configSection');
  const localConfigSection = document.getElementById('localConfigSection');
  const advancedConfigSection = document.getElementById('advancedConfigSection');

  // Determine if user is in OpenAI mode or Local mode
  const isOpenAIMode = llmProvider === 'openai' && imageProvider === 'openai' && visionProvider === 'openai';
  const isLocalMode = llmProvider === 'local-llm' && imageProvider === 'flux' && visionProvider === 'local';

  if (isOpenAIMode) {
    // Highlight OpenAI card
    openaiCard.style.border = '3px solid #1976d2';
    openaiCard.style.boxShadow = '0 4px 12px rgba(25, 118, 210, 0.3)';
    localCard.style.border = '2px solid #81c784';
    localCard.style.boxShadow = 'none';

    // Hide config section for OpenAI mode
    configSection.style.display = 'none';
  } else if (isLocalMode) {
    // Highlight Local card
    localCard.style.border = '3px solid #388e3c';
    localCard.style.boxShadow = '0 4px 12px rgba(56, 142, 60, 0.3)';
    openaiCard.style.border = '2px solid #90caf9';
    openaiCard.style.boxShadow = 'none';

    // Show local config section
    configSection.style.display = 'block';
    localConfigSection.style.display = 'block';
    advancedConfigSection.style.display = 'none';

    // Update service statuses and start polling
    updateServiceStatuses();
    startStatusPolling();
  } else {
    // Mixed mode or initial state - no card highlighted
    openaiCard.style.border = '2px solid #90caf9';
    openaiCard.style.boxShadow = 'none';
    localCard.style.border = '2px solid #81c784';
    localCard.style.boxShadow = 'none';

    // Hide all config sections - prompt user to choose a mode
    configSection.style.display = 'none';
    localConfigSection.style.display = 'none';
    advancedConfigSection.style.display = 'none';
  }
}

/**
 * Show advanced/mixed mode configuration
 */
function showAdvancedConfig() {
  const configSection = document.getElementById('configSection');
  const localConfigSection = document.getElementById('localConfigSection');
  const advancedConfigSection = document.getElementById('advancedConfigSection');

  // Show advanced config, hide local config
  configSection.style.display = 'block';
  localConfigSection.style.display = 'none';
  advancedConfigSection.style.display = 'block';

  console.log('[UI] Switched to advanced/mixed mode configuration');
}

// Status polling interval
let statusPollingInterval = null;

/**
 * Start polling service status (every 5 seconds)
 */
function startStatusPolling() {
  // Clear any existing interval
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
  }

  // Poll every 5 seconds to detect external changes
  statusPollingInterval = setInterval(() => {
    updateServiceStatuses();
  }, 5000);

  console.log('[UI] Started status polling (5s interval)');
}

/**
 * Stop polling service status
 */
function stopStatusPolling() {
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
    console.log('[UI] Stopped status polling');
  }
}

/**
 * Close provider settings modal
 */
function closeProviderModal() {
  const modal = document.getElementById('providerModal');
  modal.style.display = 'none';
  modal.classList.remove('active');

  // Stop polling when modal closes
  stopStatusPolling();
}

/**
 * Load provider status from API
 */
async function loadProviderStatus() {
  try {
    const response = await fetch('/api/providers/status');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Update environment status
    const envStatus = document.getElementById('envStatus');
    if (data.environment.isLocal) {
      envStatus.innerHTML = '<strong style="color: #4CAF50;">Local Development</strong> - Local providers available';
    } else {
      envStatus.innerHTML = '<strong style="color: #0066cc;">Linode Server</strong> - Using OpenAI providers';
    }

    // Update provider dropdowns
    document.getElementById('llmProvider').value = data.active.llm;
    document.getElementById('imageProvider').value = data.active.image;
    document.getElementById('visionProvider').value = data.active.vision;

    // Update main form based on provider selection
    updateMainFormForProviders(data.active);

    // Update health indicators
    updateHealthIndicator('llmHealth', data.active.llm === 'local-llm' ? data.health.localLLM : { available: true, status: 'healthy' });
    updateHealthIndicator('imageHealth', data.active.image === 'flux' ? data.health.flux : { available: true, status: 'healthy' });
    updateHealthIndicator('visionHealth', data.active.vision === 'local' ? data.health.localVision : { available: true, status: 'healthy' });

    // Update service health section (old duplicate section - now removed)
    // Service controls are now in the local config section
    const serviceHealth = document.getElementById('serviceHealth');
    if (serviceHealth) {
      // This section has been removed from the UI, but keeping code for backward compatibility
      // Just show a simple status message
      serviceHealth.innerHTML = '<span style="color: #666; font-size: 12px;">Service controls are now in the Configuration section above.</span>';
    }

    // Update provider indicator in header
    updateProviderIndicator(data.active);

  } catch (error) {
    console.error('[Provider Settings] Failed to load status:', error);
    document.getElementById('envStatus').textContent = 'Error loading status';

    const serviceHealth = document.getElementById('serviceHealth');
    if (serviceHealth) {
      serviceHealth.innerHTML = '<span style="color: #f44336;">Failed to load service status</span>';
    }
  }
}

/**
 * Update health indicator badge
 */
function updateHealthIndicator(elementId, health) {
  const element = document.getElementById(elementId);
  if (!health) {
    element.textContent = 'Unknown';
    element.style.background = '#ddd';
    element.style.color = '#666';
    return;
  }

  if (health.available) {
    element.textContent = '✓ Available';
    element.style.background = '#e8f5e9';
    element.style.color = '#2e7d32';
  } else {
    element.textContent = '✗ Unavailable';
    element.style.background = '#ffebee';
    element.style.color = '#c62828';
  }
}

/**
 * Update main form elements based on active providers
 * Hides/shows API key section and model selection based on whether local providers are active
 */
function updateMainFormForProviders(activeProviders) {
  // Check if all providers are local (no OpenAI needed)
  const isFullyLocal = activeProviders.llm === 'local-llm' &&
                       activeProviders.image === 'flux' &&
                       activeProviders.vision === 'local';

  // Check if any OpenAI providers are being used
  const needsOpenAI = activeProviders.llm === 'openai' ||
                      activeProviders.image === 'openai' ||
                      activeProviders.image === 'dalle' ||
                      activeProviders.vision === 'openai' ||
                      activeProviders.vision === 'gpt-vision';

  // Update global state for startBeamSearch to use
  needsOpenAIKey = needsOpenAI;

  // Update API key section
  const apiKeyInput = document.getElementById('apiKey');
  const apiKeyRequired = document.getElementById('apiKeyRequired');
  const apiKeyHelp = document.getElementById('apiKeyHelp');
  const localModeNote = document.getElementById('localModeNote');

  if (needsOpenAI) {
    // OpenAI is needed - show required indicator
    if (apiKeyRequired) apiKeyRequired.style.display = 'inline';
    if (apiKeyHelp) apiKeyHelp.style.display = 'block';
    if (localModeNote) localModeNote.style.display = 'none';
    if (apiKeyInput) apiKeyInput.placeholder = 'sk-... (required)';
  } else {
    // Fully local - API key not required
    if (apiKeyRequired) apiKeyRequired.style.display = 'none';
    if (apiKeyHelp) apiKeyHelp.style.display = 'none';
    if (localModeNote) localModeNote.style.display = 'block';
    if (apiKeyInput) apiKeyInput.placeholder = 'Not required for local providers';
  }

  // Update model selection section
  const modelSection = document.getElementById('modelSelectionSection');
  if (modelSection) {
    if (isFullyLocal) {
      modelSection.style.display = 'none';
    } else {
      modelSection.style.display = 'block';
    }
  }
}

/**
 * Apply provider settings changes
 */
/**
 * Select mode (OpenAI or Local) and update all providers accordingly
 */
function selectMode(mode) {
  // Update mode card visuals
  const openaiCard = document.getElementById('openaiModeCard');
  const localCard = document.getElementById('localModeCard');
  const configSection = document.getElementById('configSection');
  const localConfigSection = document.getElementById('localConfigSection');
  const advancedConfigSection = document.getElementById('advancedConfigSection');

  if (mode === 'openai') {
    // Highlight OpenAI card
    openaiCard.style.border = '3px solid #1976d2';
    openaiCard.style.boxShadow = '0 4px 12px rgba(25, 118, 210, 0.3)';
    localCard.style.border = '2px solid #81c784';
    localCard.style.boxShadow = 'none';

    // Set all providers to OpenAI
    document.getElementById('llmProvider').value = 'openai';
    document.getElementById('imageProvider').value = 'openai';
    document.getElementById('visionProvider').value = 'openai';
    document.getElementById('rankingMode').value = 'scoring'; // OpenAI doesn't use VLM

    // Hide configuration (OpenAI needs no local setup)
    configSection.style.display = 'none';

    // Stop all local services when switching to OpenAI mode
    stopAllLocalServices();
  } else if (mode === 'local') {
    // Highlight Local card
    localCard.style.border = '3px solid #388e3c';
    localCard.style.boxShadow = '0 4px 12px rgba(56, 142, 60, 0.3)';
    openaiCard.style.border = '2px solid #90caf9';
    openaiCard.style.boxShadow = 'none';

    // Set all providers to Local
    document.getElementById('llmProvider').value = 'local-llm';
    document.getElementById('imageProvider').value = 'flux';
    document.getElementById('visionProvider').value = 'local';
    document.getElementById('rankingMode').value = 'vlm'; // Local can use VLM

    // Show local configuration with checkboxes
    configSection.style.display = 'block';
    localConfigSection.style.display = 'block';
    advancedConfigSection.style.display = 'none';

    // Update service status indicators
    updateServiceStatuses();
  }

  // Don't auto-apply - let user review config and click Apply when ready
  // Users can now explore mode options without closing the modal
}

/**
 * Update service status indicators in local config
 */
async function updateServiceStatuses() {
  try {
    const response = await fetch('/api/services/status');
    const services = await response.json();

    // Update status indicators based on actual service process status
    const llmStatus = document.getElementById('llmStatus');
    const fluxStatus = document.getElementById('fluxStatus');
    const visionStatus = document.getElementById('visionStatus');
    const vlmStatus = document.getElementById('vlmStatus');

    if (llmStatus) {
      llmStatus.textContent = services.llm?.running ? '🟢' : '⚪';
      llmStatus.title = services.llm?.running ? `Running (PID: ${services.llm.pid})` : 'Stopped';
    }
    if (fluxStatus) {
      fluxStatus.textContent = services.flux?.running ? '🟢' : '⚪';
      fluxStatus.title = services.flux?.running ? `Running (PID: ${services.flux.pid})` : 'Stopped';
    }
    if (visionStatus) {
      visionStatus.textContent = services.vision?.running ? '🟢' : '⚪';
      visionStatus.title = services.vision?.running ? `Running (PID: ${services.vision.pid})` : 'Stopped';
    }
    if (vlmStatus) {
      vlmStatus.textContent = services.vlm?.running ? '🟢' : '⚪';
      vlmStatus.title = services.vlm?.running ? `Running (PID: ${services.vlm.pid})` : 'Stopped';
    }
  } catch (error) {
    console.error('[UI] Error updating service statuses:', error);
  }
}

/**
 * Update ranking mode based on user selection
 */
function updateRankingMode() {
  const rankingMode = document.querySelector('input[name="rankingMode"]:checked')?.value;
  if (rankingMode) {
    document.getElementById('rankingMode').value = rankingMode;
    console.log('[UI] Ranking mode updated to:', rankingMode);
  }
}

/**
 * Start a specific service (Settings Modal)
 */
async function startServiceInModal(serviceName) {
  try {
    console.log(`[UI Modal] Starting ${serviceName} service...`);

    // Set status to "starting" immediately
    setServiceStatus(serviceName, 'starting', 'Starting...');

    // Get HF token from localStorage (if set)
    const hfToken = getHfToken();

    const response = await fetch(`/api/services/${serviceName}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hfToken })
    });

    let result;
    try {
      result = await response.json();
    } catch (parseError) {
      console.error(`[UI Modal] Failed to parse response from ${serviceName} start:`, parseError);
      setServiceStatus(serviceName, 'error', 'Invalid response from server');
      alert(`Error starting ${serviceName}: Invalid response from server. Check console for details.`);
      return;
    }

    if (response.ok) {
      // Service started successfully
      console.log(`[UI Modal] ${serviceName} service process started (PID: ${result.pid}), waiting for service to be ready...`);
      // Poll service health until ready (especially important for Flux which takes 30-40s to load models)
      await pollServiceUntilReady(serviceName);
    } else if (response.status === 409) {
      // Service already running - this is not an error, just poll to confirm it's healthy
      console.log(`[UI Modal] ${serviceName} service is already running, confirming health...`);
      await pollServiceUntilReady(serviceName, 3); // Quick poll with fewer attempts
    } else {
      // Actual error starting the service
      console.error(`[UI Modal] Failed to start ${serviceName}:`, result);
      const errorMsg = result.error || result.message || 'Unknown error';
      setServiceStatus(serviceName, 'error', `Failed to start: ${errorMsg}`);
      alert(`Failed to start ${serviceName} service:\n\n${errorMsg}\n\nCheck browser console for more details.`);
    }
  } catch (error) {
    console.error(`[UI Modal] Error starting ${serviceName}:`, error);
    setServiceStatus(serviceName, 'error', `Error: ${error.message}`);
    alert(`Error starting ${serviceName} service. Check console for details.`);
  }
}

/**
 * Poll a service's health endpoint until it's ready
 */
async function pollServiceUntilReady(serviceName, maxAttempts = 30) {
  const portMap = { llm: 8003, flux: 8001, vision: 8002, vlm: 8004 };
  const port = portMap[serviceName];

  if (!port) {
    console.warn(`[UI Modal] Unknown service ${serviceName}, skipping health poll`);
    await updateServiceStatuses();
    return;
  }

  let attempts = 0;
  const pollInterval = 2000; // 2 seconds
  const requestTimeout = 3000; // 3 second timeout per attempt

  while (attempts < maxAttempts) {
    attempts++;

    try {
      // Create AbortController for timeout (more compatible than AbortSignal.timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

      const healthResponse = await fetch(`http://localhost:${port}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (healthResponse.ok) {
        const health = await healthResponse.json();
        console.log(`[UI Modal] ${serviceName} service is ready after ${attempts} attempts (${attempts * pollInterval / 1000}s)`);
        setServiceStatus(serviceName, 'running', `Running (PID: ${health.pid || 'unknown'})`);
        return; // Success!
      } else {
        console.warn(`[UI Modal] ${serviceName} health check returned ${healthResponse.status}, retrying...`);
      }
    } catch (error) {
      // Service not ready yet, continue polling
      console.log(`[UI Modal] ${serviceName} not ready yet (attempt ${attempts}/${maxAttempts}):`, error.message);
      const elapsed = attempts * pollInterval / 1000;
      setServiceStatus(serviceName, 'starting', `Starting... (${elapsed}s)`);

      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
  }

  // Max attempts reached, service didn't become ready
  const timeoutSecs = maxAttempts * pollInterval / 1000;
  console.error(`[UI Modal] ${serviceName} service failed to become ready after ${timeoutSecs}s`);
  setServiceStatus(serviceName, 'error', 'Failed to start (timeout)');
  alert(`${serviceName} service failed to start within ${timeoutSecs} seconds.\n\nPossible causes:\n- Service crashed during startup\n- Port is in use by another process\n- Python dependencies not installed\n\nCheck browser console for details.`);
}

/**
 * Set service status indicator
 */
function setServiceStatus(serviceName, state, title) {
  const statusElement = document.getElementById(`${serviceName}Status`);
  if (!statusElement) return;

  const stateIcons = {
    running: '🟢',
    stopped: '⚪',
    starting: '🟡',
    error: '🔴'
  };

  statusElement.textContent = stateIcons[state] || '⚪';
  statusElement.title = title;
}

/**
 * Stop a specific service (Settings Modal)
 */
async function stopServiceInModal(serviceName) {
  try {
    console.log(`[UI Modal] Stopping ${serviceName} service...`);

    const response = await fetch(`/api/services/${serviceName}/stop`, {
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[UI Modal] ${serviceName} service stopped:`, result);
      await updateServiceStatuses();
    } else {
      const error = await response.json();
      console.error(`[UI Modal] Failed to stop ${serviceName}:`, error);
      alert(`Failed to stop ${serviceName} service: ${error.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[UI Modal] Error stopping ${serviceName}:`, error);
    alert(`Error stopping ${serviceName} service. Check console for details.`);
  }
}

/**
 * Restart a specific service (Settings Modal)
 */
async function restartServiceInModal(serviceName) {
  try {
    console.log(`[UI Modal] Restarting ${serviceName} service...`);

    // Stop then start
    await stopServiceInModal(serviceName);

    // Wait a moment before starting
    await new Promise(resolve => setTimeout(resolve, 1000));

    await startServiceInModal(serviceName);
  } catch (error) {
    console.error(`[UI Modal] Error restarting ${serviceName}:`, error);
    alert(`Error restarting ${serviceName} service. Check console for details.`);
  }
}

/**
 * Stop all local services (used when switching to OpenAI mode)
 */
async function stopAllLocalServices() {
  const services = ['llm', 'flux', 'vision', 'vlm'];

  console.log('[UI Modal] Stopping all local services...');

  // Stop all services in parallel
  const stopPromises = services.map(service =>
    stopServiceInModal(service).catch(err => {
      console.warn(`[UI Modal] Failed to stop ${service}:`, err);
      // Don't fail if one service can't be stopped
    })
  );

  await Promise.allSettled(stopPromises);
  console.log('[UI Modal] All local services stopped');
}

/**
 * Apply quick local configuration (LLM + Flux + Local Vision + VLM Ranking)
 */
async function applyQuickLocalSettings() {
  const quickLocalBtn = document.getElementById('quickLocalBtn');
  quickLocalBtn.disabled = true;
  quickLocalBtn.textContent = '⚡ Applying...';

  try {
    // Update UI selectors to reflect quick local settings
    document.getElementById('llmProvider').value = 'local-llm';
    document.getElementById('imageProvider').value = 'flux';
    document.getElementById('visionProvider').value = 'local';
    document.getElementById('rankingMode').value = 'vlm';

    // Call API to apply configuration
    const response = await fetch('/api/providers/quick-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startServices: false })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    await response.json();

    // Show success message
    addMessage(
      '✓ Quick Local configured: Local LLM + Flux + Local Vision + VLM Ranking',
      'event'
    );

    // Update indicator
    updateProviderIndicator({
      llm: 'local-llm',
      image: 'flux',
      vision: 'local'
    });

    // Update main form
    updateMainFormForProviders({
      llm: 'local-llm',
      image: 'flux',
      vision: 'local'
    });

    closeProviderModal();

  } catch (error) {
    console.error('[Quick Local] Failed to apply:', error);
    alert(`Failed to apply Quick Local configuration:\n\n${error.message}`);
  } finally {
    quickLocalBtn.disabled = false;
    quickLocalBtn.textContent = '⚡ Quick Local';
  }
}

async function applyProviderSettings() {
  const applyBtn = document.getElementById('applyProvidersBtn');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying...';

  try {
    const llm = document.getElementById('llmProvider').value;
    const image = document.getElementById('imageProvider').value;
    const vision = document.getElementById('visionProvider').value;

    const response = await fetch('/api/providers/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm, image, vision })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Show success message
    addMessage(`✓ Providers updated: LLM=${data.active.llm}, Image=${data.active.image}, Vision=${data.active.vision}`, 'event');

    // Update indicator and close modal
    updateProviderIndicator(data.active);

    // Update main form (API key requirements, model selection visibility)
    updateMainFormForProviders(data.active);

    closeProviderModal();

  } catch (error) {
    console.error('[Provider Settings] Failed to apply settings:', error);
    alert(`Failed to switch providers:\n\n${error.message}\n\nMake sure local services are running if you're switching to local providers.`);
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = 'Apply Changes';
  }
}

/**
 * Update provider indicator in header
 */
function updateProviderIndicator(active) {
  const indicator = document.getElementById('providerIndicator');

  // Check if any local providers are active
  const hasLocal = active.llm === 'local-llm' || active.image === 'flux' || active.vision === 'local';
  const allOpenAI = active.llm === 'openai' && active.image === 'openai' && active.vision === 'openai';

  if (hasLocal) {
    indicator.style.background = '#FFA500'; // Orange for mixed/local
    indicator.style.display = 'block';
    indicator.title = 'Using local providers';
  } else if (allOpenAI) {
    indicator.style.background = '#4CAF50'; // Green for all OpenAI
    indicator.style.display = 'block';
    indicator.title = 'Using OpenAI providers';
  } else {
    indicator.style.display = 'none';
  }
}

/**
 * Model Management Functions
 */

/**
 * Load and display model status
 */
async function loadModelStatus() {
  const modelSection = document.getElementById('modelManagementSection');
  const modelContent = document.getElementById('modelStatusContent');

  try {
    // Show model section if local environment
    const statusResponse = await fetch('/api/providers/status');
    const statusData = await statusResponse.json();

    if (statusData.environment.isLocal) {
      modelSection.style.display = 'block';
    } else {
      modelSection.style.display = 'none';
      return;
    }

    // Load model status and recommendations
    const [modelStatusResponse, modelsResponse] = await Promise.all([
      fetch('/api/providers/models/status'),
      fetch('/api/providers/models')
    ]);

    const modelStatus = await modelStatusResponse.json();
    const recommendations = await modelsResponse.json();

    // Build model status HTML
    let html = '';

    // Local LLM Models
    html += '<div style="margin-bottom: 15px;">';
    html += '<h4 style="margin: 0 0 10px 0; color: #333; font-size: 14px;">Local LLM Models</h4>';
    if (modelStatus.localLLM.installed && modelStatus.localLLM.model) {
      html += '<div style="background: #e8f5e9; padding: 10px; border-radius: 4px; margin-bottom: 10px;">';
      html += '<span style="color: #2e7d32; font-weight: bold;">✓ Configured Model:</span><br>';
      html += '<span style="color: #666; font-size: 12px;">' + modelStatus.localLLM.model + '</span>';
      html += '</div>';
    } else {
      html += '<div style="background: #ffebee; padding: 10px; border-radius: 4px; margin-bottom: 10px;">';
      html += '<span style="color: #c62828; font-weight: bold;">✗ No models installed</span>';
      html += '</div>';
    }

    // Show recommended models
    recommendations.localLLM.forEach(model => {
      // Check if this model is installed (compare repo names, handle partial matches)
      const currentModel = modelStatus.localLLM.model || '';
      const isInstalled = currentModel === model.name ||
                          currentModel.includes(model.name) ||
                          model.name.includes(currentModel.split('/').pop()?.split('-GGUF')[0] || '');
      const displayName = model.displayName || model.name;
      html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: white; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 5px;">';
      html += '<div style="flex: 1;">';
      html += `<strong style="color: #333;">${displayName}</strong> ${model.recommended ? '<span style="background: #4CAF50; color: white; font-size: 10px; padding: 2px 6px; border-radius: 3px; margin-left: 5px;">RECOMMENDED</span>' : ''}`;
      html += `<br><span style="font-size: 11px; color: #666;">${model.description} (${model.size})</span>`;
      html += '</div>';
      if (isInstalled) {
        html += '<span style="color: #4CAF50; font-size: 12px; font-weight: bold;">✓ Installed</span>';
      } else {
        html += `<button onclick="downloadModel('local-llm', '${model.name}')" style="background: #0066cc; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Download</button>`;
      }
      html += '</div>';
    });
    html += '</div>';

    // Flux Models
    html += '<div style="margin-bottom: 15px;">';
    html += '<h4 style="margin: 0 0 10px 0; color: #333; font-size: 14px;">Flux Image Generation</h4>';
    if (modelStatus.flux.installed && modelStatus.flux.modelPath) {
      html += '<div style="background: #e8f5e9; padding: 10px; border-radius: 4px; margin-bottom: 10px;">';
      html += '<span style="color: #2e7d32; font-weight: bold;">✓ Service Running:</span><br>';
      html += '<span style="color: #666; font-size: 12px;">' + modelStatus.flux.modelPath + '</span>';
      html += '</div>';
    } else if (modelStatus.flux.downloaded || modelStatus.flux.cached) {
      html += '<div style="background: #fff3e0; padding: 10px; border-radius: 4px; margin-bottom: 10px;">';
      html += '<span style="color: #f57c00; font-weight: bold;">⚠ Model downloaded but service not running</span>';
      html += '</div>';
    } else {
      html += '<div style="background: #ffebee; padding: 10px; border-radius: 4px; margin-bottom: 10px;">';
      html += '<span style="color: #c62828; font-weight: bold;">✗ No models installed</span>';
      html += '</div>';
    }

    // Show available Flux models
    recommendations.flux.forEach(model => {
      // Determine if this model is currently loaded
      const currentModel = modelStatus.flux.modelPath || modelStatus.flux.modelName || '';
      const isLoaded = modelStatus.flux.modelLoaded &&
                       (currentModel.includes(model.name) ||
                        model.name === 'flux-dev' && currentModel.includes('FLUX.1-dev') ||
                        model.name === 'flux-schnell' && currentModel.includes('FLUX.1-schnell'));

      // Check if model is downloaded (service knows about it)
      const isDownloaded = modelStatus.flux.downloaded || modelStatus.flux.cached || isLoaded;

      html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: white; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 5px;">';
      html += '<div style="flex: 1;">';
      html += `<strong style="color: #333;">${model.name}</strong> ${model.recommended ? '<span style="background: #4CAF50; color: white; font-size: 10px; padding: 2px 6px; border-radius: 3px; margin-left: 5px;">RECOMMENDED</span>' : ''}`;
      html += `<br><span style="font-size: 11px; color: #666;">${model.description} (${model.size})</span>`;
      html += '</div>';

      if (isLoaded) {
        html += '<span style="color: #4CAF50; font-size: 12px; font-weight: bold;">✓ Loaded</span>';
      } else if (isDownloaded) {
        html += '<span style="color: #f57c00; font-size: 12px; font-weight: bold;">✓ Downloaded</span>';
      } else {
        html += `<button onclick="downloadModel('flux', '${model.name}')" style="background: #0066cc; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Download</button>`;
      }
      html += '</div>';
    });
    html += '</div>';

    // Local Vision Models
    html += '<div style="margin-bottom: 15px;">';
    html += '<h4 style="margin: 0 0 10px 0; color: #333; font-size: 14px;">Local Vision Models</h4>';
    if (modelStatus.localVision.installed) {
      html += '<div style="background: #e8f5e9; padding: 10px; border-radius: 4px;">';
      html += '<span style="color: #2e7d32; font-weight: bold;">✓ Service Running</span>';
      if (modelStatus.localVision.models.length > 0) {
        html += '<br><span style="color: #666; font-size: 12px;">Models: ' + modelStatus.localVision.models.join(', ') + '</span>';
      }
      html += '</div>';
    } else {
      html += '<div style="background: #fff3e0; padding: 10px; border-radius: 4px;">';
      html += '<span style="color: #e65100; font-weight: bold;">⚠ Service Not Running</span><br>';
      html += '<span style="color: #666; font-size: 12px;">Local vision requires manual Python service setup. See documentation.</span>';
      html += '</div>';
    }
    html += '</div>';

    modelContent.innerHTML = html;

  } catch (error) {
    console.error('[Model Management] Failed to load model status:', error);
    modelContent.innerHTML = '<span style="color: #f44336;">Failed to load model status</span>';
  }
}

/**
 * Download a model with progress tracking
 */
async function downloadModel(type, modelName) {
  const progressSection = document.getElementById('downloadProgressSection');
  const progressBar = document.getElementById('downloadProgressBar');
  const progressPercent = document.getElementById('downloadProgressPercent');
  const statusMessage = document.getElementById('downloadStatusMessage');
  const modelNameEl = document.getElementById('downloadModelName');

  // Show progress section
  progressSection.style.display = 'block';
  modelNameEl.textContent = `📥 Downloading ${modelName}...`;
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  statusMessage.textContent = 'Starting download...';
  statusMessage.style.color = '#666';

  const startTime = Date.now();
  let progressInterval = null;

  try {
    const response = await fetch('/api/providers/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, model: modelName })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));

            // Update progress
            if (data.progress !== undefined) {
              progressBar.style.width = `${data.progress}%`;
              progressPercent.textContent = `${data.progress}%`;
            }

            // Update status message with elapsed time
            if (data.message || data.status === 'downloading') {
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
              const msg = data.message || 'Downloading...';
              statusMessage.textContent = `${msg} (${elapsedStr})`;
            }

            // Handle completion or error
            if (data.status === 'complete') {
              clearInterval(progressInterval);
              progressBar.style.background = 'linear-gradient(90deg, #4CAF50 0%, #45a049 100%)';
              progressBar.style.width = '100%';
              progressPercent.textContent = '100%';
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
              statusMessage.textContent = `✓ Download complete! (${elapsedStr})`;
              statusMessage.style.color = '#4CAF50';
              setTimeout(() => {
                progressSection.style.display = 'none';
                refreshModelStatus();
              }, 2000);
            } else if (data.status === 'error') {
              clearInterval(progressInterval);
              progressBar.style.background = '#f44336';
              statusMessage.style.color = '#f44336';
              setTimeout(() => {
                progressSection.style.display = 'none';
              }, 5000);
            }
          } catch (e) {
            console.error('[Model Management] Failed to parse SSE data:', e);
          }
        }
      }
    }

    // Handle any remaining buffer content
    if (buffer.trim().startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.substring(6));
        if (data.status === 'complete') {
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          statusMessage.textContent = `✓ Download complete! (${elapsed}s)`;
          statusMessage.style.color = '#4CAF50';
          setTimeout(() => {
            progressSection.style.display = 'none';
            refreshModelStatus();
          }, 2000);
        }
      } catch (e) {
        // Ignore parsing errors for final buffer
      }
    }

  } catch (error) {
    console.error('[Model Management] Download error:', error);
    statusMessage.textContent = `✗ Error: ${error.message}`;
    statusMessage.style.color = '#f44336';
    progressBar.style.background = '#f44336';
  }
}

/**
 * Refresh model status
 */
async function refreshModelStatus() {
  await loadModelStatus();
}

/**
 * Service Control Functions
 */

// Track pending service operations to prevent double-clicks
const pendingServiceOps = new Set();

/**
 * Start a service
 */
async function startService(serviceName) {
  // Prevent double-start
  if (pendingServiceOps.has(serviceName)) {
    addMessage(`${serviceName} operation already in progress...`, 'info');
    return;
  }

  try {
    pendingServiceOps.add(serviceName);
    addMessage(`Starting ${serviceName} service...`, 'info');

    // Disable the button visually
    const btn = document.querySelector(`button[onclick*="startService('${serviceName}')"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting...';
      btn.style.opacity = '0.6';
    }

    const response = await fetch('/api/providers/services/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: serviceName })
    });

    const data = await response.json();

    if (data.status === 'already_running') {
      addMessage(`${serviceName} is already running`, 'info');
    } else if (data.status === 'started') {
      addMessage(`✓ ${serviceName} service started successfully (PID: ${data.pid})`, 'event');
    } else {
      addMessage(`Failed to start ${serviceName}: ${data.message}`, 'warning');
    }

    // Refresh provider status
    await loadProviderStatus();

  } catch (error) {
    console.error('[Service Control] Start error:', error);
    addMessage(`Error starting ${serviceName}: ${error.message}`, 'error');
  } finally {
    pendingServiceOps.delete(serviceName);
  }
}

/**
 * Stop a service
 */
async function stopService(serviceName) {
  // Prevent double-stop
  if (pendingServiceOps.has(serviceName)) {
    addMessage(`${serviceName} operation already in progress...`, 'info');
    return;
  }

  try {
    pendingServiceOps.add(serviceName);
    addMessage(`Stopping ${serviceName} service...`, 'info');

    // Disable the button visually
    const btn = document.querySelector(`button[onclick*="stopService('${serviceName}')"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Stopping...';
      btn.style.opacity = '0.6';
    }

    const response = await fetch('/api/providers/services/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: serviceName })
    });

    const data = await response.json();

    if (data.status === 'not_running') {
      addMessage(`${serviceName} is not running`, 'info');
    } else if (data.status === 'stopped') {
      addMessage(`✓ ${serviceName} service stopped successfully`, 'event');
    } else {
      addMessage(`Failed to stop ${serviceName}: ${data.message}`, 'warning');
    }

    // Refresh provider status
    await loadProviderStatus();

  } catch (error) {
    console.error('[Service Control] Stop error:', error);
    addMessage(`Error stopping ${serviceName}: ${error.message}`, 'error');
  } finally {
    pendingServiceOps.delete(serviceName);
  }
}

/**
 * HF Token Management
 */

/**
 * Save HF token to localStorage
 */
function saveHfToken(token) {
  if (token && token.startsWith('hf_')) {
    localStorage.setItem('hfToken', token);
    return true;
  }
  return false;
}

/**
 * Load HF token from localStorage
 */
function loadHfToken() {
  return localStorage.getItem('hfToken') || '';
}

/**
 * Get HF token (alias for loadHfToken)
 */
function getHfToken() {
  return loadHfToken();
}

/**
 * Toggle HF token visibility
 */
function toggleHfTokenVisibility() {
  const input = document.getElementById('hfTokenInput');
  const icon = document.getElementById('hfTokenEyeIcon');

  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fas fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fas fa-eye';
  }
}

/**
 * Update HF token status indicator
 */
function updateHfTokenStatus(fluxHealth) {
  const statusEl = document.getElementById('hfTokenStatus');
  const token = document.getElementById('hfTokenInput')?.value;

  if (!statusEl) return;

  if (!token) {
    statusEl.innerHTML = '<span style="color: #ff9800;"><i class="fas fa-exclamation-triangle"></i> No token set - required for Flux</span>';
  } else if (fluxHealth?.hf_authenticated) {
    statusEl.innerHTML = '<span style="color: #4CAF50;"><i class="fas fa-check-circle"></i> HF authenticated</span>';
  } else {
    statusEl.innerHTML = '<span style="color: #2196F3;"><i class="fas fa-info-circle"></i> Token set - will be used on service start</span>';
  }
}

/**
 * Quick Start All Local Services
 * Starts Flux, Vision, and LLM services with HF token
 */
async function quickStartLocalServices() {
  const btn = document.querySelector('button[onclick*="quickStartLocalServices"]');
  const hfTokenInput = document.getElementById('hfTokenInput');
  const hfToken = hfTokenInput?.value?.trim();

  // Save token to localStorage if valid
  if (hfToken) {
    if (!hfToken.startsWith('hf_')) {
      console.warn('[UI] HF token must start with hf_');
      return;
    }
    saveHfToken(hfToken);
  }

  // Show loading state
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Starting Services...';

    // Restore button after completion
    const restoreButton = () => {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.innerHTML = originalText;
    };

    setTimeout(restoreButton, 10000); // Auto-restore after 10s
  }

  try {
    console.log('[UI] Quick starting all local services...');

    const services = ['llm', 'flux', 'vision', 'vlm'];

    // Set all services to "starting" state immediately
    services.forEach(serviceName => {
      setServiceStatus(serviceName, 'starting', 'Starting...');
    });

    // Start services in parallel using the new service control API
    const startPromises = services.map(async (serviceName) => {
      try {
        const res = await fetch(`/api/services/${serviceName}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hfToken })
        });

        const result = await res.json();

        if (res.ok) {
          // Service started successfully
          return { service: serviceName, status: 'started', pid: result.pid, ...result };
        } else if (res.status === 409) {
          // Service already running
          return { service: serviceName, status: 'already-running', ...result };
        } else {
          // Actual error
          return { service: serviceName, status: 'error', error: result.error || 'Unknown error' };
        }
      } catch (error) {
        return { service: serviceName, status: 'error', error: error.message };
      }
    });

    // Wait for all services to start (process spawned, but may not be ready)
    const results = await Promise.allSettled(startPromises);

    // Log results and poll each service that started or was already running
    let successCount = 0;
    let failCount = 0;
    const pollPromises = [];

    results.forEach(({ value }) => {
      if (value.status === 'started') {
        successCount++;
        console.log(`[UI] ${value.service} process started (PID: ${value.pid}), polling for readiness...`);
        // Poll each service individually to detect when ready
        pollPromises.push(pollServiceUntilReady(value.service));
      } else if (value.status === 'already-running') {
        successCount++;
        console.log(`[UI] ${value.service} is already running, confirming health...`);
        // Quick poll to confirm it's healthy
        pollPromises.push(pollServiceUntilReady(value.service, 3));
      } else {
        failCount++;
        console.warn(`[UI] ${value.service} failed to start:`, value.error || 'Unknown error');
        setServiceStatus(value.service, 'error', `Failed: ${value.error || 'Unknown'}`);
      }
    });

    // Wait for all services to become ready (or timeout)
    await Promise.allSettled(pollPromises);

    console.log(`[UI] Quick start complete: ${successCount} processes started, ${failCount} failed`);

  } catch (error) {
    console.error('[UI] Error during quick start:', error);
  } finally {
    // Restore button state
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

/**
 * Switch to local providers after quick-start
 */
async function switchToLocalProviders() {
  try {
    const response = await fetch('/api/providers/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm: 'local-llm',
        image: 'flux',
        vision: 'local'
      })
    });

    if (response.ok) {
      // Update dropdowns in modal
      const llmSelect = document.getElementById('llmProvider');
      const imageSelect = document.getElementById('imageProvider');
      const visionSelect = document.getElementById('visionProvider');

      if (llmSelect) llmSelect.value = 'local-llm';
      if (imageSelect) imageSelect.value = 'flux';
      if (visionSelect) visionSelect.value = 'local';

      // Update main form (hides API key requirement)
      updateMainFormForProviders({
        llm: 'local-llm',
        image: 'flux',
        vision: 'local'
      });

      addMessage('✓ Switched to local providers', 'event');
    }
  } catch (error) {
    console.warn('[Quick Start] Failed to switch providers:', error);
  }
}

/**
 * Stop all local services
 */
async function stopAllLocalServices() {
  try {
    console.log('[UI] Stopping all local services...');

    const services = ['llm', 'flux', 'vision', 'vlm'];

    // Set all services to "stopping" state immediately
    services.forEach(serviceName => {
      setServiceStatus(serviceName, 'starting', 'Stopping...');
    });

    // Show user feedback
    addMessage('⏹ Stopping all local services...', 'event');

    // Stop all services in parallel
    const stopPromises = services.map(serviceName =>
      fetch(`/api/services/${serviceName}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
        .then(res => res.json())
        .then(result => ({
          service: serviceName,
          success: result.success !== false,
          message: result.message
        }))
        .catch(error => ({
          service: serviceName,
          success: false,
          error: error.message
        }))
    );

    // Wait for all services to stop
    const results = await Promise.allSettled(stopPromises);

    // Check results
    let successCount = 0;
    let failCount = 0;

    results.forEach(({ value }) => {
      if (value.success) {
        successCount++;
        console.log(`[UI] ${value.service} stopped successfully`);
        setServiceStatus(value.service, 'stopped', 'Stopped');
      } else {
        failCount++;
        console.warn(`[UI] ${value.service} failed to stop:`, value.error || 'Unknown error');
        setServiceStatus(value.service, 'error', 'Failed to stop');
      }
    });

    // Final message
    if (failCount === 0) {
      addMessage(`✓ All ${successCount} local services stopped successfully`, 'event');
      console.log(`[UI] All services stopped successfully`);
    } else {
      addMessage(`⚠️ Stopped ${successCount} services, ${failCount} failed to stop`, 'event');
      console.warn(`[UI] ${failCount} services failed to stop`);
    }
  } catch (error) {
    console.error('[UI] Error stopping services:', error);
    addMessage(`✗ Error stopping services. Check console for details.`, 'error');
  }
}

// Check for pending jobs and show reconnection banner if needed
checkForPendingJob();

// Update My Jobs count on page load
updateMyJobsCount();

// Load provider status on page load (don't show modal, just update indicator)
loadProviderStatus().catch(err => {
  console.warn('[Provider Settings] Failed to load initial status:', err);
});

// Initial message
addMessage('Ready. Configure parameters and click "Start Beam Search"', 'event');
