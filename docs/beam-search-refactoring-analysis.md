# Beam Search Orchestrator - Refactoring Analysis

> Created: 2025-10-29
> Context: Analysis of existing provider functions to determine if refactoring is needed for beam search orchestrator implementation

## Design Decision: Iteration 0 Special Case

**Key Learning**: Iteration 0 is deliberately special-cased rather than abstracted into the main loop.

### Rationale

Iteration 0 has a fundamentally different entry point:
- **Iteration 0**: Starts at expansion/combine (no critique, no parent)
- **Iteration 1+**: Starts at critique stage (has parents with scores)

This is **not a DRY violation** - it reflects the actual algorithm structure. Both paths use the same building blocks but have legitimately different control flow.

### References

- Learning captured in: `LEARNINGS.md` and `.claude/learnings/2025-10.md`
- Architecture doc: `docs/streaming-parallel-architecture.md`
- Design decision documented in orchestrator implementation section

## Existing Provider Functions Analysis

### ✅ No Refactoring Needed

All existing provider functions are **already compatible** with the beam search orchestrator design:

#### 1. OpenAILLMProvider.refinePrompt()

**Location**: `src/providers/openai-llm-provider.js:44-146`

**Current Signature**:
```javascript
async refinePrompt(prompt, options = {})
```

**Supports**:
- ✅ `operation: 'expand'` - Used in iteration 0 for initial expansion
- ✅ `operation: 'refine'` - Used in iteration 1+ for critique-based refinement
- ✅ `dimension: 'what' | 'how'` - Dimension targeting
- ✅ `critique` - Structured critique object with `critique`, `recommendation`, `reason` fields
- ✅ `temperature` - Configurable for stochastic variation in beam expansion

**Orchestrator Usage**:
- **Iteration 0**: `llm.refinePrompt(userPrompt, { dimension: 'what', operation: 'expand', temperature: 0.7 })`
- **Iteration 1+**: `llm.refinePrompt(parentPrompt, { dimension: 'what', operation: 'refine', critique: critiqueObj })`

**Verdict**: ✅ Perfect as-is. Already supports both expansion and refinement operations.

---

#### 2. OpenAILLMProvider.combinePrompts()

**Location**: `src/providers/openai-llm-provider.js:154-200`

**Current Signature**:
```javascript
async combinePrompts(whatPrompt, howPrompt)
```

**Supports**:
- ✅ Combines WHAT and HOW prompts into unified prompt
- ✅ Uses lower temperature (0.5) for deterministic combination
- ✅ Returns simple string (no complex object)

**Orchestrator Usage**:
- Used in `processCandidateStream()` for all candidates
- Same for iteration 0 and iteration 1+

**Verdict**: ✅ Perfect as-is. Simple, focused function.

---

#### 3. OpenAIVisionProvider.analyzeImage()

**Location**: `src/providers/openai-vision-provider.js:41-120`

**Current Signature**:
```javascript
async analyzeImage(imageUrl, prompt, options = {})
```

**Returns**:
```javascript
{
  alignmentScore: number,    // 0-100 (prompt fidelity)
  aestheticScore: number,    // 0-10 (visual quality)
  analysis: string,
  strengths: string[],
  weaknesses: string[],
  caption: string,
  metadata: { tokensUsed, model, timestamp }
}
```

**Supports**:
- ✅ Returns both alignment and aesthetic scores
- ✅ Provides detailed analysis for critique generation
- ✅ Single API call returns all needed data

**Orchestrator Usage**:
```javascript
const evaluation = await vision.analyzeImage(image.url, combinedPrompt);
// Use evaluation.alignmentScore and evaluation.aestheticScore in parallel
```

**Verdict**: ✅ Perfect as-is. Returns all data needed for scoring and critique.

---

#### 4. CritiqueGenerator.generateCritique()

**Location**: `src/services/critique-generator.js:46-74`

**Current Signature**:
```javascript
async generateCritique(evaluation, prompts, options)
```

**Parameters**:
- `evaluation` - Vision analysis result
- `prompts` - Object with `what`, `how`, `combined`
- `options` - Object with `dimension`, `iteration`, `parentScore`

**Returns**:
```javascript
{
  critique: string,
  recommendation: string,
  reason: string,
  dimension: string,
  metadata: {
    alignmentScore,
    aestheticScore,
    relevantScore,
    scoreType: 'alignment' | 'aesthetic',
    iteration,
    parentScore,
    tokensUsed
  }
}
```

**Supports**:
- ✅ Dimension-aware (uses alignmentScore for WHAT, aestheticScore for HOW)
- ✅ Returns structured critique object compatible with `refinePrompt()`
- ✅ Includes metadata for tracking

**Orchestrator Usage**:
```javascript
const critique = await critiqueGen.generateCritique(
  evaluation,
  { what: parent.whatPrompt, how: parent.howPrompt, combined: parent.combined },
  { dimension: 'what', iteration: 1 }
);

// Pass critique to refinePrompt
const refined = await llm.refinePrompt(parent.whatPrompt, {
  operation: 'refine',
  dimension: 'what',
  critique: critique  // Structured object
});
```

**Verdict**: ✅ Perfect as-is. Structured output matches refinePrompt input.

---

#### 5. OpenAIImageProvider.generateImage()

**Location**: `src/providers/openai-image-provider.js`

**Current Signature**:
```javascript
async generateImage(prompt, options = {})
```

