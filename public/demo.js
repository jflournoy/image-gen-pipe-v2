/**
 * Minimal Beam Search Demo
 * Sets parameters and displays real-time WebSocket messages
 */

const WS_URL = window.location.protocol === 'https:'
  ? `wss://${window.location.host}`
  : `ws://${window.location.host}`;

let ws = null;
let currentJobId = null;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const messagesDiv = document.getElementById('messages');
const statusSpan = document.getElementById('status');

// Add a message to the log
function addMessage(text, type = 'info') {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${type}`;
  msgEl.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  messagesDiv.appendChild(msgEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
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

    const params = {
      prompt,
      n: parseInt(document.getElementById('n').value),
      m: parseInt(document.getElementById('m').value),
      maxIterations: parseInt(document.getElementById('maxIterations').value),
      alpha: parseFloat(document.getElementById('alpha').value),
      temperature: parseFloat(document.getElementById('temperature').value)
    };

    addMessage(`Starting beam search with: N=${params.n}, M=${params.m}, Iterations=${params.maxIterations}`, 'event');
    setStatus('running');

    // Start the job via API
    const response = await fetch('http://localhost:3000/api/demo/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    currentJobId = data.jobId;
    addMessage(`Job started: ${currentJobId}`, 'event');

    // Disable form inputs
    startBtn.disabled = true;
    stopBtn.disabled = false;
    document.getElementById('prompt').disabled = true;
    document.getElementById('n').disabled = true;
    document.getElementById('m').disabled = true;
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

        // Log the message
        if (msg.type === 'subscribed') {
          addMessage('WebSocket subscription confirmed', 'event');
        } else if (msg.type === 'error') {
          addMessage(`Error: ${msg.message || JSON.stringify(msg)}`, 'error');
        } else {
          // Log all other messages
          addMessage(JSON.stringify(msg, null, 2), 'info');
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
  document.getElementById('n').disabled = false;
  document.getElementById('m').disabled = false;
  document.getElementById('maxIterations').disabled = false;
  document.getElementById('alpha').disabled = false;
  document.getElementById('temperature').disabled = false;

  addMessage('Beam search stopped', 'event');
  setStatus('idle');
}

// Event listeners
startBtn.addEventListener('click', startBeamSearch);
stopBtn.addEventListener('click', stopBeamSearch);

// Initial message
addMessage('Ready. Configure parameters and click "Start Beam Search"', 'event');
