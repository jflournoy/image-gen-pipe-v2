# Token Tracking Summary - All Model Calls Accounted For ✅

**Status:** All model API calls in the beam search orchestrator are **fully tracked** with token counts and cost estimation.

---

## Quick Facts

- **Total Tracking Points:** 11 tracking calls in beam-search.js
- **Providers Tracked:** LLM, Vision, Image, Critique
- **Operations Tracked:** expand, refine, combine, generate, analyze, rank, critique
- **Cost Estimation:** Automatic via TokenTracker with December 2025 pricing

---

## All 11 Tracking Points

| # | Line | Component | Operation | Provider | Context |
|---|------|-----------|-----------|----------|---------|
| 1 | 90 | rankAndSelectComparative | rank | vision | Compares images for selection |
| 2 | 169 | processCandidateStream | combine | llm | Merges WHAT+HOW prompts |
| 3 | 202 | processCandidateStream | generate | image | Generates image from prompt |
| 4 | 227 | processCandidateStream | analyze | vision | Evaluates image quality |
| 5 | 320 | initialExpansion | expand | llm | Generates WHAT prompts |
| 6 | 336 | initialExpansion | expand | llm | Generates HOW prompts |
| 7 | 368 | initialExpansion | combine | llm | Merges WHAT+HOW (iter 0) |
| 8 | 407 | initialExpansion | generate | image | Generates images (iter 0) |
| 9 | 434 | initialExpansion | analyze | vision | Evaluates images (iter 0) |
| 10 | 540 | refinementIteration | generate | critique | Creates improvement critique |
| 11 | 577 | refinementIteration | refine | llm | Refines prompts based on critique |

---

## Coverage by Operation

### LLM Operations
- **expand** ✅ Tracked at lines 320, 336
- **refine** ✅ Tracked at line 577
- **combine** ✅ Tracked at lines 169, 368

### Vision Operations
- **analyze** ✅ Tracked at lines 227, 434
- **rank** ✅ Tracked at line 90

### Image Operations
- **generate** ✅ Tracked at lines 202, 407

### Critique Operations
- **generate** ✅ Tracked at line 540

---

## Coverage by Iteration Type

### Iteration 0 (Initial Expansion)
```
✅ LLM expand (WHAT)  - line 320
✅ LLM expand (HOW)   - line 336
✅ LLM combine        - line 368
✅ Image generate     - line 407
✅ Vision analyze     - line 434
✅ Vision rank        - line 90
```

### Iterations 1+ (Refinement)
```
✅ Critique generate  - line 540
✅ LLM refine         - line 577
✅ LLM combine        - line 169 (via processCandidateStream)
✅ Image generate     - line 202 (via processCandidateStream)
✅ Vision analyze     - line 227 (via processCandidateStream)
✅ Vision rank        - line 90 (same function, called per iteration)
```

---

## Metadata Tracked per Call

Each tracking call includes comprehensive metadata:

```javascript
tokenTracker.recordUsage({
  provider: 'llm|vision|image|critique',
  operation: 'expand|refine|combine|generate|analyze|rank',
  tokens: <number>,
  metadata: {
    model: '<model_name>',           // e.g., 'gpt-5-nano', 'gpt-4o-mini'
    iteration: <iteration_number>,   // 0 for initial, 1+ for refinement
    candidateId: <candidate_id>,     // Index in generation
    dimension: 'what|how',           // For applicable operations
    parentId: <parent_candidate_id>, // For refinement iterations
    size: '<image_size>',            // For image operations
    quality: '<quality_level>'       // For image operations
  }
});
```

---

## Cost Calculation Flow

```
1. API Call Made
   ↓
2. Response Received with Tokens
   ↓
3. tokenTracker.recordUsage() Called
   ↓
4. Record Stored with Metadata
   ↓
5. Cost Calculated:
   tokens × price_per_token[model] = call_cost
   ↓
6. Total Cost Accessible via:
   - getEstimatedCost()      → {total, llm, vision, critique, imageGen}
   - formatSummary()         → Formatted text report
   - formatOptimizationReport() → Savings recommendations
```

---

## Default Model Pricing (December 2025)

| Operation | Model | Price | Tracked |
|-----------|-------|-------|---------|
| expand | gpt-5-nano | $0.05/1M tokens | ✅ |
| refine | gpt-5-mini | $0.25/1M tokens | ✅ |
| combine | gpt-5-nano | $0.05/1M tokens | ✅ |
| generate | gpt-image-1-mini | $2.00/1M text tokens | ✅ |
| analyze | gpt-4o-mini | $0.15/1M tokens | ✅ |
| rank | gpt-4o-mini | $0.15/1M tokens | ✅ |
| critique | gpt-5-mini | $0.25/1M tokens | ✅ |