**Supports**:
- ✅ Takes combined prompt
- ✅ Saves locally with beam search context (iteration, candidateId, dimension)
- ✅ Returns image URL and local path

**Orchestrator Usage**:
```javascript
const image = await imageGen.generateImage(combinedPrompt, {
  size: '1024x1024',
  quality: 'standard',
  iteration: 0,
  candidateId: 0,
  dimension: 'what'
});
```

**Verdict**: ✅ Perfect as-is. Already supports beam search metadata.

---

## Summary: No Refactoring Required

All existing provider functions are **orchestrator-ready**:

1. ✅ **LLM Provider** - Supports both expansion and refinement operations
2. ✅ **Image Provider** - Handles combined prompts with beam search metadata
3. ✅ **Vision Provider** - Returns all scoring data in single call
4. ✅ **Critique Generator** - Dimension-aware, structured output

## Implementation Strategy

### Core Functions Needed

The orchestrator needs to create these **new** functions that compose existing providers:

#### 1. processCandidateStream()

```javascript
async function processCandidateStream(whatPrompt, howPrompt, options) {
  const combined = await llm.combinePrompts(whatPrompt, howPrompt);
  const image = await imageGen.generateImage(combined, options);

  // Parallel scoring
  const evaluation = await vision.analyzeImage(image.url, combined);

  const totalScore = calculateTotalScore(
    evaluation.alignmentScore,
    evaluation.aestheticScore,
    options.alpha || 0.7
  );

  return { whatPrompt, howPrompt, combined, image, evaluation, totalScore };
}
```

#### 2. initialExpansion()

```javascript
async function initialExpansion(userPrompt, config) {
  const { beamWidth: N } = config;

  // Generate N WHAT+HOW pairs
  const whatHowPairs = await Promise.all(
    Array(N).fill().map(async () => {
      const [what, how] = await Promise.all([
        llm.refinePrompt(userPrompt, { dimension: 'what', operation: 'expand' }),
        llm.refinePrompt(userPrompt, { dimension: 'how', operation: 'expand' })
      ]);
      return { what: what.refinedPrompt, how: how.refinedPrompt };
    })
  );

  // Stream all candidates through pipeline
  return Promise.all(
    whatHowPairs.map(({ what, how }, i) =>
      processCandidateStream(what, how, { iteration: 0, candidateId: i })
    )
  );
}
```

#### 3. refinementIteration()

```javascript
async function refinementIteration(parents, config, iteration) {
  const { beamWidth: N, keepTop: M } = config;
  const expansionRatio = N / M;
  const dimension = iteration % 2 === 0 ? 'what' : 'how';

  // Generate critiques in parallel
  const parentsWithCritiques = await Promise.all(
    parents.map(async (parent) => {
      const critique = await critiqueGen.generateCritique(
        parent.evaluation,
        { what: parent.whatPrompt, how: parent.howPrompt, combined: parent.combined },
        { dimension, iteration }
      );
      return { ...parent, critique };
    })
  );

  // Generate children and stream through pipeline
  return Promise.all(
    parentsWithCritiques.flatMap((parent, i) =>
      Array(expansionRatio).fill().map(async (_, j) => {
        const refined = await llm.refinePrompt(
          dimension === 'what' ? parent.whatPrompt : parent.howPrompt,
          { operation: 'refine', dimension, critique: parent.critique }
        );

        const whatPrompt = dimension === 'what' ? refined.refinedPrompt : parent.whatPrompt;
        const howPrompt = dimension === 'how' ? refined.refinedPrompt : parent.howPrompt;

        return processCandidateStream(whatPrompt, howPrompt, {
          iteration,
          candidateId: i * expansionRatio + j,
          dimension,
          parentId: parent.metadata?.candidateId
        });
      })
    )
  );
}
```

#### 4. rankAndSelect()

```javascript
function rankAndSelect(candidates, keepTop) {
  const ranked = [...candidates].sort((a, b) => b.totalScore - a.totalScore);
  return ranked.slice(0, keepTop);
}
```

#### 5. beamSearch() (Main Orchestrator)

```javascript
async function beamSearch(userPrompt, config) {
  const { maxIterations, keepTop: M } = config;

  // Iteration 0: Initial expansion (special case)
  let candidates = await initialExpansion(userPrompt, config);
  let topCandidates = rankAndSelect(candidates, M);

  // Iteration 1+: Refinement loop
  for (let iteration = 1; iteration < maxIterations; iteration++) {
    candidates = await refinementIteration(topCandidates, config, iteration);
    topCandidates = rankAndSelect(candidates, M);

    if (hasConverged(topCandidates)) {
      break;
    }
  }

  return topCandidates[0];
}
```

## Next Steps for TDD

When implementing the orchestrator with TDD:

1. **Start with unit tests** for individual functions:
   - `processCandidateStream()` - Mock providers
   - `rankAndSelect()` - Pure function, easy to test
   - `calculateTotalScore()` - Pure function

2. **Integration tests** for coordination:
   - `initialExpansion()` - Test with real/mock providers
   - `refinementIteration()` - Test with real/mock providers

3. **End-to-end test** for `beamSearch()`:
   - Use mock providers
   - Verify iteration flow
   - Verify state transitions

## Conclusion

✅ **No refactoring needed** - All existing providers are ready for orchestrator integration.

🚀 **Ready to start TDD** - Clear implementation strategy with existing building blocks.

📚 **Reference this document** when writing orchestrator tests to ensure compatibility with existing provider APIs.
