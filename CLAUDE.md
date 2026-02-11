# CLAUDE.md - Project AI Guidelines

## 🚀 Project Status: ALPHA

**This is alpha software in active development.**

- ❌ **NO backward compatibility required** - Make breaking changes freely
- ✅ **Prioritize code quality** over maintaining old APIs
- ✅ **Refactor aggressively** when it improves architecture
- ✅ **Remove unused code** without deprecation periods
- 💡 **Focus on getting it right** rather than keeping it stable

Since we're pre-1.0, every change is an opportunity to improve the foundation.

## State Tracking

**Use two complementary systems for tracking work:**

1. **TodoWrite tool** (primary) - Use for task management visible to the user
   - Break work into discrete, actionable items
   - Mark tasks in_progress/completed as you work
   - Good for: task lists, progress tracking, user visibility

2. **`.claude-current-status` file** (supplementary) - Higher-resolution notes
   - Timestamps, context, decisions, file references
   - Details that don't fit in todo items
   - Session continuity across conversations
   - Good for: debugging context, decision rationale, file locations

**Workflow:** Start tasks with TodoWrite, always add detailed notes to `.claude-current-status`. When you add notes, re-assess and clean up old notes using /condense.


## Development Method: TDD

**RECOMMENDED: Use Test-Driven Development for new features**

TDD helps Claude produce more focused, correct code by clarifying requirements upfront and reducing wildly wrong approaches.

### Benefits of TDD with Claude

- **Without TDD**: Claude may over-engineer or miss requirements
- **With TDD**: Claude writes targeted code that meets specific criteria

### TDD Workflow

1. 🔴 **RED**: Write a failing test to define requirements
2. 🟢 **GREEN**: Write minimal code to pass the test
3. 🔄 **REFACTOR**: Improve code with test safety net
4. ✓ **COMMIT**: Ship working, tested code

### The TDD Command

```bash
/tdd start "your feature"  # Guides through the TDD cycle
```

Consider TDD especially for complex features or when requirements are unclear.

### Attribution

