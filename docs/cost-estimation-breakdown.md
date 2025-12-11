# Cost Estimation Breakdown - Beam Search Orchestrator

This document provides a comprehensive breakdown of ALL model API calls in the beam search orchestrator and their token tracking.

## Executive Summary

**Total Cost Formula for Beam Search:**
```
Total Cost = (Cost of all operations) per iteration × (maxIterations) + Initial expansion
```

For default config (N=4 beamWidth, M=2 keepTop, maxIterations=2):
- **Iteration 0 (Initial Expansion):** ~$0.15-0.25
- **Each Refinement Iteration:** ~$0.10-0.15
- **Total for 2 iterations:** ~$0.35-0.55

## Detailed Model Call Breakdown

### ITERATION 0: Initial Expansion

**Step 1: Generate N WHAT+HOW Prompt Pairs**
- 2N calls to `llmProvider.refinePrompt()`
  - N calls with dimension='what', operation='expand'
  - N calls with dimension='how', operation='expand'
- Provider: LLM (gpt-5-nano or configured model)
- Tokens tracked: ✅ YES (lines 319-348 in beam-search.js)
- Token metadata: model, iteration=0, candidateId, dimension

**Step 2: Process N Candidates Through Pipeline**
For each WHAT+HOW pair:

| Call | Operation | Provider | Count | Tokens Tracked | Notes |
|------|-----------|----------|-------|-----------------|-------|
| combinePrompts | combine | LLM | N | ✅ Lines 367-379 | Merges WHAT+HOW into single prompt |
| generateImage | generate | Image Gen | N | ✅ Lines 406-421 | Counted as 1 token per image |
| analyzeImage | analyze | Vision | N | ✅ Lines 433-445 | Only if skipVisionAnalysis=false |

**Step 3: Ranking (if using comparative ranking)**
- 1 call to `imageRanker.rankImages()`
- Provider: Vision (GPT-4o-mini for image comparison)
- Tokens tracked: ✅ YES (lines 82-95)
- Handles up to N candidates with optimization for keepTop

**Iteration 0 Total API Calls:**
```
- LLM: 2N (expand) + N (combine) = 3N calls
- Image: N calls
- Vision: N (analyze) + 1 (ranking) = N+1 calls
```

For N=4:
```
- LLM: 12 calls
- Image: 4 calls
- Vision: 5 calls
```

---

### ITERATIONS 1+ (Refinement): Each Refinement Iteration

**Step 1: Generate M Critiques (one per parent)**
- M calls to `critiqueGenProvider.generateCritique()`
- Provider: LLM (gpt-5-mini or configured model)
- Receives: ranking/evaluation feedback from previous iteration
- Tokens tracked: ✅ YES (lines 539-552)
- Token metadata: model, iteration, parentId (candidateId)

**Step 2: Generate N Children from M Parents**
- Expansion ratio = N/M children per parent
- For each child:

| Call | Operation | Provider | Count | Tokens Tracked | Notes |
|------|-----------|----------|-------|-----------------|-------|
| refinePrompt | refine | LLM | N | ✅ Lines 576-589 | Refines selected dimension using critique |
| combinePrompts | combine | LLM | N | ✅ Lines 168-180 | Via processCandidateStream |
| generateImage | generate | Image | N | ✅ Lines 201-215 | Via processCandidateStream |
| analyzeImage | analyze | Vision | N | ✅ Lines 226-238 | Via processCandidateStream, if skipVisionAnalysis=false |

**Step 3: Ranking (if using comparative ranking)**
- 1 call to `imageRanker.rankImages()` with all candidates
- Provider: Vision (GPT-4o-mini)
- Compares N new children + M old parents = N+M images
- Tokens tracked: ✅ YES (lines 82-95)
- Known comparisons optimization: Avoids re-comparing parent pairs

**Refinement Iteration Total API Calls:**
```
- LLM: M (critique) + N (refine) + N (combine) = 2N + M calls
- Image: N calls
- Vision: N (analyze) + 1 (ranking) = N+1 calls
```

For N=4, M=2:
```
- LLM: 10 calls per iteration
- Image: 4 calls per iteration
- Vision: 5 calls per iteration
```

---

## Complete Cost Calculation

### Model Pricing (December 2025)
```
gpt-5-nano (expand):     $0.05 per 1M input tokens
gpt-5-mini (refine):     $0.25 per 1M input tokens
gpt-image-1-mini:        $2.00 per 1M text input tokens
gpt-4o-mini (vision):    $0.15 per 1M input tokens
```

### Cost Formula by Operation

**LLM Operations (tracked in tokenTracker):**
- expand:  tokens × $0.00000005 (gpt-5-nano price)
- refine:  tokens × $0.00000025 (gpt-5-mini price)
- combine: tokens × $0.00000005 (gpt-5-nano price)

**Vision Operations (tracked in tokenTracker):**
- analyze: tokens × $0.00000015 (gpt-4o-mini price)
- rank:    tokens × $0.00000015 (gpt-4o-mini price)

**Image Operations (tracked in tokenTracker):**
- generate: 1 per image × image generation cost (varies by size/quality)

---

## Complete Example: N=4, M=2, maxIterations=2

### Iteration 0: Initial Expansion

