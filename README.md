# Image Generation Pipeline v2 🎨

**AI-powered iterative image generation with intelligent prompt refinement**

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/javascript-ES2022-yellow)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-purple)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-410%2B%20passing-green)](https://github.com/jflournoy/image-gen-pipe-v2)
[![Commands](https://img.shields.io/badge/commands-14-orange)](.claude/commands/)

## Overview

Image Generation Pipeline (IGP) v2 is a Node.js rewrite of the [Python SDXL prompt generator](https://github.com/jflournoy/sdxl-prompt-gen-eval), designed to iteratively refine prompts and generate high-quality images using cloud-based AI services.

### Key Features

- 🔄 **Iterative Refinement**: Beam search algorithm for exploring prompt variations
- 🎯 **OpenAI Integration**: GPT-4 for LLM, DALL-E 3 for images, GPT-4V for vision evaluation
- 📊 **Intelligent Scoring**: Alignment scoring (0-100) + aesthetic quality scoring (0-10)
- 🖥️ **React Frontend**: Production-ready UI components with accessibility features
- ⚡ **Real-time Updates**: WebSocket-based progress monitoring
- 🧪 **Test-Driven**: 410+ tests with comprehensive coverage

## Architecture

```
┌─────────────┐
│  Web UI     │  React + Vite
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
│  - Scoring (Mock + Custom)  │
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

✅ **Core pipeline complete** - All providers and orchestrator implemented and tested.

### Component Status

| Component | Status | Notes |
|-----------|--------|-------|
| LLM Provider (OpenAI) | ✅ Complete | Expand, refine, combine prompts via GPT-4 |
| Image Provider (OpenAI) | ✅ Complete | DALL-E 3 with local storage |
| Vision Provider (OpenAI) | ✅ Complete | GPT-4V for alignment + aesthetic scoring |
| Beam Search Orchestrator | ✅ Complete | Full streaming parallel implementation |
| API Server | ✅ Complete | Express + WebSocket with job management |
| React Frontend | ✅ Complete | Production components with accessibility |
| Mock Providers | ✅ Complete | 5 mock providers for testing |

### Test Coverage

- **410+ tests passing** across backend and frontend
- Provider interfaces: 88+ tests
- Orchestrator: Full integration tests
- Frontend components: Unit + accessibility tests

### Future Enhancements

- [ ] Additional provider support (Anthropic, Replicate)
- [ ] CLI interface
- [ ] CLIP-based scoring (currently using GPT-4V)
- [ ] Performance optimizations

See [GitHub Issues](https://github.com/jflournoy/image-gen-pipe-v2/issues) for detailed tracking.

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + Vite + PropTypes |
| **Backend** | Node.js 18+ + Express + WebSocket |
| **Testing** | Node.js Test Runner (built-in) |
| **AI Services** | OpenAI API (GPT-4, DALL-E 3, GPT-4V) |
| **Documentation** | MkDocs with Material theme |

## Python Version

This is a JavaScript/Node.js rewrite of the original Python implementation:

- **Original**: [jflournoy/sdxl-prompt-gen-eval](https://github.com/jflournoy/sdxl-prompt-gen-eval)
- **Why rewrite?**: Better web UI support, easier deployment, modern async patterns

## Documentation

### Building Documentation

```bash
# Install MkDocs
pip install mkdocs mkdocs-material mkdocs-mermaid2-plugin

# Serve locally (with hot reload)
mkdocs serve

# Build static HTML
mkdocs build
```

### Documentation Links

- [Beam Search Algorithm](docs/BEAM_SEARCH_ALGORITHM.md) - Complete WHAT/HOW refinement workflow
- [Streaming Parallel Architecture](docs/streaming-parallel-architecture.md) - Performance-optimized execution model
- [Provider Storage Spec](docs/PROVIDER_STORAGE_SPEC.md) - Local storage structure and conventions
- [Development Guide](CLAUDE.md) - AI-assisted development workflow

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
