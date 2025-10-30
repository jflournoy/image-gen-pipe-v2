# Image Generation Pipeline v2 🎨

**AI-powered iterative image generation with intelligent prompt refinement**

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.3%2B-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-purple)](LICENSE)
[![Status](https://img.shields.io/badge/status-in%20development-yellow)](https://github.com/jflournoy/image-gen-pipe-v2)
[![Commands](https://img.shields.io/badge/commands-14-orange)](.claude/commands/)

## Overview

Image Generation Pipeline (IGP) v2 is a TypeScript/Node.js rewrite of the [Python SDXL prompt generator](https://github.com/jflournoy/sdxl-prompt-gen-eval), designed to iteratively refine prompts and generate high-quality images using cloud-based AI services.

### Key Features

- 🔄 **Iterative Refinement**: Beam search algorithm for exploring prompt variations
- 🎯 **Multi-Provider Support**: OpenAI, Anthropic, Replicate, and more
- 📊 **Intelligent Scoring**: CLIP-like alignment + aesthetic quality scoring
- 🖥️ **Dual Interface**: Web UI (React) + CLI tool
- ⚡ **Real-time Updates**: WebSocket-based progress monitoring
- 🧪 **Test-Driven**: Built with comprehensive test coverage

## Architecture

```
┌─────────────┐
│  Web UI     │  React + Vite + Tailwind
│  CLI Tool   │  Commander.js
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
│  - LLM (GPT-4, Claude)      │
│  - Image Gen (DALL-E 3)     │
│  - Vision (GPT-4V, Claude)  │
│  - Scoring (CLIP, Custom)   │
└─────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run complete single iteration demo (recommended!)
node demo-single-iteration.js

# Or run original multi-provider demo
node demo.js --real

# Or run prompt fidelity evaluation demo
node demo-prompt-fidelity.js
```

### Demos

- **`demo-single-iteration.js`** ⭐ - Complete single iteration showing all 7 steps working together
- **`demo.js`** - Original multi-provider demo (mock or real)
- **`demo-prompt-fidelity.js`** - Focused demo of vision evaluation

## Development Workflow

This project follows **Test-Driven Development (TDD)** using the claude-setup tooling:

```bash
# Start TDD workflow
/tdd start "feature name"

# Check project health
/hygiene

# Make atomic commits
/commit

# View current tasks
/todo list
```

See [CLAUDE.md](CLAUDE.md) for full development guidelines.

## Core Concepts

### Beam Search
Maintains top-k candidate prompts across refinement rounds, exploring promising variations while pruning poor performers.

### WHAT vs HOW Prompts
- **WHAT**: Content-focused (subjects, objects, actions)
- **HOW**: Style-focused (lighting, composition, atmosphere)

WHAT and HOW are refined **separately** throughout the pipeline:
- Both start with the same user prompt
- Each gets independently expanded and refined
- They're **combined only at image generation time**
- Refinement alternates: odd rounds refine WHAT, even rounds refine HOW
- Different scoring: CLIP for WHAT, aesthetic for HOW

See [Beam Search Algorithm](docs/BEAM_SEARCH_ALGORITHM.md) for complete workflow.

### Scoring System
- **Alignment Score**: Text-image semantic similarity (0-100)
- **Aesthetic Score**: Visual quality evaluation (0-10)
- **Combined Score**: Weighted combination (configurable alpha)

## Project Status

🚧 **Currently in development** - Real providers in progress, orchestrator next:

### Completed (✅)
- [x] Provider abstraction layer (100% ✅)
  - [x] ImageGenerationProvider interface (13 tests)
  - [x] LLMProvider interface (24 tests)
  - [x] VisionProvider interface (26 tests)
  - [x] ScoringProvider interface (25 tests)
- [x] Mock providers for testing (88 tests passing)
- [x] **OpenAI LLM Provider** - Expand, refine, combine prompts ✅
- [x] **OpenAI Image Provider** - DALL-E 3 with local storage ✅

### In Progress (🚧)
- [ ] **Vision/Evaluation Provider** - ⚠️ **BLOCKING** - Required for feedback loop
  - Options: GPT-4 Vision, CLIP score, or hybrid
  - Needs image scoring + critique generation
- [ ] **Beam Search Orchestrator** (Issue #3)
  - Blocked by Vision Provider
  - Will coordinate full 8-step pipeline
- [ ] CLI interface
- [ ] Web UI

### Component Status
| Component | Status | Notes |
|-----------|--------|-------|
| LLM Provider (OpenAI) | ✅ Complete | Expand, refine, combine |
| Image Provider (OpenAI) | ✅ Complete | DALL-E 3 + storage |
| Vision Provider | ❌ Not started | **Next priority** |
| Scoring Provider | ❌ Blocked | Needs Vision Provider |
| Orchestrator | ❌ Blocked | Needs Vision Provider |

See [GitHub Issues](https://github.com/jflournoy/image-gen-pipe-v2/issues) for detailed tracking.

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + Vite + TypeScript + Tailwind CSS |
| **Backend** | Node.js 18+ + Express + WebSocket |
| **State** | Zustand |
| **Testing** | Node.js Test Runner (built-in) |
| **AI Services** | OpenAI API, Anthropic API, Replicate |

## Python Version

This is a TypeScript rewrite of the original Python implementation:
- **Original**: [jflournoy/sdxl-prompt-gen-eval](https://github.com/jflournoy/sdxl-prompt-gen-eval)
- **Why rewrite?**: Better web UI support, easier deployment, stronger typing

## Documentation

- [Development Guide](CLAUDE.md) - AI-assisted development workflow
- [Beam Search Algorithm](docs/BEAM_SEARCH_ALGORITHM.md) - Complete WHAT/HOW refinement workflow
- [Streaming Parallel Architecture](docs/streaming-parallel-architecture.md) - Performance-optimized execution model for orchestrator
- [Provider Storage Spec](docs/PROVIDER_STORAGE_SPEC.md) - Local storage structure and conventions
- Software Requirements Specification (Coming Soon) - Complete technical spec
- Architecture Guide (Coming Soon) - System design details
- API Documentation (Coming Soon) - REST + WebSocket API reference

## Contributing

Contributions welcome! This project uses:
- **TDD methodology** - Write tests first
- **Atomic commits** - Small, focused commits
- **Claude Code workflow** - AI-assisted development

See [CLAUDE.md](CLAUDE.md) for development guidelines.

## License

MIT License - see [LICENSE](LICENSE) file.

---

*Built with Claude Code + TDD methodology*
