# Quick Start

Get up and running with the Image Generation Pipeline in minutes.

## Prerequisites

- Node.js 18 or higher
- npm
- OpenAI API key (for real providers)

## Installation

```bash
# Clone the repository
git clone https://github.com/jflournoy/image-gen-pipe-v2.git
cd image-gen-pipe-v2

# Install dependencies
npm install
```

## Configuration

Create a `.env` file with your API keys:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```env
OPENAI_API_KEY=sk-your-api-key-here
```

## Running the Demos

### Single Iteration Demo (Recommended)

The best way to understand the pipeline is to run the complete single-iteration demo:

```bash
node demo-single-iteration.js
```

This shows all 7 steps of the pipeline:

1. Prompt expansion (WHAT + HOW)
2. Prompt combination
3. Image generation (DALL-E 3)
4. Vision evaluation (GPT-4V)
5. Scoring calculation
6. Critique generation
7. Prompt refinement

### Multi-Iteration Beam Search

Run the full beam search algorithm:

```bash
node demo-beam-search.js
```

This runs 3 iterations with N=4 candidates and M=2 beam width.

### Provider Demo

Test individual providers with mock or real mode:

```bash
# Mock providers (no API key needed)
node demo.js

# Real OpenAI providers
node demo.js --real
```

### Vision Evaluation Demo

Focused demo of the vision evaluation system:

```bash
node demo-prompt-fidelity.js
```

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:check
```

## Starting the API Server

```bash
# Start the server
npm run dev

# Server runs at http://localhost:3000
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/beam-search` | POST | Start beam search job |
| `/api/job/:jobId` | GET | Get job status |
| `/api/images/:imageId` | GET | Serve generated images |

### WebSocket

Connect to `ws://localhost:3000` for real-time job progress updates.

## Next Steps

- [API Setup](api-setup.md) - Configure additional API options
- [Beam Search Algorithm](../concepts/beam-search-algorithm.md) - Understand the core algorithm
- [Streaming Architecture](../concepts/streaming-parallel-architecture.md) - Learn about performance optimization