```
LLM Calls:
  • 4 expand (WHAT):     ~3,000 tokens each = 12,000 tokens × $0.05/1M = $0.0006
  • 4 expand (HOW):      ~3,000 tokens each = 12,000 tokens × $0.05/1M = $0.0006
  • 4 combine:           ~500 tokens each  = 2,000 tokens × $0.05/1M  = $0.0001

Vision Calls:
  • 4 analyze:           ~4,000 tokens each = 16,000 tokens × $0.15/1M = $0.0024
  • 1 rank (4 images):   ~12,000 tokens     = 12,000 tokens × $0.15/1M = $0.0018

Image Calls:
  • 4 generateImage:     $0.50-1.00 each = $2.00-4.00

Iteration 0 Total: ~$2.00-4.00 (dominated by image generation)
```

### Iteration 1: First Refinement (M=2 parents → N=4 children)

```
LLM Calls:
  • 2 critique:    ~2,000 tokens each = 4,000 tokens  × $0.25/1M = $0.0010
  • 4 refine:      ~2,500 tokens each = 10,000 tokens × $0.25/1M = $0.0025
  • 4 combine:     ~500 tokens each   = 2,000 tokens  × $0.05/1M = $0.0001

Vision Calls:
  • 4 analyze:     ~4,000 tokens each = 16,000 tokens × $0.15/1M = $0.0024
  • 1 rank (6 images): ~18,000 tokens = 18,000 tokens × $0.15/1M = $0.0027

Image Calls:
  • 4 generateImage:    $0.50-1.00 each = $2.00-4.00

Iteration 1 Total: ~$2.00-4.00
```

### Total Cost Summary

```
Without Comparative Ranking:
  • Iteration 0: ~$2.00-4.00 (only image costs)
  • Iteration 1: ~$2.00-4.00 (only image costs)
  • Total: ~$4.00-8.00

With Comparative Ranking:
  • Iteration 0: ~$2.00-4.00 + $0.0042 LLM/Vision = ~$2.00-4.00
  • Iteration 1: ~$2.00-4.00 + $0.0087 LLM/Vision = ~$2.00-4.00
  • Total: ~$4.00-8.00
  • LLM/Vision tokens: <$0.02 (negligible, dominated by image generation)
```

---

## Token Tracking Coverage

### ✅ FULLY TRACKED Operations

| Component | Operation | Provider | Line Reference | Method |
|-----------|-----------|----------|-----------------|--------|
| initialExpansion | expand | LLM | 319-348 | tokenTracker.recordUsage |
| initialExpansion | combine | LLM | 367-379 | tokenTracker.recordUsage |
| initialExpansion | generate | Image | 406-421 | tokenTracker.recordUsage |
| initialExpansion | analyze | Vision | 433-445 | tokenTracker.recordUsage |
| refinementIteration | critique | Critique | 539-552 | tokenTracker.recordUsage |
| refinementIteration | refine | LLM | 576-589 | tokenTracker.recordUsage |
| processCandidateStream | combine | LLM | 168-180 | tokenTracker.recordUsage |
| processCandidateStream | generate | Image | 201-215 | tokenTracker.recordUsage |
| processCandidateStream | analyze | Vision | 226-238 | tokenTracker.recordUsage |
| rankAndSelectComparative | rank | Vision | 82-95 | tokenTracker.recordUsage |

### Metadata Tracked per Call
```
{
  provider: 'llm' | 'vision' | 'image' | 'critique',
  operation: 'expand' | 'refine' | 'combine' | 'generate' | 'analyze' | 'rank',
  tokens: <number>,
  metadata: {
    model: <model_name>,
    iteration: <iteration_number>,
    candidateId: <candidate_id>,
    dimension: 'what' | 'how' (for applicable operations),
    parentId: <parent_candidate_id> (for refinement iterations)
  }
}
```

---

## Cost Estimation in Code

### Getting Estimated Cost

```javascript
const tokenTracker = new TokenTracker({ sessionId: 'my-session' });

// After beam search completes...
const stats = tokenTracker.getStats();
// Returns: { totalTokens, llmTokens, visionTokens, etc. }

const cost = tokenTracker.getEstimatedCost();
// Returns: { total, llm, vision, critique, imageGen }

console.log(tokenTracker.formatSummary());
// Prints formatted summary including cost breakdown
```

### Usage in Demo

See [demo-beam-search.js](../demo-beam-search.js) for complete example:
- Creates TokenTracker instance
- Passes to beamSearch config
- Displays cost after completion

---

## Optimization Recommendations

### For Reducing Costs:

1. **Use Comparative Ranking** (implemented):
   - Skips vision analysis for initial candidates (N→M selection)
   - Only ranks final candidates
   - Saves ~$0.004-0.006 per iteration

2. **Reduce beam width (N)**:
   - N=2: ~$2.00-4.00 per iteration
   - N=4: ~$4.00-8.00 per iteration
   - N=8: ~$8.00-16.00 per iteration

3. **Reduce iterations (maxIterations)**:
   - Each iteration adds ~$2.00-4.00 (dominated by images)

4. **Use cheaper vision model for analysis**:
   - Current: gpt-4o-mini ($0.15/1M)
   - Alternative: cheaper vision models when available

---

## See Also

- [src/orchestrator/beam-search.js](../src/orchestrator/beam-search.js) - Main orchestrator with all tracked calls
- [src/utils/token-tracker.js](../src/utils/token-tracker.js) - TokenTracker implementation
- [src/config/model-pricing.js](../src/config/model-pricing.js) - Model pricing configuration
- [demo-beam-search.js](../demo-beam-search.js) - Example usage with cost tracking
