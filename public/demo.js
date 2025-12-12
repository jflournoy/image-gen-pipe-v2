/**
 * Beam Search Demo Application
 * Interactive frontend for the beam search image generation pipeline
 */

// Configuration
const WS_URL = window.location.protocol === 'https:'
  ? `wss://${window.location.host}`
  : `ws://${window.location.host}`;

/**
 * DemoState - Manages all application state
 */
class DemoState {
  constructor() {
    this.jobId = null;
    this.sessionId = null;
    this.startTime = null;
    this.currentIteration = 0;
    this.totalIterations = 0;
    this.candidates = {};  // { 'i0c0': {score, imageUrl, ...}, ... }
    this.lineage = {};     // { 'i0c0': { parent: null, children: [] }, ... }
    this.totalTokens = 0;
    this.totalCost = 0;
    this.status = 'idle';  // idle, running, completed, error, cancelled
  }

  addCandidate(iteration, candidateId, data) {
    const id = `i${iteration}c${candidateId}`;
    this.candidates[id] = {
      id,
      iteration,
      candidateId,
      score: data.score || data.totalScore || 0,
      imageUrl: data.imageUrl,
      ranking: data.ranking,
      parentId: data.parentId,
      whatPrompt: data.whatPrompt,
      howPrompt: data.howPrompt,
      combined: data.combined,
      ...data
    };

    // Build lineage
    if (!this.lineage[id]) {
      this.lineage[id] = { parent: data.parentId ? `i${iteration - 1}c${data.parentId}` : null, children: [] };
    }
    if (data.parentId) {
      const parentId = `i${iteration - 1}c${data.parentId}`;
      if (this.lineage[parentId]) {
        this.lineage[parentId].children.push(id);
      }
    }

    return id;
  }

  getLineageTree() {
    // Get root candidates (iteration 0) and their descendants
    const roots = Object.values(this.candidates)
      .filter(c => c.iteration === 0)
      .sort((a, b) => a.candidateId - b.candidateId);

    return roots.map(root => ({
      ...root,
      descendants: this.getDescendants(root.id)
    }));
  }

  getDescendants(id) {
    if (!this.lineage[id]) return [];
    return this.lineage[id].children
      .map(childId => ({
        ...this.candidates[childId],
        descendants: this.getDescendants(childId)
      }))
      .sort((a, b) => a.candidateId - b.candidateId);
  }

  getCandidatesSorted() {
    return Object.values(this.candidates)
      .sort((a, b) => {
        if (a.iteration !== b.iteration) {
          return b.iteration - a.iteration; // Newer first
        }
        return (b.score || 0) - (a.score || 0); // Higher score first
      });
  }

  reset() {
    this.jobId = null;
    this.sessionId = null;
    this.startTime = null;
    this.currentIteration = 0;
    this.totalIterations = 0;
    this.candidates = {};
    this.lineage = {};
    this.totalTokens = 0;
    this.totalCost = 0;
    this.status = 'idle';
  }
}

/**
 * DemoWebSocket - Handles WebSocket connection
 */
class DemoWebSocket {
  constructor(url, handlers) {
    this.url = url;
    this.handlers = handlers;
    this.ws = null;
    this.messageQueue = [];
    this.connect();
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => this.onOpen();
      this.ws.onmessage = (event) => this.onMessage(event);
      this.ws.onerror = (error) => this.onError(error);
      this.ws.onclose = () => this.onClose();
    } catch (err) {
      console.error('[Demo] WebSocket connection error:', err);
      this.handlers.onError?.({
        message: 'WebSocket connection failed',
        details: err.message
      });
    }
  }

  onOpen() {
    console.log('[Demo] WebSocket connected');
    // Flush any queued messages
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(jobId) {
    const msg = { type: 'subscribe-demo', jobId };
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.messageQueue.push(msg);
    }
  }

  onMessage(event) {
    try {
      const data = JSON.parse(event.data);
      console.log('[Demo] Message:', data.type, data);

      // Route message to appropriate handler
      const handler = this.handlers[`on${this.capitalizeFirst(data.type)}`];
      if (handler) {
        handler(data);
      }
    } catch (err) {
      console.error('[Demo] Error processing WebSocket message:', err);
    }
  }

  onError(error) {
    console.error('[Demo] WebSocket error:', error);
    this.handlers.onError?.({
      message: 'WebSocket error',
      details: error.message
    });
  }

  onClose() {
    console.log('[Demo] WebSocket disconnected');
  }

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/:/g, '-');
  }
}

