# Token Tracking Flow - Complete Pipeline

This document visualizes how tokens are tracked through each step of the beam search orchestrator.

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  BEAM SEARCH ORCHESTRATOR                   │
├─────────────────────────────────────────────────────────────┤
│  Inputs: userPrompt, providers, config                      │
│  Output: best candidate with cost breakdown                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│           ITERATION 0: INITIAL EXPANSION                    │
│           (Generate N diverse prompt pairs)                 │
└─────────────────────────────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │ Generate N │    │ Generate N │    │Combine N   │
    │  WHAT      │    │   HOW      │    │WHAT + HOW  │
    │ prompts    │    │ prompts    │    │ prompts    │
    └────────────┘    └────────────┘    └────────────┘
         │                │                 │
    [TRACKED]         [TRACKED]         [TRACKED]
    llm:expand        llm:expand         llm:combine
    N tokens          N tokens           N tokens
         │                │                 │
         └──────────────────┼─────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Generate N    │
                    │   images       │
                    │  (N in         │
                    │   parallel)    │
                    └────────────────┘
                            │
                        [TRACKED]
                        image:generate
                        N images (1 token each)
                            │
                    ┌───────▼────────┐
                    │  Analyze N     │
                    │  images with   │
                    │  Vision        │
                    │  (if not       │
                    │   comparative) │
                    └────────────────┘
                            │
                        [TRACKED]
                        vision:analyze
                        N × 4k tokens
                            │
                    ┌───────▼────────────┐
                    │ Rank N candidates  │
                    │ using imageRanker  │
                    │ (if comparative)   │
                    └────────────────────┘
                            │
                        [TRACKED]
                        vision:rank
                        ~12k tokens
                            │
                    ┌───────▼────────────┐
                    │ Select top M       │
                    │ candidates         │
                    └────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│      ITERATIONS 1 to maxIterations-1: REFINEMENT            │
│      (Refine top M parents into N children)                │
└─────────────────────────────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ Generate M   │  │ Refine N     │  │ Combine N    │
    │ critiques    │  │ prompts      │  │ WHAT+HOW     │
    │ (1 per      │  │ (1 per child)│  │ (1 per child)│
    │  parent)     │  │              │  │              │
    └──────────────┘  └──────────────┘  └──────────────┘
         │                  │                 │
    [TRACKED]         [TRACKED]          [TRACKED]
    critique:         llm:refine         llm:combine
    generate          N tokens           N tokens
    M × 2k tokens
         │                  │                 │
         └──────────────────┼─────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Generate N    │
                    │   images       │
                    │  (N children)  │
                    └────────────────┘
                            │
                        [TRACKED]
                        image:generate
                        N images (1 token each)
                            │
                    ┌───────▼────────┐
                    │  Analyze N     │
                    │  images with   │
                    │  Vision        │
                    │  (if not       │
                    │   comparative) │
                    └────────────────┘
                            │
                        [TRACKED]
                        vision:analyze
                        N × 4k tokens
                            │
                    ┌───────▼───────────────┐
                    │ Rank all candidates:  │
                    │ • M parents           │
                    │ • N new children      │
                    │ (if comparative)      │
                    └───────────────────────┘
                            │
                        [TRACKED]
                        vision:rank
                        ~18k tokens for N+M images
                            │
                    ┌───────▼───────────────┐
                    │ Select top M for      │
                    │ next iteration        │
                    └───────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
        More iterations?              No more iterations
            │                               │
            ▼                               ▼
        [Loop back to                   [Continue to winner]
         refinement]
```

---

## Token Flow Detail

### Iteration 0: Initial Expansion
```
Step 1: llmProvider.refinePrompt() × 2 (WHAT + HOW)
         ├─ Model: gpt-5-nano or configured
         ├─ Tokens: ~3,000 per call × N candidates = ~6,000 tokens total
         └─ TRACKED: tokenTracker.recordUsage({provider: 'llm', operation: 'expand', tokens: X, ...})

Step 2: llmProvider.combinePrompts() × 1
         ├─ Model: gpt-5-nano or configured
         ├─ Tokens: ~500 per call × N candidates = ~500 tokens total
         └─ TRACKED: tokenTracker.recordUsage({provider: 'llm', operation: 'combine', tokens: X, ...})

Step 3: imageGenProvider.generateImage() × 1
         ├─ Model: gpt-image-1-mini
         ├─ Tokens: 1 per image (counted as 1 token)
         └─ TRACKED: tokenTracker.recordUsage({provider: 'image', operation: 'generate', tokens: 1, ...})

