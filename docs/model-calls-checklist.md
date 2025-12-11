# Model API Calls Tracking Checklist

Quick reference for verifying all API calls are tracked in the beam search orchestrator.

## Iteration 0: Initial Expansion (Lines 289-486)

### Step 1a: Generate N WHAT prompts
- **API Call:** `llmProvider.refinePrompt(userPrompt, {dimension: 'what', operation: 'expand', temperature})`
- **Count:** N times (in parallel for each candidate)
- **Line:** 306
- **Tracking:** ✅ Lines 319-332
- **Tracked Data:**
  - Provider: 'llm'
  - Operation: 'expand'
  - Model: combineResult.metadata.model
  - Iteration: 0
  - Dimension: 'what'

### Step 1b: Generate N HOW prompts
- **API Call:** `llmProvider.refinePrompt(userPrompt, {dimension: 'how', operation: 'expand', temperature})`
- **Count:** N times (in parallel for each candidate)
- **Line:** 311
- **Tracking:** ✅ Lines 335-348
- **Tracked Data:**
  - Provider: 'llm'
  - Operation: 'expand'
  - Model: how.metadata.model
  - Iteration: 0
  - Dimension: 'how'

### Step 2: Combine N WHAT+HOW pairs
- **API Call:** `llmProvider.combinePrompts(what, how)`
- **Count:** N times
- **Line:** 363
- **Tracking:** ✅ Lines 367-379
- **Tracked Data:**
  - Provider: 'llm'
  - Operation: 'combine'
  - Model: combineResult.metadata.model
  - Iteration: 0
  - CandidateId: i

### Step 3: Generate N images
- **API Call:** `imageGenProvider.generateImage(combined, {iteration: 0, candidateId: i, ...})`
- **Count:** N times
- **Line:** 397
- **Rate Limited:** ✅ imageGenLimiter.execute()
- **Tracking:** ✅ Lines 406-421
- **Tracked Data:**
  - Provider: 'image'
  - Operation: 'generate'
  - Tokens: 1 (one per image)
  - Model: image.metadata.model
  - Size: image.metadata.size
  - Quality: image.metadata.quality
  - Iteration: 0
  - CandidateId: i

### Step 4: Analyze N images (if skipVisionAnalysis=false)
- **API Call:** `visionProvider.analyzeImage(image.url, combined)`
- **Count:** N times (or 0 if skipVisionAnalysis=true)
- **Line:** 429
- **Rate Limited:** ✅ visionLimiter.execute()
- **Tracking:** ✅ Lines 433-445
- **Tracked Data:**
  - Provider: 'vision'
  - Operation: 'analyze'
  - Model: evaluation.metadata.model
  - Iteration: 0
  - CandidateId: i

### Step 5: Rank N candidates (if using comparative ranking)
- **API Call:** `imageRanker.rankImages(images, userPrompt, {keepTop, knownComparisons, ensembleSize})`
- **Count:** 1 call
- **Line:** 82
- **Tracking:** ✅ Lines 89-95
- **Tracked Data:**
  - Provider: 'vision'
  - Operation: 'rank'
  - Tokens: rankingMetadata.tokensUsed
  - Iteration: (not stored in ranking call)

**Iteration 0 Summary:**
```
✅ LLM:    2N expand calls + N combine calls     = 3N calls TRACKED
✅ Image:  N generateImage calls                 = N calls TRACKED
✅ Vision: N analyzeImage calls + 1 rank call    = N+1 calls TRACKED (rank only if using comparative ranking)
```

---

## Iterations 1+: Refinement Loop (Lines 502-622)

**Note:** Loop runs from iteration=1 to iteration=maxIterations-1 (line 708)

### Step 1: Generate M critiques (one per parent)
- **API Call:** `critiqueGenProvider.generateCritique(feedback, {what, how, combined}, userPrompt, {dimension, iteration})`
- **Count:** M times (in parallel for all parents)
- **Line:** 524
- **Tracking:** ✅ Lines 539-552
- **Tracked Data:**
  - Provider: 'critique'
  - Operation: 'generate'
  - Model: critique.metadata.model
  - Iteration: current iteration
  - CandidateId: parent.metadata.candidateId
  - Dimension: dimension (based on iteration % 2)

### Step 2: Generate N children (expansionRatio per parent)
- **Count:** N total children (N/M per parent)
- **For each child:**

#### 2a: Refine the selected dimension
- **API Call:** `llmProvider.refinePrompt(selected_prompt, {operation: 'refine', dimension, critique, userPrompt})`
- **Count:** N times (M parents × N/M children per parent)
- **Line:** 565
- **Tracking:** ✅ Lines 576-589
- **Tracked Data:**
  - Provider: 'llm'
  - Operation: 'refine'
  - Model: refinedResult.metadata.model
  - Iteration: current iteration
  - CandidateId: computed as parentIdx * expansionRatio + childIdx
  - Dimension: 'what' or 'how' (based on iteration % 2)

#### 2b: Combine WHAT+HOW (via processCandidateStream)
- **API Call:** `llmProvider.combinePrompts(whatPrompt, howPrompt)`
- **Count:** N times
- **Line:** 164 (in processCandidateStream)
- **Tracking:** ✅ Lines 168-180
- **Tracked Data:**
  - Provider: 'llm'
  - Operation: 'combine'
  - Model: combineResult.metadata.model
  - Iteration: current iteration
  - CandidateId: candidateId passed to processCandidateStream

#### 2c: Generate N images (via processCandidateStream)
- **API Call:** `imageGenProvider.generateImage(combined, options)`
- **Count:** N times
- **Line:** 198 (in processCandidateStream)
- **Tracking:** ✅ Lines 201-215
- **Tracked Data:**
  - Provider: 'image'
  - Operation: 'generate'
  - Tokens: 1 per image
  - Model: image.metadata.model
  - Iteration: current iteration
  - CandidateId: candidateId passed to processCandidateStream

