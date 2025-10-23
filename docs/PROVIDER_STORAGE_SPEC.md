# Provider Local Storage Specification

## Overview

This document defines the standardized directory structure and file formats for all providers (Image, Vision, Scoring, etc.) to store generated content locally. This structure is designed to be **human-navigable** and reflect the **beam search workflow** used in the prompt refinement process.

## Purpose

- **Persistent Storage**: DALL-E 3 image URLs expire in ~2 hours, requiring local storage
- **Human Navigation**: Directory structure mirrors the refinement workflow
- **Beam Search Tracking**: Clear visualization of iterations, candidates, and lineage
- **Cross-Provider Consistency**: All providers follow the same structure

## Directory Structure

### Base Structure

```
output/
├── YYYY-MM-DD/                    # Date-based organization
│   └── session-HHMMSS/            # Session timestamp (e.g., session-143052)
│       ├── metadata.json          # Full beam search tracking
│       ├── original-prompt.txt    # Starting prompt
│       ├── iter-00/               # Zero-indexed iterations
│       │   ├── candidate-00-what/ # Zero-indexed candidates
│       │   │   ├── prompt.txt
│       │   │   ├── image.png
│       │   │   └── score.json
│       │   ├── candidate-01-what/
│       │   └── candidate-02-how/
│       └── iter-01/               # Next iteration
│           └── candidate-00-how/  # Refined from best of iter-00
```

### Key Conventions

- **Zero-Indexed**: Iterations and candidates start at 0
  - `iter-00`, `iter-01`, `iter-02`, etc.
  - `candidate-00`, `candidate-01`, `candidate-02`, etc.
- **Two-Digit Padding**: Use `iter-00` not `iter-0`
- **Dimension Suffix**: Candidates include refinement dimension
  - `candidate-00-what`, `candidate-01-how`
- **Date Format**: `YYYY-MM-DD` (e.g., `2025-10-23`)
- **Session Format**: `session-HHMMSS` (e.g., `session-143052`)

## Required Files

### Per-Candidate Files

Each `candidate-XX-dimension/` directory MUST contain:

#### 1. `prompt.txt`

Plain text file containing the prompt used to generate this candidate.

```
A beautiful mountain landscape at sunset with dramatic lighting
```

#### 2. `image.png`

The generated image file. DALL-E 3 returns PNG format.

#### 3. `score.json`

Scoring data for this candidate.

```json
{
  "totalScore": 85.5,
  "breakdown": {
    "alignment": 80,
    "aesthetic": 9.5
  },
  "timestamp": "2025-10-23T14:30:52.123Z"
}
```

### Session-Level Files

#### 1. `original-prompt.txt`

The initial user prompt that started the refinement process.

```
mountain landscape
```

#### 2. `metadata.json`

**CRITICAL**: This file tracks the entire beam search progression and lineage.

```json
{
  "sessionId": "session-143052",
  "date": "2025-10-23",
  "originalPrompt": "mountain landscape",
  "beamWidth": 3,
  "maxIterations": 5,
  "iterations": [
    {
      "iteration": 0,
      "candidates": [
        {
          "candidateId": 0,
          "dimension": "what",
          "prompt": "detailed mountain...",
          "imagePath": "./iter-00/candidate-00-what/image.png",
          "score": 85.5
        },
        {
          "candidateId": 1,
          "dimension": "what",
          "prompt": "panoramic mountain...",
          "imagePath": "./iter-00/candidate-01-what/image.png",
          "score": 88.2
        }
      ],
      "bestCandidateId": 1
    },
    {
      "iteration": 1,
      "parentCandidateId": 1,
      "candidates": [
        {
          "candidateId": 0,
          "dimension": "how",
          "prompt": "panoramic mountain with dramatic lighting...",
          "imagePath": "./iter-01/candidate-00-how/image.png",
          "score": 90.3
        }
      ],
      "bestCandidateId": 0
    }
  ],
  "lineage": [
    { "iteration": 0, "candidateId": 1 },
    { "iteration": 1, "candidateId": 0 }
  ],
  "finalResult": {
    "iteration": 1,
    "candidateId": 0,
    "path": "./iter-01/candidate-00-how/",
    "score": 90.3
  }
}
```

**Metadata Structure Requirements:**

- **iterations**: Array of iteration objects
  - `iteration`: Zero-indexed iteration number
  - `parentCandidateId`: Which candidate from previous iteration (if applicable)
  - `candidates`: Array of candidate objects
  - `bestCandidateId`: ID of highest-scoring candidate
- **lineage**: Trace of best candidates through iterations
  - Array of `{ iteration, candidateId }` objects
  - Shows the winning path through beam search
- **finalResult**: The last iteration's best candidate
  - No separate `final/` directory needed
  - Last iteration IS the final result

