# Beam Search Algorithm Specification

## Overview

This document specifies the beam search algorithm used for iterative prompt refinement in the Image Generation Pipeline. The algorithm maintains multiple candidate (WHAT, HOW) prompt pairs across refinement rounds, exploring promising variations while pruning poor performers.

## Core Concepts

### WHAT vs HOW Dimensions

The system separates prompts into two orthogonal dimensions:

#### WHAT - Content Dimension
- **Purpose**: Describes the semantic content of the image
- **Focus**: Characters, objects, actions, setting, mood
- **Style**: Immersive, sensory-rich prose
- **Scoring**: CLIP similarity score (semantic alignment with user intent)
- **Example**: "Towering world-tree with roots piercing starlit sky, branches cradling fragments of glowing cities"

#### HOW - Visual Style Dimension
- **Purpose**: Describes the visual execution and artistic style
- **Focus**: Lighting, composition, color palette, texture, atmosphere
- **Style**: Concrete photographic/cinematic terminology
- **Scoring**: Aesthetic quality score (visual appeal)
- **Example**: "Cinematic digital painting style, dramatic rim lighting, glowing highlights, rich color grading"

### Key Principle

**WHAT and HOW are maintained separately throughout the pipeline and only combined at image generation time.**

This separation allows:
- Independent refinement of content vs style
- Different scoring metrics for each dimension
- Targeted improvements without coupling

## Algorithm Workflow

### Phase 1: Initialization (Round 0)

```javascript
// Start with user's original prompt for both dimensions
const originalPrompt = "a mountain landscape";
const candidates = [];

for (let i = 0; i < BATCH_SIZE; i++) {
  candidates.push({
    what: originalPrompt,
    how: originalPrompt,
    iteration: 0,
    candidateId: i
  });
}
```

**Note**: Both WHAT and HOW start identical. They diverge during expansion.

### Phase 2: Initial Expansion

Each candidate undergoes separate expansion for WHAT and HOW:

```javascript
for (const candidate of candidates) {
  // Expand WHAT (content)
  candidate.whatExpanded = await llm.refinePrompt(candidate.what, {
    dimension: 'what',
    operation: 'expand'
  });

  // Expand HOW (style)
  candidate.howExpanded = await llm.refinePrompt(candidate.how, {
    dimension: 'how',
    operation: 'expand'
  });

  // Combine for image generation
  candidate.combinedPrompt = await llm.combinePrompts(
    candidate.whatExpanded,
    candidate.howExpanded
  );
}
```

#### LLM Instructions for Expansion

**WHAT Expansion Prompt**:
```
You are a prompt expander. Write a concise description (2-4 sentences)
that vividly describes WHAT is in the scene: characters, objects, actions,
setting, and mood. Use immersive, sensory-rich prose.

Expand this idea into a detailed description: "{originalPrompt}"
```

**HOW Expansion Prompt**:
```
You are a visual style describer. Describe the visual style, including
lighting, composition, color palette, texture, and atmosphere. Use concrete,
descriptive language referencing photographic or cinematic techniques.

Expand this idea into a detailed description: "{originalPrompt}"
```

### Phase 3: Image Generation & Scoring

```javascript
for (const candidate of candidates) {
  // Generate image using combined prompt
  candidate.image = await imageProvider.generateImage(
    candidate.combinedPrompt,
    {
      iteration: 0,
      candidateId: candidate.candidateId,
      dimension: 'what' // First round is WHAT-focused
    }
  );

  // Analyze with vision provider
  candidate.analysis = await visionProvider.analyzeImage(
    candidate.image.url,
    originalPrompt
  );

  // Score the candidate
  candidate.score = await scoringProvider.scoreCandidate({
    prompt: candidate.combinedPrompt,
    imageUrl: candidate.image.url,
    alignmentScore: candidate.analysis.alignmentScore
  });
}
```

### Phase 4: Beam Pruning

```javascript
// Sort by score and keep top BEAM_WIDTH candidates
const beam = candidates
  .sort((a, b) => b.score.totalScore - a.score.totalScore)
  .slice(0, BEAM_WIDTH);
```

### Phase 5: Iterative Refinement