Step 4: visionProvider.analyzeImage() × 1
         ├─ Model: gpt-4o-mini
         ├─ Tokens: ~4,000 per image × N candidates = ~4,000 tokens total
         ├─ Condition: skipVisionAnalysis=false
         └─ TRACKED: tokenTracker.recordUsage({provider: 'vision', operation: 'analyze', tokens: X, ...})

Step 5: imageRanker.rankImages() × 1
         ├─ Model: gpt-4o-mini
         ├─ Tokens: ~3,000 per comparison × (N choose 2) = ~12,000 tokens total
         ├─ Condition: useComparativeRanking=true
         └─ TRACKED: tokenTracker.recordUsage({provider: 'vision', operation: 'rank', tokens: X, ...})
```

### Iterations 1+: Refinement (per iteration)
```
Step 1: critiqueGenProvider.generateCritique() × 1
         ├─ Model: gpt-5-mini or configured
         ├─ Tokens: ~2,000 per parent × M parents = ~2,000 tokens total
         └─ TRACKED: tokenTracker.recordUsage({provider: 'critique', operation: 'generate', tokens: X, ...})

Step 2: llmProvider.refinePrompt() × 1
         ├─ Model: gpt-5-mini or configured
         ├─ Tokens: ~2,500 per child × N children = ~2,500 tokens total
         └─ TRACKED: tokenTracker.recordUsage({provider: 'llm', operation: 'refine', tokens: X, ...})

Step 3: llmProvider.combinePrompts() × 1
         ├─ Model: gpt-5-nano or configured
         ├─ Tokens: ~500 per child × N children = ~500 tokens total
         └─ TRACKED: tokenTracker.recordUsage({provider: 'llm', operation: 'combine', tokens: X, ...})

Step 4: imageGenProvider.generateImage() × 1
         ├─ Model: gpt-image-1-mini
         ├─ Tokens: 1 per image
         └─ TRACKED: tokenTracker.recordUsage({provider: 'image', operation: 'generate', tokens: 1, ...})

Step 5: visionProvider.analyzeImage() × 1
         ├─ Model: gpt-4o-mini
         ├─ Tokens: ~4,000 per image × N children = ~4,000 tokens total
         ├─ Condition: skipVisionAnalysis=false
         └─ TRACKED: tokenTracker.recordUsage({provider: 'vision', operation: 'analyze', tokens: X, ...})

Step 6: imageRanker.rankImages() × 1
         ├─ Model: gpt-4o-mini
         ├─ Tokens: ~18,000 for N+M images
         ├─ Optimization: Uses knownComparisons to avoid re-ranking parents
         ├─ Condition: useComparativeRanking=true
         └─ TRACKED: tokenTracker.recordUsage({provider: 'vision', operation: 'rank', tokens: X, ...})
```

---

## Cost Accumulation Example

For **N=4, M=2, maxIterations=2**:

```
ITERATION 0 (Initial Expansion):
┌─ LLM expand (WHAT): 4 × 3,000 tokens = 12,000  tokens
├─ LLM expand (HOW):  4 × 3,000 tokens = 12,000  tokens
├─ LLM combine:       4 × 500 tokens   = 2,000   tokens
├─ Image generate:    4 × 1 token      = 4       tokens
├─ Vision analyze:    4 × 4,000 tokens = 16,000  tokens
└─ Vision rank:       1 × 12,000 tokens= 12,000  tokens
   ├─ Total LLM:      26,000 tokens × $0.05/1M  = $0.0013
   ├─ Total Vision:   28,000 tokens × $0.15/1M  = $0.0042
   ├─ Total Image:    4 × $0.50-1.00            = $2.00-4.00
   └─ Iter 0 Total:                              ≈ $2.00-4.00

ITERATION 1 (Refinement):
┌─ Critique gen:      2 × 2,000 tokens = 4,000   tokens
├─ LLM refine:        4 × 2,500 tokens = 10,000  tokens
├─ LLM combine:       4 × 500 tokens   = 2,000   tokens
├─ Image generate:    4 × 1 token      = 4       tokens
├─ Vision analyze:    4 × 4,000 tokens = 16,000  tokens
└─ Vision rank:       1 × 18,000 tokens= 18,000  tokens
   ├─ Total LLM:      16,000 tokens × $0.15/1M (refine is gpt-5-mini) = $0.0024
   ├─ Total Critique: 4,000 tokens × $0.25/1M  = $0.0010
   ├─ Total Vision:   34,000 tokens × $0.15/1M = $0.0051
   ├─ Total Image:    4 × $0.50-1.00            = $2.00-4.00
   └─ Iter 1 Total:                              ≈ $2.00-4.00