## Provider-Specific Extensions

### Image Provider

Already defined above. Saves:

- `prompt.txt` - Text prompt
- `image.png` - Generated image
- `score.json` - Scoring data

### Vision Provider (Future)

The Vision Provider should extend the structure by adding critique data:

```
candidate-00-what/
├── prompt.txt      # Original image generation prompt
├── image.png       # Generated image
├── score.json      # Vision provider scores
└── critique.json   # Vision provider critique
```

**critique.json format:**

```json
{
  "alignment": {
    "score": 80,
    "explanation": "Image captures the mountain landscape but misses sunset timing"
  },
  "aesthetic": {
    "score": 9.5,
    "explanation": "Excellent composition and lighting quality"
  },
  "suggestions": [
    "Emphasize golden hour lighting",
    "Add more dramatic cloud formations"
  ],
  "timestamp": "2025-10-23T14:30:53.456Z"
}
```

### LLM Provider

The LLM Provider creates prompts but doesn't directly save to beam search structure. However, it should provide metadata that Image/Vision providers can use:

```javascript
{
  refinedPrompt: "...",
  explanation: "...",
  metadata: {
    dimension: "what",  // Used in candidate directory naming
    // ... other metadata
  }
}
```

## Configuration Options

Providers MUST support these configuration options:

### `saveLocally`

- **Type**: Boolean
- **Default**: `true`
- **Purpose**: Enable/disable local storage

```javascript
const provider = new OpenAIImageProvider(apiKey, {
  saveLocally: false  // Disable local storage
});
```

### `outputDir`

- **Type**: String
- **Default**: `'./output'`
- **Purpose**: Base directory for all output

```javascript
const provider = new OpenAIImageProvider(apiKey, {
  outputDir: '/custom/output/path'
});
```

### `sessionId`

- **Type**: String
- **Default**: Auto-generated from current time
- **Purpose**: Allow custom session naming

```javascript
const provider = new OpenAIImageProvider(apiKey, {
  sessionId: 'my-test-session'
});
```

## Beam Search Context

When calling `generateImage()` or similar methods, providers MUST accept beam search context:

```javascript
const result = await imageProvider.generateImage(prompt, {
  // Standard options
  size: '1024x1024',
  quality: 'hd',

  // Beam search context
  iteration: 1,      // Zero-indexed
  candidateId: 2,    // Zero-indexed
  dimension: 'what'  // or 'how'
});
```

The provider uses this context to:

1. Create the correct directory path
2. Save files in the right location
3. Update metadata.json with iteration tracking

## Implementation Guidelines

### Directory Creation

- Use `fs.mkdir(path, { recursive: true })` for nested directories
- Create directories on-demand when saving files
- Handle existing directories gracefully

### File Naming

- Use consistent extensions: `.txt`, `.png`, `.json`
- Use lowercase filenames
- Use hyphens for multi-word names: `original-prompt.txt`

### Error Handling

- Gracefully handle file system errors
- Don't fail image generation if saving fails
- Log errors but return successful generation result
- Consider retry logic for transient failures

### Metadata Updates

- Update `metadata.json` after each candidate generation
- Use atomic writes (write to temp file, then rename)
- Pretty-print JSON with 2-space indentation
- Include timestamps in ISO 8601 format

### URL Expiry Mitigation

- Download images immediately after generation
- Don't rely on URLs for long-term storage
- Return both URL (for immediate use) and localPath (for persistence)

## Return Format

Providers that save locally MUST return both URL and local path:

```javascript
{
  url: 'https://example.com/image.png',           // Temporary URL
  localPath: './output/2025-10-23/session-143052/iter-01/candidate-02-what/image.png',
  revisedPrompt: 'A detailed prompt',
  metadata: {
    model: 'dall-e-3',
    size: '1024x1024',
    quality: 'standard',
    style: 'vivid',
    timestamp: '2025-10-23T14:30:52.123Z',
    beamSearch: {
      iteration: 1,
      candidateId: 2,
      dimension: 'what'
    }
  }
}
```

## Testing Requirements

All providers MUST include tests for:

- Directory creation
- File writing (prompt.txt, image, score.json)
- Metadata.json creation and updates
- Beam search context handling
- Configuration options (saveLocally, outputDir, sessionId)
- Error handling for file system operations

## Future Considerations

- **Compression**: Consider compressing old sessions
- **Cleanup**: Provide utilities to remove old sessions
- **Export**: Support exporting sessions to portable formats
- **Visualization**: Tools to visualize beam search progression
- **Comparison**: Side-by-side candidate comparison tools

## Version

- **Version**: 1.0.0
- **Date**: 2025-10-23
- **Status**: Active

## Changes

- 2025-10-23: Initial specification based on Image Provider requirements
