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
beamWidthSelect.addEventListener('change', updateKeepTopOptions);
updateKeepTopOptions(); // Initialize on page load

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

    // Store ranking data
    const rankingData = {
      rank: msg.rank,
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

    return {
      text: `🏆 ${globalId} ranked #${rank}${reason}`,
      type: 'info'
    };
  }

  if (msg.type === 'operation') {
    const candId = msg.candidateId || '?';
    const op = msg.operation || '?';
    const status = msg.status || 'processing';
    const statusEmoji = status === 'completed' ? '✓' : '⟳';

    // Update cost display on operations
    updateCostDisplay();

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
  img.onerror = () => {
    // If image fails to load, show error placeholder
    img.style.backgroundColor = '#fee';
    img.textContent = 'Error';
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

    // Reset all tracking for new job
    seenImages.clear();
    candidates.clear();
    rankings.clear();
    currentCost = { total: 0, llm: 0, vision: 0, imageGen: 0 };
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

    // Start the job via API
    const response = await fetch('http://localhost:3000/api/demo/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    addMessage(`Job started: ${currentJobId}`, 'event');

    // Disable form inputs
    startBtn.disabled = true;
    stopBtn.disabled = false;
    document.getElementById('prompt').disabled = true;
    beamWidthSelect.disabled = true;
    keepTopSelect.disabled = true;
    document.getElementById('maxIterations').disabled = true;
    document.getElementById('alpha').disabled = true;
    document.getElementById('temperature').disabled = true;

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
      addMessage('WebSocket connected', 'event');
      // Subscribe to this job
      ws.send(JSON.stringify({
        type: 'subscribe',
        jobId: currentJobId
      }));
      addMessage(`Subscribed to job: ${currentJobId}`, 'event');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const formatted = formatMessage(msg);

        // formatMessage may return null for messages we track but don't display
        if (formatted) {
          addMessage(formatted.text, formatted.type);
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
      addMessage(`WebSocket error: ${err}`, 'error');
      setStatus('error');
    };

    ws.onclose = () => {
      addMessage('WebSocket disconnected', 'warning');
      stopBeamSearch();
    };
  } catch (err) {
    addMessage(`Connection error: ${err.message}`, 'error');
    setStatus('error');
  }
}

// Stop beam search
function stopBeamSearch() {
  currentJobId = null;
  if (ws) {
    ws.close();
    ws = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
  document.getElementById('prompt').disabled = false;
  beamWidthSelect.disabled = false;
  keepTopSelect.disabled = false;
  document.getElementById('maxIterations').disabled = false;
  document.getElementById('alpha').disabled = false;
  document.getElementById('temperature').disabled = false;

  // Reset images gallery for next job
  seenImages.clear();
  imagesGrid.innerHTML = '';
  imagesSection.style.display = 'none';

  addMessage('Beam search stopped', 'event');
  setStatus('idle');
}

// Event listeners
startBtn.addEventListener('click', startBeamSearch);
stopBtn.addEventListener('click', stopBeamSearch);
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

  // Get ALL candidates with images, sorted by rank (if available) then by iteration desc
  const allCandidates = Array.from(candidates.values())
    .filter(c => c.imageUrl) // Must have an image
    .sort((a, b) => {
      // First sort by rank (lower is better, unranked goes last)
      const rankA = a.ranking?.rank ?? 999;
      const rankB = b.ranking?.rank ?? 999;
      if (rankA !== rankB) return rankA - rankB;

      // Then by iteration (higher is more refined)
      if (a.iteration !== b.iteration) return b.iteration - a.iteration;

      // Then by candidateId
      return a.candidateId - b.candidateId;
    });

  console.log('[Demo] Filtered candidates with images:', allCandidates.length);
  allCandidates.forEach(c => {
    console.log(`[Demo]   ${c.id}: rank=${c.ranking?.rank}, parentId=${c.parentId}, lineage=${buildLineage(c.id)}`);
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

  showcaseSection.innerHTML = `
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
              const rank = c.ranking?.rank;
              const displayRank = rank !== undefined ? `#${rank}` : `—`;
              const rankClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
              return `
                <tr class="${!rank ? 'unranked-row' : ''} ${rankClass}">
                  <td class="rank-cell">${displayRank}</td>
                  <td class="candidate-cell">
                    <img src="${c.imageUrl}" alt="${c.id}" class="ranking-thumb" onclick="window.open('${c.imageUrl}', '_blank')">
                    <span>${c.id}</span>
                  </td>
                  <td class="iter-cell">iter ${c.iteration}</td>
                  <td class="lineage-cell">${lineage}</td>
                  <td class="reason-cell">${c.ranking?.reason || (rank ? 'No reason' : 'Eliminated')}</td>
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
        const hasRank = ranking.rank !== undefined;
        const lineage = buildLineage(candidate.id);

        // Medal for ranked candidates, number for others
        let medal;
        if (hasRank) {
          medal = ranking.rank === 1 ? '🥇' : ranking.rank === 2 ? '🥈' : ranking.rank === 3 ? '🥉' : `#${ranking.rank}`;
        } else {
          medal = `#${index + 1}`;
        }

        return `
          <div class="showcase-card ${index === 0 ? 'winner' : ''} ${!hasRank ? 'unranked' : ''}">
            <div class="showcase-rank">${medal}</div>
            <div class="showcase-image">
              <img src="${candidate.imageUrl}" alt="${candidate.id}" onclick="window.open('${candidate.imageUrl}', '_blank')">
            </div>
            <div class="showcase-id">${candidate.id}${!hasRank ? ' <span class="unranked-badge">unranked</span>' : ''}</div>

            ${hasRank ? `
              <div class="showcase-reason">${ranking.reason || 'Ranked but no reason provided'}</div>
            ` : `
              <div class="showcase-reason unranked-reason">Not in final ranking (eliminated in earlier round)</div>
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

// Initial message
addMessage('Ready. Configure parameters and click "Start Beam Search"', 'event');