**Key Pattern**: Alternate between refining WHAT (odd rounds) and HOW (even rounds).

```javascript
for (let round = 1; round <= MAX_ITERATIONS; round++) {
  const refineWhat = (round % 2 === 1); // Odd rounds refine WHAT
  const dimension = refineWhat ? 'what' : 'how';

  const newCandidates = [];
  const childrenPerParent = Math.floor(BATCH_SIZE / beam.length);

  for (const parent of beam) {
    for (let child = 0; child < childrenPerParent; child++) {
      const candidate = {
        what: parent.whatExpanded,
        how: parent.howExpanded,
        parentId: parent.candidateId,
        iteration: round,
        candidateId: newCandidates.length
      };

      // Refine only the target dimension
      if (refineWhat) {
        // Refine WHAT based on CLIP score
        candidate.whatRefined = await llm.refinePrompt(
          candidate.what,
          {
            dimension: 'what',
            operation: 'refine',
            critique: generateWhatCritique(parent)
          }
        );
        candidate.whatExpanded = candidate.whatRefined;
        // HOW stays the same
      } else {
        // Refine HOW based on aesthetic score
        candidate.howRefined = await llm.refinePrompt(
          candidate.how,
          {
            dimension: 'how',
            operation: 'refine',
            critique: generateHowCritique(parent)
          }
        );
        candidate.howExpanded = candidate.howRefined;
        // WHAT stays the same
      }

      // Combine refined prompts
      candidate.combinedPrompt = await llm.combinePrompts(
        candidate.whatExpanded,
        candidate.howExpanded
      );

      newCandidates.push(candidate);
    }
  }

  // Generate, analyze, score new candidates
  // (same as Phase 3)

  // Merge with beam and prune
  const allCandidates = [...beam, ...newCandidates];
  beam = allCandidates
    .sort((a, b) => b.score.totalScore - a.score.totalScore)
    .slice(0, BEAM_WIDTH);
}
```

#### Critique Generation

**WHAT Critique** (based on CLIP score):
```javascript
function generateWhatCritique(candidate) {
  return `
Current CLIP score: ${candidate.analysis.alignmentScore}/100
Current prompt: ${candidate.whatExpanded}

Identify missing or unclear content elements. Suggest clarifications
to subject, action, or setting that would improve semantic alignment
with the user's intent.
  `;
}
```

**HOW Critique** (based on aesthetic score):
```javascript
function generateHowCritique(candidate) {
  return `
Current aesthetic score: ${candidate.score.aestheticScore}/10
Current style: ${candidate.howExpanded}

Recommend specific photographic or cinematic techniques. Suggest
adjustments to depth of field, perspective, or color palette that
would enhance visual quality.
  `;
}
```

### Phase 6: Final Selection

```javascript
// Best candidate from final beam
const winner = beam[0];

// Save to storage with lineage tracking
await saveResults({
  originalPrompt,
  finalPrompt: winner.combinedPrompt,
  finalWhat: winner.whatExpanded,
  finalHow: winner.howExpanded,
  imageUrl: winner.image.url,
  localPath: winner.image.localPath,
  score: winner.score,
  lineage: traceLineage(winner) // Track parent chain
});
```

## LLM Provider Requirements

To support this algorithm, the LLM Provider must implement:

### 1. `refinePrompt(prompt, options)`

```javascript
/**
 * Refine a prompt along a specific dimension
 * @param {string} prompt - Current prompt to refine
 * @param {Object} options - Refinement options
 * @param {string} options.dimension - 'what' or 'how'
 * @param {string} options.operation - 'expand' or 'refine'
 * @param {string} [options.critique] - Feedback for refinement
 * @returns {Promise<Object>} Refined prompt with metadata
 */
```

**Operations**:
- `expand`: Initial expansion from terse to detailed
- `refine`: Iterative improvement based on critique

### 2. `combinePrompts(whatPrompt, howPrompt)`

```javascript
/**
 * Combine WHAT and HOW prompts into unified image generation prompt
 * @param {string} whatPrompt - Content description
 * @param {string} howPrompt - Style description
 * @returns {Promise<string>} Combined prompt
 */
```

