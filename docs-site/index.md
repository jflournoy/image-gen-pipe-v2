# Image Generation Pipeline v2

**AI-powered iterative image generation with intelligent prompt refinement**

## Overview

Image Generation Pipeline (IGP) v2 is a Node.js application that iteratively refines prompts and generates high-quality images using cloud-based AI services. It uses a beam search algorithm to explore prompt variations while maintaining the best candidates.

## Key Features

- **Iterative Refinement**: Beam search algorithm for exploring prompt variations
- **OpenAI Integration**: GPT-4 for prompt refinement, DALL-E 3 for image generation, GPT-4V for evaluation
- **Intelligent Scoring**: Alignment scoring (0-100) + aesthetic quality scoring (0-10)
- **Real-time Updates**: WebSocket-based progress monitoring
- **React Frontend**: Production-ready UI components with accessibility features
- **Test-Driven**: Comprehensive test coverage with 410+ tests

## Architecture

```
┌─────────────┐
│  Web UI     │  React + Vite
│  API Client │
└──────┬──────┘
       │
┌──────▼──────┐
│ API Server  │  Express + WebSocket
└──────┬──────┘
       │
┌──────▼──────────────────────┐
│   Pipeline Orchestrator     │
│  - Beam Search Algorithm    │
│  - Prompt Refinement Logic  │
│  - Scoring & Ranking        │
└──────┬──────────────────────┘
       │
┌──────▼──────────────────────┐
│     Provider Layer          │
│  - LLM (GPT-4)              │
│  - Image Gen (DALL-E 3)     │
│  - Vision (GPT-4V)          │
│  - Scoring (Mock/Custom)    │
└─────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

# Run the complete demo
node demo-single-iteration.js
```

## Project Status

| Component | Status | Notes |
|-----------|--------|-------|
| LLM Provider (OpenAI) | ✅ Complete | Expand, refine, combine prompts |
| Image Provider (OpenAI) | ✅ Complete | DALL-E 3 + local storage |
| Vision Provider (OpenAI) | ✅ Complete | GPT-4V for alignment + aesthetic scoring |
| Beam Search Orchestrator | ✅ Complete | Full streaming parallel implementation |
| API Server | ✅ Complete | Express + WebSocket |
| React Frontend | ✅ Complete | Production-ready components |
| Mock Providers | ✅ Complete | For testing (5 mock providers) |

## Documentation

- [Quick Start](getting-started/quickstart.md) - Get up and running
- [API Setup](getting-started/api-setup.md) - Configure API keys
- [Beam Search Algorithm](concepts/beam-search-algorithm.md) - Core algorithm details
- [Streaming Architecture](concepts/streaming-parallel-architecture.md) - Performance optimization

## License

MIT License - see [LICENSE](https://github.com/jflournoy/image-gen-pipe-v2/blob/main/LICENSE) for details.
