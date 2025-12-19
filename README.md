# Image Generation Pipeline v2 🎨

**Learning by building: applying ML concepts to smarter image generation pipelines**

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/javascript-ES2022-yellow)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-purple)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-410%2B%20passing-green)](https://github.com/jflournoy/image-gen-pipe-v2)
[![Commands](https://img.shields.io/badge/commands-14-orange)](.claude/commands/)

## Why this exists

I'm a research methodologist getting curious about the tools developers are using. [Claude Code](https://claude.ai/code), test-driven development workflows, LLM APIs—these are reshaping how people build software, and I wanted to understand them from the inside.

This project is me figuring out how these pieces fit together: taking machine learning concepts I know (beam search, iterative refinement) and building a pipeline that actually uses them. It's a learning exercise that happens to produce something functional. I'm also starting to apply TDD to my analysis code, and working through this project has given me a much clearer sense of where these tools can make a difference in research workflows.

If you're thinking about similar explorations—applying computational ideas to new problems, getting comfortable with LLM APIs, or just seeing what Claude Code can do—this might be useful as a working example.

## What it does

This is a rewrite of my [earlier Python SDXL prompt generator](https://github.com/jflournoy/sdxl-prompt-gen-eval), now built in Node.js with a focus on iterative refinement. It uses OpenAI's APIs to:

1. Generate multiple candidate prompts from a starting idea
2. Create images from those prompts
3. Evaluate them on both alignment (does it match what was asked?) and aesthetics (does it look good?)
4. Keep the best candidates and refine them further
5. Repeat until you converge on high-quality results

The pipeline implements **beam search**—a standard ML algorithm for exploring multiple promising paths simultaneously. I wanted to see how these concepts translate when you're working with LLMs and image generation APIs rather than traditional model architectures.

### Core features

- 🔄 **Iterative prompt refinement** using beam search
- 🎯 **Multi-model integration**: GPT-4 for language, DALL-E 3 for images, GPT-4V for evaluation
- 📊 **Dual scoring system**: Alignment (how well it matches) + aesthetics (how good it looks)
- 🖥️ **Live web demo**: React UI with real-time WebSocket updates
- ⚡ **Test-driven**: 410+ tests covering the pipeline end-to-end
- 🛠️ **Claude Code integration**: Custom slash commands and TDD workflow

## Quick start

```bash
# Clone and install
npm install

# Set up your OpenAI key
cp .env.example .env
# Edit .env with your API key

# Run the interactive web demo
npm run dev
# Open http://localhost:5000/demo.html

# Or try a single-iteration CLI demo
node demo-single-iteration.js
```

### Available demos

- **Web UI** (`npm run dev`) - Interactive beam search with live progress updates
- **Single iteration** (`demo-single-iteration.js`) - Complete pipeline walkthrough
- **Prompt fidelity** (`demo-prompt-fidelity.js`) - Vision evaluation focus
- **Original demo** (`demo.js --real`) - Multi-provider comparison

## How it works

### Beam search for prompts

The algorithm maintains a "beam" of the top-k candidate prompts, exploring variations while filtering out poor performers:

1. **Iteration 0**: Generate N diverse starting prompts from your input
2. **Rank**: Evaluate all candidates on alignment + aesthetics
3. **Prune**: Keep only the top M candidates
4. **Refine**: Improve each remaining candidate's prompt
5. **Repeat**: Continue until hitting max iterations or convergence

The key insight: prompts have two dimensions that need separate attention:

- **WHAT** (content): subjects, objects, actions
- **HOW** (style): lighting, composition, atmosphere

The pipeline refines these independently and combines them only at image generation. Odd iterations refine WHAT, even iterations refine HOW. This separation lets each dimension evolve without interfering with the other.

### Scoring system

Each generated image gets scored on two axes:

- **Alignment score** (0-100): How semantically similar is the image to the prompt?
- **Aesthetic score** (0-10): How good does it look?

The final score is a weighted combination (configurable alpha). This dual-objective approach ensures you don't just get images that match perfectly but look terrible, or vice versa.

## Architecture

```
┌─────────────┐
│  Web UI     │  React + Vite + accessibility features
└──────┬──────┘
       │
┌──────▼──────┐
│ API Server  │  Express + WebSocket for real-time updates
└──────┬──────┘
       │
┌──────▼──────────────────────┐
│   Pipeline Orchestrator     │
│  - Beam search algorithm    │
│  - Parallel async execution │
│  - Prompt refinement logic  │
│  - Scoring & ranking        │
└──────┬──────────────────────┘
       │
┌──────▼──────────────────────┐
│     Provider Layer          │
│  - LLM (GPT-4)              │
│  - Image Gen (DALL-E 3)     │
│  - Vision (GPT-4V)          │
│  - Mock providers for tests │
└─────────────────────────────┘
```

## Working with this codebase

I built this using Claude Code with a test-driven workflow. If you're exploring similar tools, here's the setup:

```bash
# Start TDD cycle for a new feature
/tdd start "feature name"

# Check code health (linting, tests, dependencies)
/hygiene

# Make atomic commits with quality checks
/commit

# View and manage tasks
/todo list
```

See [CLAUDE.md](CLAUDE.md) for the complete development workflow and AI-assisted practices.

### Test coverage

- 410+ tests passing across backend and frontend
- Provider interfaces: 88+ tests ensuring consistent behavior
- Orchestrator: Full integration tests with real async flows
- Frontend: Unit tests + accessibility coverage

The test suite was critical for learning—it forces you to think through edge cases and makes refactoring safe when you're still figuring out the architecture.

## Current status

✅ **Core pipeline complete** - All components implemented, tested, and documented

| Component | Status | Notes |
|-----------|--------|-------|
| LLM Provider (OpenAI) | ✅ | Expand, refine, combine prompts via GPT-4 |
| Image Provider (OpenAI) | ✅ | DALL-E 3 with local storage |
| Vision Provider (OpenAI) | ✅ | GPT-4V for alignment + aesthetic scoring |
| Beam Search Orchestrator | ✅ | Streaming parallel implementation |
| API Server | ✅ | Express + WebSocket with job management |
| React Frontend | ✅ | Accessible components with live updates |
| Mock Providers | ✅ | Fast testing without API costs |

### What's next

This is primarily a learning project, but there are natural extensions if I keep exploring:

- User-in-the-loop guidance (pause after N iterations, accept user feedback/redirection, continue search)
- Additional provider support (Anthropic, Replicate, local models)
- CLI interface for scripted workflows
- CLIP-based scoring (currently using GPT-4V as a stand-in)
- Comparing different search strategies (greedy, random, A*)

See [GitHub Issues](https://github.com/jflournoy/image-gen-pipe-v2/issues) for detailed ideas.

## Technology choices

| Layer | Technology | Why |
|-------|------------|-----|
| **Frontend** | React 18 + Vite | Modern, fast, easy WebSocket integration |
| **Backend** | Node.js + Express | Async-first, good LLM SDK support |
| **Testing** | Node.js built-in test runner | Simple, no extra dependencies |
| **AI Services** | OpenAI API | Mature, well-documented, easy to start |
| **Documentation** | MkDocs + Material | Clean, searchable, easy to maintain |

## Documentation

Detailed docs available in `/docs`:

- [Beam Search Algorithm](docs/BEAM_SEARCH_ALGORITHM.md) - Complete WHAT/HOW refinement workflow
- [Streaming Parallel Architecture](docs/streaming-parallel-architecture.md) - Performance-optimized async patterns
- [Provider Storage Spec](docs/PROVIDER_STORAGE_SPEC.md) - Local file storage conventions
- [Development Guide](CLAUDE.md) - AI-assisted workflow and TDD practices

Build and serve locally:

```bash
pip install mkdocs mkdocs-material mkdocs-mermaid2-plugin
mkdocs serve
```

## Relation to the Python version

This is a ground-up rewrite of [jflournoy/sdxl-prompt-gen-eval](https://github.com/jflournoy/sdxl-prompt-gen-eval). The Python version was an initial exploration. This JavaScript version focuses on:

- Better web UI integration (React + WebSockets)
- Cleaner async patterns (native async/await throughout)
- More rigorous testing (TDD from the start)
- Learning modern developer tooling (Claude Code, npm ecosystem)

The core algorithm is the same, but the implementation is substantially different.

## Contributing

If this resonates with your own exploration, contributions are welcome. The project follows:

- **Test-driven development** - Write tests first, then implementation
- **Atomic commits** - Small, focused changes
- **Claude Code workflow** - AI-assisted development with human oversight

See [CLAUDE.md](CLAUDE.md) for development guidelines and slash command reference.

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

*A learning project built with Claude Code, TDD methodology, and curiosity about how ML concepts translate to real-world pipelines.*