**System Prompt**:
```
You are an image prompt combiner. Given a WHAT prompt (describing content)
and a HOW prompt (describing visual style), combine them into a single,
unified prompt that captures both the content and the style.

Do not lose any important details from either prompt. Maintain a richly
detailed and concise prompt that fully captures both prompts' meaning and intent.

Output only the combined prompt.
```

**Example Input**:
```
WHAT: Towering world-tree with roots piercing starlit sky, branches cradling
      fragments of glowing cities
HOW: Cinematic digital painting style, dramatic rim lighting, glowing highlights
```

**Example Output**:
```
Towering world-tree with roots piercing starlit sky, branches cradling fragments
of glowing cities, cinematic digital painting style, dramatic rim lighting,
glowing highlights, rich color grading
```

## Directory Structure Mapping

The storage structure reflects the refinement dimension:

```
output/
└── 2025-10-23/
    └── session-143052/
        ├── metadata.json
        ├── original-prompt.txt
        ├── iter-00/              # Initial expansion
        │   ├── candidate-00-what/
        │   │   ├── prompt.txt    # Combined prompt used for generation
        │   │   ├── what.txt      # WHAT component (NEW)
        │   │   ├── how.txt       # HOW component (NEW)
        │   │   ├── image.png
        │   │   └── score.json
        │   ├── candidate-01-what/
        │   └── candidate-02-what/
        ├── iter-01/              # Refining WHAT (odd round)
        │   ├── candidate-00-what/
        │   │   ├── prompt.txt
        │   │   ├── what.txt      # REFINED what
        │   │   ├── how.txt       # SAME as parent
        │   │   ├── image.png
        │   │   └── score.json
        │   └── candidate-01-what/
        └── iter-02/              # Refining HOW (even round)
            └── candidate-00-how/
                ├── prompt.txt
                ├── what.txt      # SAME as parent
                ├── how.txt       # REFINED how
                ├── image.png
                └── score.json
```

### Additional Required Files

Each candidate directory should now include:

#### `what.txt`
The WHAT component (content description) for this candidate.

#### `how.txt`
The HOW component (style description) for this candidate.

These allow reconstructing the refinement history and understanding what changed between iterations.

## Configuration Parameters

```javascript
const config = {
  BEAM_WIDTH: 3,           // Number of candidates to keep per round
  BATCH_SIZE: 9,           // Total candidates to generate per round
  MAX_ITERATIONS: 5,       // Maximum refinement rounds

  // Scoring weights
  ALPHA: 0.7,              // Weight for alignment score (CLIP)
  BETA: 0.3,               // Weight for aesthetic score

  // LLM parameters
  EXPAND_TEMPERATURE: 0.85,  // Higher creativity for expansion
  REFINE_TEMPERATURE: 0.7,   // Moderate creativity for refinement
  COMBINE_TEMPERATURE: 0.5,  // Lower creativity for combination
};
```

## Metadata Structure