/**
 * DemoUI - Handles all UI updates
 */
class DemoUI {
  showProgress() {
    document.getElementById('progress-section').style.display = 'block';
    document.getElementById('form-section').classList.add('running');
    document.getElementById('start-btn').disabled = true;
    document.getElementById('cancel-btn').disabled = false;
  }

  hideProgress() {
    document.getElementById('start-btn').disabled = false;
    document.getElementById('cancel-btn').disabled = true;
  }

  updateProgress(current, total) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('progress-bar').style.width = percent + '%';
    document.getElementById('progress-percent').textContent = Math.round(percent) + '%';
    document.getElementById('iteration-text').textContent = `${current}/${total}`;
  }

  updateMetrics(tokens, cost, elapsed) {
    document.getElementById('tokens-text').textContent = this.formatNumber(tokens);
    document.getElementById('cost-text').textContent = this.formatCost(cost);
    document.getElementById('elapsed-text').textContent = this.formatTime(elapsed);
  }

  updateStatus(status, message) {
    const badge = document.getElementById('status-badge');
    badge.textContent = status;
    badge.className = 'status-badge ' + status.toLowerCase();
    document.getElementById('status-message').textContent = message;
  }

  addImage(iteration, candidateId, imageUrl, score) {
    document.getElementById('images-section').style.display = 'block';
    const grid = document.getElementById('images-grid');
    const card = document.createElement('div');
    card.className = 'image-card';
    card.innerHTML = `
      <img src="${imageUrl}" alt="i${iteration}c${candidateId}" onerror="this.src='/placeholder.svg';">
      <div class="image-card-info">
        <div class="image-id">i${iteration}c${candidateId}</div>
        <div class="image-score">${score.toFixed(2)}</div>
      </div>
    `;
    grid.appendChild(card);
  }

  renderLineageTree(state) {
    document.getElementById('lineage-section').style.display = 'block';
    const svg = document.getElementById('lineage-svg');
    svg.innerHTML = '';

    const tree = state.getLineageTree();
    if (tree.length === 0) return;

    const padding = 40;
    const nodeSize = 60;
    const nodeGap = 100;
    const iterationGap = 150;

    // Calculate dimensions
    const maxDepth = this.getTreeDepth(tree[0]) || 1;
    const width = Math.max(800, (state.totalIterations || 1) * iterationGap + padding * 2);
    const height = Math.max(300, tree.length * nodeGap + padding * 2);

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Draw nodes and connections
    let yOffset = padding;
    tree.forEach((root, idx) => {
      this.drawNode(svg, root, padding, yOffset + idx * nodeGap, iterationGap, nodeSize);
    });
  }

  drawNode(svg, candidate, x, y, iterationGap, nodeSize) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Draw circle for node
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', nodeSize / 2);
    circle.setAttribute('fill', '#667eea');
    circle.setAttribute('stroke', '#764ba2');
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    // Draw label
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', 'white');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', 'bold');
    text.textContent = `i${candidate.iteration}c${candidate.candidateId}`;
    g.appendChild(text);

    // Draw score below
    const scoreText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    scoreText.setAttribute('x', x);
    scoreText.setAttribute('y', y + nodeSize / 2 + 15);
    scoreText.setAttribute('text-anchor', 'middle');
    scoreText.setAttribute('fill', '#333');
    scoreText.setAttribute('font-size', '11');
    scoreText.textContent = (candidate.score || 0).toFixed(2);
    g.appendChild(scoreText);

    // Draw children
    if (candidate.descendants && candidate.descendants.length > 0) {
      const childX = x + iterationGap;
      const childGap = 60;
      const totalChildHeight = candidate.descendants.length * childGap;
      const startY = y - totalChildHeight / 2 + childGap / 2;

      candidate.descendants.forEach((child, idx) => {
        const childY = startY + idx * childGap;

        // Draw line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x + 30);
        line.setAttribute('y1', y);
        line.setAttribute('x2', childX - 30);
        line.setAttribute('y2', childY);
        line.setAttribute('stroke', '#ccc');
        line.setAttribute('stroke-width', '1');
        g.insertBefore(line, g.firstChild);

        // Recursively draw child
        this.drawNode(svg, child, childX, childY, iterationGap, 50);
      });
    }

    svg.appendChild(g);
  }

  getTreeDepth(node) {
    if (!node.descendants || node.descendants.length === 0) return 1;
    return 1 + Math.max(...node.descendants.map(child => this.getTreeDepth(child)));
  }

  showResults(winner) {
    document.getElementById('results-section').style.display = 'block';
    const content = document.getElementById('results-content');
    content.innerHTML = `
      <div class="result-winner">
        <h3>🏆 Winner</h3>
        ${winner.imageUrl ? `<img src="${winner.imageUrl}" alt="Winner image">` : ''}
        <div class="result-stats">
          <div class="stat">
            <div class="stat-label">Candidate ID</div>
            <div class="stat-value">i${winner.iteration}c${winner.candidateId}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Final Score</div>
            <div class="stat-value">${(winner.score || 0).toFixed(2)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Iteration</div>
            <div class="stat-value">${winner.iteration}</div>
          </div>
        </div>
      </div>
    `;
  }

  showError(message) {
    document.getElementById('error-section').style.display = 'block';
    document.getElementById('error-message').textContent = message;
  }

  clearError() {
    document.getElementById('error-section').style.display = 'none';
  }

  formatNumber(num) {
    return new Intl.NumberFormat().format(num);
  }

  formatCost(cost) {
    return '$' + (cost || 0).toFixed(4);
  }

  formatTime(ms) {
    if (!ms) return '0s';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return seconds + 's';
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  reset() {
    document.getElementById('progress-section').style.display = 'none';
    document.getElementById('images-section').style.display = 'none';
    document.getElementById('lineage-section').style.display = 'none';
    document.getElementById('results-section').style.display = 'none';
    document.getElementById('images-grid').innerHTML = '';
    document.getElementById('lineage-svg').innerHTML = '';
    this.clearError();
  }
}