#### 2d: Analyze N images (via processCandidateStream, if skipVisionAnalysis=false)
- **API Call:** `visionProvider.analyzeImage(image.url, combined)`
- **Count:** N times (or 0 if skipVisionAnalysis=true)
- **Line:** 223 (in processCandidateStream)
- **Tracking:** ✅ Lines 226-238
- **Tracked Data:**
  - Provider: 'vision'
  - Operation: 'analyze'
  - Model: evaluation.metadata.model
  - Iteration: current iteration
  - CandidateId: candidateId passed to processCandidateStream

### Step 3: Rank all candidates (if using comparative ranking)
- **API Call:** `imageRanker.rankImages(allCandidates, userPrompt, {keepTop, knownComparisons, previousTopCandidates, ensembleSize})`
- **Count:** 1 call
- **Line:** 734
- **Candidates Compared:** N children + M parents = N+M images
- **Known Comparisons Optimization:** Previous iteration's top M parents are passed as knownComparisons to avoid re-ranking
- **Tracking:** ✅ Lines 89-95
- **Tracked Data:**
  - Provider: 'vision'
  - Operation: 'rank'
  - Tokens: rankingMetadata.tokensUsed

**Per Refinement Iteration Summary:**
```
✅ LLM:    M critique calls + N refine calls + N combine calls    = 2N + M calls TRACKED
✅ Image:  N generateImage calls                                  = N calls TRACKED
✅ Vision: N analyzeImage calls + 1 rank call                     = N+1 calls TRACKED (rank only if using comparative ranking)
```

---

## Complete Cost Breakdown

### Total API Calls Across All Iterations

For **maxIterations=K, N=beamWidth, M=keepTop:**

**Initial Expansion (Iteration 0):**
```
LLM Calls:   2N (expand) + N (combine)                     = 3N
Image Calls: N (generate)                                  = N
Vision Calls: N (analyze, if not comparative) + 1 (rank)   = N or 1
```

**Refinement Iterations (Iterations 1 to K-1) - K-1 iterations:**
```
Per iteration:
  LLM Calls:   M (critique) + N (refine) + N (combine)    = 2N + M
  Image Calls: N (generate)                                = N
  Vision Calls: N (analyze, if not comparative) + 1 (rank) = N or 1

Total for K-1 iterations:
  LLM Calls:   (2N + M) × (K-1)
  Image Calls: N × (K-1)
  Vision Calls: (N or 1) × (K-1)
```

**Grand Total:**
```
LLM Calls:   3N + (2N + M) × (K-1)
Image Calls: N + N × (K-1) = N × K
Vision Calls: (N or 1) + (N or 1) × (K-1)
```

### Example: N=4, M=2, K=2 (maxIterations=2)

```
Iteration 0:
  LLM:   3×4 = 12 calls
  Image: 4 calls
  Vision: 4 (analyze) + 1 (rank) = 5 calls

Iteration 1:
  LLM:   (2×4 + 2) = 10 calls
  Image: 4 calls
  Vision: 4 (analyze) + 1 (rank) = 5 calls

GRAND TOTAL:
  LLM:   22 calls
  Image: 8 calls
  Vision: 10 calls
```

---

## Verification Checklist

Use this checklist to verify all tracking is working correctly:

### ✅ Iteration 0

- [ ] Check `tokenTracker.getStats().llmTokens` includes ~12 tokens (N=4: 4 WHAT + 4 HOW + 4 combine)
- [ ] Check `tokenTracker.getStats().imageGenTokens` equals 4 (N=4 images)
- [ ] Check `tokenTracker.getStats().visionTokens` includes 4 analyze calls
- [ ] Verify `tokenTracker.getRecords()` has entries with:
  - [ ] provider='llm', operation='expand', dimension='what', iteration=0
  - [ ] provider='llm', operation='expand', dimension='how', iteration=0
  - [ ] provider='llm', operation='combine', iteration=0
  - [ ] provider='image', operation='generate', iteration=0
  - [ ] provider='vision', operation='analyze', iteration=0
  - [ ] provider='vision', operation='rank' (if using comparative ranking)

### ✅ Iteration 1+

- [ ] Check `tokenTracker.getRecords()` includes:
  - [ ] provider='critique', operation='generate', iteration=1, candidateId=parent_id
  - [ ] provider='llm', operation='refine', iteration=1
  - [ ] provider='llm', operation='combine', iteration=1
  - [ ] provider='image', operation='generate', iteration=1
  - [ ] provider='vision', operation='analyze', iteration=1 (if not comparative ranking)
  - [ ] provider='vision', operation='rank', iteration=1 (if using comparative ranking)

### ✅ Cost Estimation

- [ ] `tokenTracker.getEstimatedCost()` shows cost breakdown by provider
- [ ] `tokenTracker.formatSummary()` displays total tokens and cost
- [ ] Cost is dominated by image generation (~$2-4 per image)
- [ ] LLM/Vision costs are <$0.02 per iteration

---

## Missing Tracking (None!)

All model API calls in the beam search orchestrator are tracked. ✅

If you find an API call that's NOT tracked:
1. Check if it has a `tokenTracker.recordUsage()` call within 5 lines
2. If not, add tracking immediately
3. Update this document

---

## See Also

- [src/orchestrator/beam-search.js](../src/orchestrator/beam-search.js) - Main orchestrator
- [cost-estimation-breakdown.md](./cost-estimation-breakdown.md) - Detailed cost calculations
- [src/utils/token-tracker.js](../src/utils/token-tracker.js) - TokenTracker implementation