The `metadata.json` should track both WHAT and HOW:

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
      "refinementDimension": "expand",
      "candidates": [
        {
          "candidateId": 0,
          "dimension": "what",
          "promptWhat": "Majestic mountain landscape...",
          "promptHow": "Dramatic lighting...",
          "promptCombined": "Majestic mountain landscape with dramatic lighting...",
          "imagePath": "./iter-00/candidate-00-what/image.png",
          "scores": {
            "clip": 85.5,
            "aesthetic": 7.8,
            "total": 86.34
          }
        }
      ],
      "bestCandidateId": 0
    },
    {
      "iteration": 1,
      "refinementDimension": "what",
      "parentCandidateId": 0,
      "candidates": [
        {
          "candidateId": 0,
          "dimension": "what",
          "promptWhat": "Majestic mountain landscape with snow-capped peaks...",
          "promptHow": "Dramatic lighting...",
          "promptCombined": "Majestic mountain landscape with snow-capped peaks and dramatic lighting...",
          "imagePath": "./iter-01/candidate-00-what/image.png",
          "scores": {
            "clip": 88.2,
            "aesthetic": 7.8,
            "total": 88.34
          }
        }
      ],
      "bestCandidateId": 0
    }
  ],
  "lineage": [
    { "iteration": 0, "candidateId": 0 },
    { "iteration": 1, "candidateId": 0 }
  ],
  "finalResult": {
    "iteration": 1,
    "candidateId": 0,
    "what": "Majestic mountain landscape with snow-capped peaks...",
    "how": "Dramatic lighting...",
    "combined": "Majestic mountain landscape with snow-capped peaks and dramatic lighting...",
    "path": "./iter-01/candidate-00-what/",
    "score": 88.34
  }
}
```

## Implementation Checklist

To implement this algorithm, you need:

### LLM Provider
- [x] Add `combinePrompts(what, how)` method ✅ (completed 2025-10-28)
- [x] Update `refinePrompt()` to support `operation` parameter ('expand' vs 'refine') ✅
- [x] Add critique-based refinement support ✅
- [x] Implement WHAT vs HOW system prompts ✅

**Implementation**: [src/providers/openai-llm-provider.js](../src/providers/openai-llm-provider.js)

### Image Provider
- [x] Already supports beam search context ✅
- [ ] Update to save `what.txt` and `how.txt` alongside `prompt.txt`

**Implementation**: [src/providers/openai-image-provider.js](../src/providers/openai-image-provider.js)

### Vision Provider (IMAGE EVALUATION)
- [ ] **NOT YET IMPLEMENTED** - This is the next critical component
- [ ] Implement image evaluation/scoring service
- [ ] Options to consider:
  - GPT-4 Vision API (most flexible, detailed critique)
  - CLIP score (fast, objective)
  - Hybrid approach
- [ ] Generate dimension-specific critiques (WHAT vs HOW)

**Status**: ❌ **BLOCKING** - Required for feedback loop

### Scoring Provider
- [ ] Depends on Vision Provider implementation
- [ ] Should combine CLIP + aesthetic scores
- [ ] Weight with configurable alpha/beta parameters

**Status**: ❌ **BLOCKED** by Vision Provider

### Orchestrator (NEW)
- [ ] **NOT YET IMPLEMENTED** - Main coordination logic
- [ ] Implement beam search loop
- [ ] Manage (WHAT, HOW) pairs
- [ ] Alternate refinement dimensions
- [ ] Track lineage and metadata
- [ ] Coordinate all providers
- [ ] Integrate critique generation (may be part of Vision Provider)

**Status**: ❌ Ready to implement once Vision Provider complete

### Demo/CLI
- [ ] Update `demo.js` to use new `combinePrompts()` method
- [ ] Show both WHAT and HOW components in output
- [ ] Display which dimension is being refined each round

## Testing Strategy

### Unit Tests
- Test `combinePrompts()` with various WHAT/HOW pairs
- Test expansion vs refinement operations
- Test critique generation for both dimensions

### Integration Tests
- Full beam search with mock providers
- Verify alternating refinement pattern
- Verify lineage tracking
- Verify storage structure with what.txt/how.txt

### End-to-End Tests
- Run full pipeline with real OpenAI providers
- Verify scores improve across iterations
- Verify WHAT refinement improves CLIP score
- Verify HOW refinement improves aesthetic score

## Future Enhancements

- **Adaptive beam width**: Expand beam when stuck in local optimum
- **Multi-dimensional refinement**: Refine both WHAT and HOW simultaneously
- **Learned combination**: Train model to optimize WHAT+HOW combination
- **User feedback**: Allow users to steer refinement with preferences
- **Parallel beams**: Run multiple independent beams and merge results

## References

- Original Python Implementation: [jflournoy/sdxl-prompt-gen-eval](https://github.com/jflournoy/sdxl-prompt-gen-eval)
- Provider Storage Specification: [PROVIDER_STORAGE_SPEC.md](./PROVIDER_STORAGE_SPEC.md)
- CLIP Paper: [Learning Transferable Visual Models From Natural Language Supervision](https://arxiv.org/abs/2103.00020)

## Version

- **Version**: 1.0.0
- **Date**: 2025-10-23
- **Status**: Active
- **Based on**: Python implementation analysis

## Changes

- 2025-10-23: Initial specification based on Python repository analysis
