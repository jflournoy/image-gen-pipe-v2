# REST API Reference

The API server provides REST endpoints for beam search operations.

## Base URL

```
http://localhost:3000
```

## Endpoints

### Health Check

Check if the server is running.

```http
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-11-21T12:00:00.000Z"
}
```

### Start Beam Search

Start a new beam search job.

```http
POST /api/beam-search
Content-Type: application/json
```

**Request Body:**

```json
{
  "prompt": "a beautiful mountain landscape at sunset",
  "N": 9,
  "M": 3,
  "iterations": 3,
  "alpha": 0.7,
  "temperature": 0.8
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | *required* | Initial prompt to refine |
| `N` | number | 9 | Total candidates per iteration |
| `M` | number | 3 | Top candidates to keep (beam width) |
| `iterations` | number | 3 | Number of refinement iterations |
| `alpha` | number | 0.7 | Weight for alignment score (vs aesthetic) |
| `temperature` | number | 0.8 | LLM temperature for expansion |

**Response:**

```json
{
  "jobId": "job-abc123",
  "status": "started",
  "message": "Beam search job started"
}
```

### Get Job Status

Get the current status of a beam search job.

```http
GET /api/job/:jobId
```

**Response (In Progress):**

```json
{
  "jobId": "job-abc123",
  "status": "in_progress",
  "progress": {
    "currentIteration": 1,
    "totalIterations": 3,
    "candidatesProcessed": 5,
    "totalCandidates": 9
  }
}
```

**Response (Completed):**

```json
{
  "jobId": "job-abc123",
  "status": "completed",
  "result": {
    "bestCandidate": {
      "whatPrompt": "...",
      "howPrompt": "...",
      "combinedPrompt": "...",
      "imagePath": "output/sessions/session-123/iter2-cand0.png",
      "totalScore": 87.5,
      "alignmentScore": 85,
      "aestheticScore": 9.2
    },
    "iterations": 3,
    "candidatesEvaluated": 27
  }
}
```

**Response (Error):**

```json
{
  "jobId": "job-abc123",
  "status": "error",
  "error": {
    "message": "OpenAI API rate limit exceeded",
    "code": "RATE_LIMIT"
  }
}
```

### Serve Image

Retrieve a generated image by ID.

```http
GET /api/images/:imageId
```

**Response:**

- Content-Type: `image/png`
- Body: Binary image data

**Error Response:**

```json
{
  "error": "Image not found",
  "imageId": "invalid-id"
}
```

## Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_REQUEST` | Missing or invalid parameters |
| 404 | `NOT_FOUND` | Job or image not found |
| 429 | `RATE_LIMIT` | API rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Server error |

## Example Usage

### cURL

```bash
# Start a beam search
curl -X POST http://localhost:3000/api/beam-search \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a forest at dawn", "iterations": 2}'

# Check job status
curl http://localhost:3000/api/job/job-abc123

# Download image
curl http://localhost:3000/api/images/iter2-cand0.png -o image.png
```

### JavaScript

```javascript
// Start beam search
const response = await fetch('http://localhost:3000/api/beam-search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'a forest at dawn',
    iterations: 2
  })
});
const { jobId } = await response.json();

// Poll for completion
let status;
do {
  await new Promise(r => setTimeout(r, 5000));
  const res = await fetch(`http://localhost:3000/api/job/${jobId}`);
  status = await res.json();
} while (status.status === 'in_progress');
```

## See Also

- [WebSocket API](websocket-api.md) - Real-time progress updates
- [Provider Interfaces](providers.md) - Underlying providers