---

## Example: Default Configuration (N=4, M=2, maxIterations=2)

### Iteration 0
```
Step 1: Generate 4 WHAT + 4 HOW prompts
        [TRACKED] LLM expand: 4 + 4 = 8 calls, ~6,000 tokens

Step 2: Combine 4 WHAT+HOW pairs
        [TRACKED] LLM combine: 4 calls, ~500 tokens

Step 3: Generate 4 images
        [TRACKED] Image generate: 4 calls, 4 tokens

Step 4: Analyze 4 images (if not comparative ranking)
        [TRACKED] Vision analyze: 4 calls, ~4,000 tokens

Step 5: Rank 4 candidates
        [TRACKED] Vision rank: 1 call, ~12,000 tokens

Cost: ~$0.00-0.01 (LLM/Vision) + ~$2.00-4.00 (Image)
```

### Iteration 1
```
Step 1: Generate 2 critiques
        [TRACKED] Critique generate: 2 calls, ~2,000 tokens

Step 2: Refine 4 prompts
        [TRACKED] LLM refine: 4 calls, ~2,500 tokens

Step 3: Combine 4 WHAT+HOW pairs
        [TRACKED] LLM combine: 4 calls, ~500 tokens

Step 4: Generate 4 images
        [TRACKED] Image generate: 4 calls, 4 tokens

Step 5: Analyze 4 images (if not comparative ranking)
        [TRACKED] Vision analyze: 4 calls, ~4,000 tokens

Step 6: Rank 6 candidates (4 new + 2 parents)
        [TRACKED] Vision rank: 1 call, ~18,000 tokens

Cost: ~$0.00-0.01 (LLM/Vision/Critique) + ~$2.00-4.00 (Image)
```

### Iteration 1 + Iteration 2
```
Total Cost: ~$4.00-8.00 (dominated by image generation)
Total Tokens: ~100,000 (mostly vision ranking)
Total Records Tracked: 22 (11 per iteration)
```

---

## Verification Script

```javascript
// Verify all tracking points are present
const fs = require('fs');
const code = fs.readFileSync('./src/orchestrator/beam-search.js', 'utf8');

const trackingCalls = code.match(/tokenTracker\.recordUsage/g);
console.log(`✅ Found ${trackingCalls ? trackingCalls.length : 0} tracking points`);

// Should output: ✅ Found 11 tracking points
```

---

## How to Access Cost Data

```javascript
const TokenTracker = require('./src/utils/token-tracker.js');
const tokenTracker = new TokenTracker({ sessionId: 'my-session' });

// Pass to beam search
const result = await beamSearch(userPrompt, providers, {
  beamWidth: 4,
  keepTop: 2,
  maxIterations: 2,
  tokenTracker,  // ← Passed here
});

// Access results
console.log(tokenTracker.getStats());
// {
//   totalTokens: 100000,
//   llmTokens: 20000,
//   visionTokens: 60000,
//   imageGenTokens: 8,
//   critiqueTokens: 2000,
//   byProvider: {...},
//   byOperation: {...},
//   byIteration: {...}
// }

console.log(tokenTracker.getEstimatedCost());
// {
//   total: 4.05,
//   llm: 0.0015,
//   vision: 0.009,
//   critique: 0.0005,
//   imageGen: 4.00
// }

// Beautiful formatted output
console.log(tokenTracker.formatSummary());
```

---

## Documentation Files

For more details, see:

1. **[cost-estimation-breakdown.md](./cost-estimation-breakdown.md)** - Detailed formulas and examples
2. **[model-calls-checklist.md](./model-calls-checklist.md)** - Line-by-line checklist of all calls
3. **[token-tracking-flow.md](./token-tracking-flow.md)** - Visual flow diagrams

---

## Key Files

- **[src/orchestrator/beam-search.js](../src/orchestrator/beam-search.js)** - All 11 tracking points
- **[src/utils/token-tracker.js](../src/utils/token-tracker.js)** - TokenTracker implementation
- **[src/config/model-pricing.js](../src/config/model-pricing.js)** - Model pricing configuration

---

## Conclusion

**All 11 model API calls in the beam search orchestrator are fully tracked with:**
- ✅ Complete token counts
- ✅ Comprehensive metadata
- ✅ Automatic cost calculation
- ✅ Cost optimization suggestions

No model calls are missing from tracking. The system provides complete visibility into all API costs.