The TDD workflow approach with AI pair programming is inspired by [Rebecca Murphey's work on LLM-driven development](https://rmurphey.com). Her insights on using Test-Driven Development to guide AI assistants toward better code quality have been foundational to this project's development methodology.

## Critical Instructions

**ALWAYS use `date` command for dates** - Never assume or guess dates. Always run `date "+%Y-%m-%d"` when you need the current date for documentation, commits, or any other purpose.

**NEVER start GPU-heavy processes without asking** - Do not spawn Flux service, LLM service, or other resource-intensive processes (model loading, generation, downloads) without explicit user permission. This project runs on a single 12GB GPU shared across services, and starting processes can:
- Block other services from running
- Consume significant GPU/CPU resources
- Take 10-30 minutes for model initialization
- Potentially crash the system if resources are exhausted

Always ask: "Should I start the [service] service?" before executing service spawn commands or model initialization.

## AI Integrity Principles

**CRITICAL: Always provide honest, objective recommendations based on technical merit, not user bias.**

- **Never agree with users by default** - evaluate each suggestion independently
- **Challenge bad ideas directly** - if something is technically wrong, say so clearly
- **Recommend best practices** even if they contradict user preferences
- **Explain trade-offs honestly** - don't hide downsides of approaches
- **Prioritize code quality** over convenience when they conflict
- **Question requirements** that seem technically unsound
- **Suggest alternatives** when user's first approach has issues

Examples of honest responses:

- "That approach would work but has significant performance implications..."
- "I'd recommend against that pattern because..."
- "While that's possible, a better approach would be..."
- "That's technically feasible but violates \[principle] because..."

## Development Workflow

- Always run quality checks before commits
- Use custom commands for common tasks
- Document insights and decisions
- Estimate Claude usage before starting tasks
- Track actual vs estimated Claude interactions

## Quality Standards

- Quality Level: {{QUALITY\_LEVEL}}
- Team Size: {{TEAM\_SIZE}}
- Zero errors policy
- {{WARNING\_THRESHOLD}} warnings threshold

## Testing Standards

**CRITICAL: Any error during test execution = test failure**

- **Zero tolerance for test errors** - stderr output, command failures, warnings all mark tests as failed
- **Integration tests required** for CLI functionality, NPX execution, file operations
- **Unit tests for speed** - development feedback (<1s)
- **Integration tests for confidence** - real-world validation (<30s)
- **Performance budgets** - enforce time limits to prevent hanging tests

### GPU/Resource-Intensive Tests

**CRITICAL: Always use `--test-concurrency=1` for GPU or resource-intensive tests**

Node.js test runner defaults to running tests in parallel (one per CPU core). For tests that:
- Load large ML models (GPU or CPU)
- Consume significant RAM (>5GB per test)
- Access exclusive resources (GPU, file locks, ports)

**Always force sequential execution**:

```bash
# ✅ CORRECT: Sequential execution
node --test --test-concurrency=1 test/integration/*.test.js

# ❌ WRONG: Parallel execution (default)
node --test test/integration/*.test.js  # Can run 20+ tests in parallel!
```

**Why this matters**: On a 20-core system, parallel execution can spawn 20 simultaneous tests.
If each test loads a 10GB model, that's 200GB RAM spike → system OOM → desktop crash.

**Example from this project**:
- Flux model load: ~20GB RAM per test
- Parallel execution: 2 tests × 20GB = 40GB spike → OOM crash
- Sequential execution: 1 test × 20GB = safe on 62GB system

## Markdown Standards

**All markdown files must pass validation before commit**

- **Syntax validation** - Uses remark-lint to ensure valid markdown syntax
- **Consistent formatting** - Enforces consistent list markers, emphasis, and code blocks
- **Link validation** - Checks that internal links point to existing files
- **Auto-fix available** - Run `npm run markdown:fix` to auto-correct formatting issues

### Markdown Quality Checks

- `npm run markdown:lint` - Validate all markdown files
- `npm run markdown:fix` - Auto-fix formatting issues
- Included in `hygiene:quick` and `commit:check` scripts
- CI validates markdown on every push/PR

### Markdown Style Guidelines

- Use `-` for unordered lists
- Use `*` for emphasis, `**` for strong emphasis
- Use fenced code blocks with language tags
- Use `.` for ordered list markers
- Ensure all internal links are valid

## Commands

- `/hygiene` - Project health check
- `/todo` - Task management
- `/commit` - Quality-checked commits
- `/design` - Feature planning
- `/estimate` - Claude usage cost estimation
- `/next` - AI-recommended priorities
- `/learn` - Capture insights
- `/docs` - Update documentation

## Architecture Principles

- Keep functions under 15 complexity
- Code files under 400 lines
- Comprehensive error handling
- Prefer functional programming patterns
- Avoid mutation where possible

### Key Architecture Documents

- **[Streaming Parallel Architecture](docs/streaming-parallel-architecture.md)** - CRITICAL for implementing orchestrator
  - Defines streaming parallel execution model
  - Shows how to maximize async throughput
  - Provides code patterns for Zone 1 & Zone 2 streaming
  - Must reference when building beam search orchestrator

## Dependency Management

**This project uses `uv` for fast, deterministic Python dependency management.**

### Setup

```bash
# Install dependencies
uv sync

# Run a command in the virtual environment
uv run python script.py

# Add new dependency
uv add package-name

# Update dependencies
uv lock
```

### Project Structure

- **`pyproject.toml`** - Project metadata and dependencies
- **`uv.lock`** - Lock file (commit to version control)
- **`services/` workspace** - Services are part of the uv workspace

### Key Commands

```bash
# Install all dependencies and create virtual environment
uv sync

# Activate virtual environment (optional, uv run handles this)
source .venv/bin/activate  # Linux/Mac
# or
.venv\Scripts\activate  # Windows

# Install development dependencies
uv sync --dev

# Run specific test
uv run pytest tests/test_face_fixing.py

# Run Flux service
uv run python services/flux_service.py
```

### Adding New Dependencies

When adding new dependencies (like face fixing models):

```bash
# Add to main dependencies
uv add mediapipe>=0.10.0

# Or edit pyproject.toml and sync
uv sync
```

Dependencies are automatically added to `uv.lock` for reproducibility.

### Local Model Stack

This project uses **llama-cpp-python** for running quantized GGUF models locally:

- **Location**: `services/` directory contains Python FastAPI services
- **LLM Service**: Uses llama-cpp-python for prompt refinement (Mistral 7B Q4)
- **Flux Service**: Uses diffusers with sequential CPU offload for 12GB GPUs
- **Vision Service**: Uses CLIP for alignment scoring, aesthetic predictor for quality
- **VLM Service**: Uses llama-cpp-python with multimodal GGUF (Qwen2.5-VL 7B Q4) for pairwise image comparison
  - **Separate Evaluations Mode** (opt-in): Evaluates alignment (prompt match) and aesthetics (visual quality) independently
  - Makes 2 focused API calls per comparison vs 1 combined call
  - Benefits: More accurate, independent assessment of each dimension
  - Trade-off: ~2x inference time (~10-12s vs ~5-6s per comparison)
  - UI Control: "Use Separate Evaluations" checkbox in VLM settings
  - Backend: `useSeparateEvaluations` parameter passed to `LocalVLMProvider`
- **Model Coordinator**: `src/utils/model-coordinator.js` manages GPU memory by unloading models before loading others

**Key constraints**:

- Single 12GB GPU shared across services
- Flux (~10GB) and LLM/VLM cannot run simultaneously
- Model coordinator ensures only one heavy model loaded at a time

**Setup**: See [services/README.md](services/README.md) for installation and configuration

## Claude Usage Guidelines

- Use `/estimate` before starting any non-trivial task
- Track actual Claude interactions vs estimates
- Optimize for message efficiency in complex tasks
- Budget Claude usage for different project phases

**Typical Usage Patterns**:

- **Bug Fix**: 10-30 messages
- **Small Feature**: 30-80 messages
- **Major Feature**: 100-300 messages
- **Architecture Change**: 200-500 messages

## Collaboration Guidelines

- Always add Claude as co-author on commits
- Run `/hygiene` before asking for help
- Use `/todo` for quick task capture
- Document learnings with `/learn`
- Regular `/reflect` sessions for insights

## Project Standards

- Test coverage: 60% minimum
- Documentation: All features documented
- Error handling: Graceful failures with clear messages
- Performance: Monitor code complexity and file sizes
- ALWAYS use atomic commits
- use emojis, judiciously
- NEVER Update() a file before you Read() the file.

### TDD Examples

- [🔴 test: add failing test for updateCommandCatalog isolation (TDD RED)](../../commit/00e7a22)
- [🔴 test: add failing tests for tdd.js framework detection (TDD RED)](../../commit/2ce43d1)
- [🔴 test: add failing tests for learn.js functions (TDD RED)](../../commit/8b90d58)
- [🔴 test: add failing tests for formatBytes and estimateTokens (TDD RED)](../../commit/1fdac58)
- [🔴 test: add failing tests for findBrokenLinks (TDD RED phase)](../../commit/8ec6319)
