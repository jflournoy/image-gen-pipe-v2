# Contributing

Contributions are welcome! This guide explains how to contribute to the Image Generation Pipeline.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/jflournoy/image-gen-pipe-v2.git
cd image-gen-pipe-v2

# Install dependencies
npm install

# Run tests to verify setup
npm test
```

## Development Workflow

This project uses **Test-Driven Development (TDD)** with Claude Code assistance.

### Basic Workflow

1. **Check project health**: Run `/hygiene` to see current status
2. **Create a task**: Use `/todo add "description"` or create a GitHub Issue
3. **Write tests first**: Follow TDD RED-GREEN-REFACTOR cycle
4. **Implement code**: Write minimal code to pass tests
5. **Commit**: Use `/commit` for quality-checked commits

### TDD Cycle

```bash
# Start TDD workflow
/tdd start "feature name"

# 1. RED: Write failing test
# 2. GREEN: Write minimal code to pass
# 3. REFACTOR: Improve with test safety net
# 4. COMMIT: Ship working, tested code
```

## Code Standards

### JavaScript Style

- ES2022+ features (async/await, modules)
- CommonJS modules (`.js` files use `require()`)
- PropTypes for React components
- JSDoc comments for public APIs

### File Organization

```
src/
├── api/          # Express server and routes
├── config/       # Configuration management
├── factory/      # Provider factory pattern
├── orchestrator/ # Beam search orchestrator
├── providers/    # Provider implementations
├── services/     # Business logic services
├── types/        # Type definitions (JSDoc)
└── utils/        # Utility functions

test/
├── providers/    # Provider unit tests
├── orchestrator/ # Orchestrator tests
└── ...           # Other test files

frontend/
└── src/
    ├── components/ # React components
    └── hooks/      # Custom hooks
```

### Testing

- Use Node.js built-in test runner
- Test files: `*.test.js` or `*.test.jsx`
- 410+ tests required to pass
- Run with `npm test`

### Commit Messages

Follow conventional commits:

```
type(scope): description

feat: add new feature
fix: resolve bug
docs: update documentation
test: add tests
refactor: restructure code
chore: maintenance tasks
style: formatting changes
```

Always include:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes following TDD
4. Run tests: `npm test`
5. Run linting: `npm run lint:check`
6. Commit with quality checks: `/commit`
7. Push to your fork
8. Open a Pull Request

## Code Review Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint:check`)
- [ ] Markdown validates (`npm run markdown:lint`)
- [ ] Feature has tests
- [ ] Documentation updated if needed
- [ ] No breaking changes (or documented)

## Getting Help

- Check existing [GitHub Issues](https://github.com/jflournoy/image-gen-pipe-v2/issues)
- Review the [documentation](../index.md)
- Use `/hygiene` to diagnose issues

## See Also

- [TDD Workflow](tdd-workflow.md)
- [Command Reference](command-reference.md)