GRAND TOTAL FOR BEAM SEARCH:
   ├─ LLM tokens:    42,000 tokens
   ├─ Vision tokens: 62,000 tokens
   ├─ Critique tokens: 4,000 tokens
   ├─ Image gens:    8 images
   ├─ Estimated cost: LLM $0.0037 + Vision $0.0093 + Critique $0.0010 + Image $4.00-8.00
   └─ TOTAL:         ≈ $4.00-8.00 (dominated by image generation cost)
```

---

## Tracking Configuration

To enable token tracking:

```javascript
const TokenTracker = require('./src/utils/token-tracker.js');
const tokenTracker = new TokenTracker({
  sessionId: 'my-beam-search-session',
  pricing: MODEL_PRICING  // From src/config/model-pricing.js
});

const result = await beamSearch(userPrompt, providers, {
  beamWidth: 4,
  keepTop: 2,
  maxIterations: 2,
  tokenTracker,  // ← Pass tracker to beamSearch
  metadataTracker,
  // ... other config
});

// Get results
console.log(tokenTracker.formatSummary());
console.log(tokenTracker.formatOptimizationReport());
```

---

## Verification Commands

```bash
# Check that all model calls are properly tracked
node -e "
const TokenTracker = require('./src/utils/token-tracker.js');
const tracker = new TokenTracker();

// Simulate some calls
tracker.recordUsage({provider: 'llm', operation: 'expand', tokens: 1000});
tracker.recordUsage({provider: 'image', operation: 'generate', tokens: 1});
tracker.recordUsage({provider: 'vision', operation: 'analyze', tokens: 5000});

console.log('Tracked records:', tracker.getRecords().length);
console.log('Stats:', tracker.getStats());
console.log('Cost:', tracker.getEstimatedCost());
console.log(tracker.formatSummary());
"
```

---

## Files Modified/Created for Cost Tracking

1. **[src/orchestrator/beam-search.js](../src/orchestrator/beam-search.js)**
   - Lines 319-348: Track expand operations
   - Lines 367-379: Track combine operations (iteration 0)
   - Lines 406-421: Track image generation (iteration 0)
   - Lines 433-445: Track vision analyze (iteration 0)
   - Lines 82-95: Track ranking operations
   - Lines 168-180: Track combine operations (refinement iterations)
   - Lines 201-215: Track image generation (refinement iterations)
   - Lines 226-238: Track vision analyze (refinement iterations)
   - Lines 539-552: Track critique generation
   - Lines 576-589: Track refine operations

2. **[src/utils/token-tracker.js](../src/utils/token-tracker.js)**
   - Complete implementation of token tracking and cost estimation
   - Methods: recordUsage(), getStats(), getEstimatedCost(), formatSummary()

3. **[src/config/model-pricing.js](../src/config/model-pricing.js)**
   - Model pricing configuration (December 2025)
   - Support for flexible pricing tiers

---

## Cost Optimization Checklist

- [ ] All tokenTracker.recordUsage() calls include:
  - [ ] provider: 'llm' | 'vision' | 'image' | 'critique'
  - [ ] operation: specific operation name
  - [ ] tokens: actual token count
  - [ ] metadata: iteration, candidateId, etc.

- [ ] Vision provider uses most cost-efficient model:
  - [ ] analyze: gpt-4o-mini ($0.15/1M) or cheaper
  - [ ] rank: gpt-4o-mini ($0.15/1M) or cheaper

- [ ] Image generation cost is optimized:
  - [ ] Uses smaller image size when possible
  - [ ] Batch processes multiple images

- [ ] Comparative ranking is enabled:
  - [ ] Skips vision:analyze for iteration 0 candidates
  - [ ] Uses knownComparisons to minimize ranking calls

---

## See Also

- [src/orchestrator/beam-search.js](../src/orchestrator/beam-search.js)
- [src/utils/token-tracker.js](../src/utils/token-tracker.js)
- [src/config/model-pricing.js](../src/config/model-pricing.js)
- [cost-estimation-breakdown.md](./cost-estimation-breakdown.md)
- [model-calls-checklist.md](./model-calls-checklist.md)
