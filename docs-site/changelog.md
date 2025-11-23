# Changelog

All notable changes to the Image Generation Pipeline are documented here.

## [2.0.0] - 2025-11-21

### Added

- Complete documentation audit and restructure
- MkDocs configuration for building HTML documentation
- Comprehensive API documentation (REST, WebSocket, Providers)
- WHAT vs HOW prompts conceptual guide

### Changed

- Updated README.md to reflect actual implementation status
- Updated BEAM_SEARCH_ALGORITHM.md implementation checklist
- Updated streaming-parallel-architecture.md checklist
- Corrected technology stack documentation (JavaScript, not TypeScript)

### Fixed

- Documentation inaccuracies about Vision Provider status (was complete)
- Documentation inaccuracies about Orchestrator status (was complete)
- Test image URLs changed to use reliable picsum.photos

## [1.5.0] - 2025-11-06

### Added

- React frontend components (ErrorDisplay, LoadingSkeleton, ProgressVisualization)
- TDD workflow for component development
- Session retrospective documentation

## [1.4.0] - 2025-11-01

### Added

- OpenAI Vision Provider (GPT-4V for image evaluation)
- Beam Search Orchestrator with streaming parallel architecture
- API server with WebSocket support

## [1.3.0] - 2025-10-30

### Added

- OpenAI Image Provider (DALL-E 3)
- Local storage with session-based directory structure
- Image download and persistence

## [1.2.0] - 2025-10-28

### Added

- OpenAI LLM Provider (GPT-4)
- Prompt expansion, refinement, and combination
- WHAT vs HOW dimension support

## [1.1.0] - 2025-10-23

### Added

- Mock providers for all interfaces
- Provider factory pattern
- Beam search algorithm specification
- Provider storage specification

## [1.0.0] - 2025-10-01

### Added

- Initial project structure
- Provider interface definitions
- Basic test infrastructure
- TDD workflow commands