/**
 * DemoApp - Main application controller
 */
class DemoApp {
  constructor() {
    this.state = new DemoState();
    this.ui = new DemoUI();
    this.ws = new DemoWebSocket(WS_URL, {
      onStarted: (data) => this.onJobStarted(data),
      onIteration: (data) => this.onIterationProgress(data),
      onCandidateComplete: (data) => this.onCandidateComplete(data),
      onRankingComparison: (data) => this.onRankingComparison(data),
      onRankingComplete: (data) => this.onRankingComplete(data),
      onIterationComplete: (data) => this.onIterationComplete(data),
      onComplete: (data) => this.onJobComplete(data),
      onError: (data) => this.onJobError(data),
      onCancelled: (data) => this.onJobCancelled(data),
      onStep: (data) => this.onStep(data),
      onOperation: (data) => this.onOperation(data),
      onCandidate: (data) => this.onCandidate(data)
    });

    this.setupEventListeners();
    this.startTimer();
  }

  setupEventListeners() {
    document.getElementById('demo-form').addEventListener('submit', (e) => this.handleFormSubmit(e));
    document.getElementById('cancel-btn').addEventListener('click', () => this.handleCancel());
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    this.ui.clearError();
    this.ui.reset();

    const formData = new FormData(document.getElementById('demo-form'));
    const params = {
      prompt: formData.get('prompt'),
      n: parseInt(formData.get('beamWidth')),
      m: parseInt(formData.get('keepTop')),
      maxIterations: parseInt(formData.get('maxIterations')),
      alpha: parseFloat(formData.get('alpha')),
      temperature: parseFloat(formData.get('temperature')),
      ensembleSize: parseInt(formData.get('ensembleSize'))
    };

    try {
      const response = await fetch('/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || `API error: ${response.status}`);
      }

      const result = await response.json();
      this.state.jobId = result.jobId;
      this.state.startTime = Date.now();
      this.state.status = 'running';
      this.state.totalIterations = params.maxIterations;

      this.ui.showProgress();
      this.ui.updateStatus('running', 'Initializing beam search...');
      this.ws.subscribe(result.jobId);
    } catch (err) {
      console.error('[Demo] Error starting demo:', err);
      this.ui.showError(err.message);
    }
  }

