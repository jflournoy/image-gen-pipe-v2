# WebSocket API Reference

The WebSocket API provides real-time progress updates for beam search jobs.

## Connection

Connect to the WebSocket server at the same host as the REST API:

```javascript
const ws = new WebSocket('ws://localhost:3000');
```

## Message Protocol

All messages are JSON objects with a `type` field.

### Subscribe to Job

Subscribe to receive updates for a specific job:

```json
{
  "type": "subscribe",
  "jobId": "job-abc123"
}
```

### Unsubscribe from Job

Stop receiving updates for a job:

```json
{
  "type": "unsubscribe",
  "jobId": "job-abc123"
}
```

## Server Events

### Job Started

Sent when a beam search job begins:

```json
{
  "type": "started",
  "jobId": "job-abc123",
  "config": {
    "prompt": "a beautiful landscape",
    "N": 9,
    "M": 3,
    "iterations": 3
  },
  "timestamp": "2025-11-21T12:00:00.000Z"
}
```

### Iteration Progress

Sent when an iteration begins or completes:

```json
{
  "type": "iteration",
  "jobId": "job-abc123",
  "iteration": 1,
  "totalIterations": 3,
  "dimension": "what",
  "status": "processing",
  "timestamp": "2025-11-21T12:01:00.000Z"
}
```

### Candidate Processed

Sent when a single candidate completes processing:

```json
{
  "type": "candidate",
  "jobId": "job-abc123",
  "iteration": 1,
  "candidateId": 3,
  "totalCandidates": 9,
  "score": {
    "totalScore": 85.5,
    "alignmentScore": 82,
    "aestheticScore": 9.1
  },
  "timestamp": "2025-11-21T12:01:30.000Z"
}
```

### Job Complete

Sent when the beam search finishes successfully:

```json
{
  "type": "complete",
  "jobId": "job-abc123",
  "result": {
    "bestCandidate": {
      "whatPrompt": "...",
      "howPrompt": "...",
      "combinedPrompt": "...",
      "imagePath": "output/sessions/session-123/iter2-cand0.png",
      "totalScore": 87.5
    },
    "iterations": 3,
    "duration": 45000
  },
  "timestamp": "2025-11-21T12:03:00.000Z"
}
```

### Error

Sent when an error occurs:

```json
{
  "type": "error",
  "jobId": "job-abc123",
  "error": {
    "message": "OpenAI API error: rate limit exceeded",
    "code": "RATE_LIMIT"
  },
  "timestamp": "2025-11-21T12:02:00.000Z"
}
```

## Example Client

### JavaScript

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  console.log('Connected');

  // Subscribe to a job
  ws.send(JSON.stringify({
    type: 'subscribe',
    jobId: 'job-abc123'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'started':
      console.log('Job started:', message.config);
      break;

    case 'iteration':
      console.log(`Iteration ${message.iteration}/${message.totalIterations}`);
      break;

    case 'candidate':
      console.log(`Candidate ${message.candidateId}: score ${message.score.totalScore}`);
      break;

    case 'complete':
      console.log('Best result:', message.result.bestCandidate);
      ws.close();
      break;

    case 'error':
      console.error('Error:', message.error.message);
      ws.close();
      break;
  }
};

ws.onclose = () => {
  console.log('Disconnected');
};
```

### React Hook

The frontend includes a `useWebSocket` hook for easy integration:

```javascript
import { useWebSocket } from './hooks/useWebSocket';

function BeamSearchProgress({ jobId }) {
  const { messages, status, send } = useWebSocket('ws://localhost:3000');

  useEffect(() => {
    if (status === 'connected' && jobId) {
      send({ type: 'subscribe', jobId });
    }
  }, [status, jobId]);

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>{msg.type}: {JSON.stringify(msg)}</div>
      ))}
    </div>
  );
}
```

## See Also

- [REST API](rest-api.md) - HTTP endpoints
- [Provider Interfaces](providers.md) - Underlying providers