  handleCancel() {
    if (this.state.jobId) {
      fetch(`/api/jobs/${this.state.jobId}/cancel`, { method: 'POST' })
        .catch(err => console.error('[Demo] Error cancelling:', err));
    }
  }

  onJobStarted(data) {
    console.log('[Demo] Job started:', data.params);
    this.state.sessionId = data.sessionId;
    this.ui.updateStatus('running', 'Generating initial candidates...');
  }

  onIteration(data) {
    this.state.currentIteration = data.iteration;
    this.state.totalIterations = data.totalIterations;
    this.ui.updateProgress(data.iteration, data.totalIterations);
  }

  onCandidateComplete(data) {
    this.state.addCandidate(data.iteration, data.candidateId, data);
    if (data.imageUrl) {
      this.ui.addImage(data.iteration, data.candidateId, data.imageUrl, data.score || 0);
    }
  }

  onCandidate(data) {
    this.onCandidateComplete(data);
  }

  onRankingComparison(data) {
    // Could show comparison details if needed
    console.log('[Demo] Ranking comparison:', data);
  }

  onRankingComplete(data) {
    console.log('[Demo] Ranking complete for iteration', data.iteration);
  }

  onIterationComplete(data) {
    this.state.totalTokens = data.tokenUsage?.total || 0;
    this.state.totalCost = data.estimatedCost?.total || 0;
    this.ui.updateMetrics(this.state.totalTokens, this.state.totalCost, this.getElapsedTime());
    this.ui.renderLineageTree(this.state);
    console.log('[Demo] Iteration complete:', data.iteration);
  }

  onStep(data) {
    console.log('[Demo] Step:', data.message);
  }

  onOperation(data) {
    console.log('[Demo] Operation:', data.message);
  }

  onJobComplete(data) {
    this.state.status = 'completed';
    this.ui.updateStatus('completed', 'Beam search completed!');

    // Find the winning candidate
    const winner = Object.values(this.state.candidates)
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    if (winner) {
      this.ui.showResults(winner);
    }

    this.ui.hideProgress();
  }

  onJobError(data) {
    this.state.status = 'error';
    this.ui.updateStatus('error', 'Error: ' + (data.message || data.error));
    this.ui.showError(data.message || data.error);
    this.ui.hideProgress();
  }

  onJobCancelled(data) {
    this.state.status = 'cancelled';
    this.ui.updateStatus('cancelled', 'Job cancelled by user');
    this.ui.hideProgress();
  }

  getElapsedTime() {
    if (!this.state.startTime) return 0;
    return Date.now() - this.state.startTime;
  }

  startTimer() {
    setInterval(() => {
      if (this.state.status === 'running') {
        this.ui.updateMetrics(
          this.state.totalTokens,
          this.state.totalCost,
          this.getElapsedTime()
        );
      }
    }, 1000);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.demoApp = new DemoApp();
});
