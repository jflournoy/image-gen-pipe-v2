# Cost Estimation & Token Tracking Index

Complete reference for understanding all model API costs in the beam search orchestrator.

---

## 📋 Documentation Files

### START HERE
- **[TOKEN-TRACKING-SUMMARY.md](./TOKEN-TRACKING-SUMMARY.md)** ⭐
  - Quick 2-minute overview
  - All 11 tracking points at a glance
  - Example costs
  - Status: ✅ Complete

### For Detailed Analysis
- **[cost-estimation-breakdown.md](./cost-estimation-breakdown.md)**
  - Complete cost formulas and calculations
  - Token counts per operation
  - Full examples with N=4, M=2, maxIterations=2
  - Model pricing table
  - Optimization recommendations
  - Status: ✅ Complete

### For Implementation
- **[COST-TRACKING-IMPLEMENTATION.md](./COST-TRACKING-IMPLEMENTATION.md)**
  - How to use TokenTracker in code
  - Quick start examples
  - Complete demo code
  - Pre-run cost estimation
  - Integration points
  - Advanced usage patterns
  - Status: ✅ Complete

### For Reference
- **[model-calls-checklist.md](./model-calls-checklist.md)**
  - Line-by-line breakdown of all 11 calls
  - Exact line numbers in source
  - Tracking details per call
  - Verification checklist
  - Status: ✅ Complete

- **[token-tracking-flow.md](./token-tracking-flow.md)**
  - Visual flow diagrams
  - Token flow through pipeline
  - Cost accumulation examples
  - Configuration guide
  - Status: ✅ Complete

---

## 🎯 Quick Navigation

### If you want to...

**Understand the overall cost structure**
→ [TOKEN-TRACKING-SUMMARY.md](./TOKEN-TRACKING-SUMMARY.md)

**Know exact costs before running**
→ [cost-estimation-breakdown.md](./cost-estimation-breakdown.md#complete-cost-calculation)

**Implement token tracking in code**
→ [COST-TRACKING-IMPLEMENTATION.md](./COST-TRACKING-IMPLEMENTATION.md#quick-start)

**Find a specific API call's tracking**
→ [model-calls-checklist.md](./model-calls-checklist.md#all-11-tracking-points)

**See visual flow of costs**
→ [token-tracking-flow.md](./token-tracking-flow.md#pipeline-overview)

**Optimize model selection**
→ [COST-TRACKING-IMPLEMENTATION.md](./COST-TRACKING-IMPLEMENTATION.md#cost-optimization-tips)

**Estimate cost before running**
→ [COST-TRACKING-IMPLEMENTATION.md](./COST-TRACKING-IMPLEMENTATION.md#cost-estimation-before-running)

---

## 📊 Facts at a Glance

### Tracking Coverage
```
✅ 11/11 API calls tracked (100%)
   - 5 LLM operations (expand, refine, combine)
   - 3 Vision operations (analyze, rank)
   - 2 Image operations (generate)
   - 1 Critique operation (generate)
```

### Default Cost (N=4, M=2, maxIterations=2)
```
Image generation: ~$4.00-8.00 (dominates)
LLM operations:   ~$0.01
Vision operations: ~$0.01
Critique generation: ~$0.0005
─────────────────────────────
TOTAL: ~$4.00-8.00
```

### Model Pricing (December 2025)
| Operation | Model | Price |
|-----------|-------|-------|
| expand | gpt-5-nano | $0.05/1M |
| refine | gpt-5-mini | $0.25/1M |
| combine | gpt-5-nano | $0.05/1M |
| generate | gpt-image-1-mini | $2.00/1M |
| analyze | gpt-4o-mini | $0.15/1M |
| rank | gpt-4o-mini | $0.15/1M |
| critique | gpt-5-mini | $0.25/1M |

---

## 🔍 All 11 Tracking Points

| Line | Component | Operation | Provider | Type |
|------|-----------|-----------|----------|------|
| 90 | rankAndSelectComparative | rank | vision | Ranking |
| 169 | processCandidateStream | combine | llm | Refinement |
| 202 | processCandidateStream | generate | image | Refinement |
| 227 | processCandidateStream | analyze | vision | Refinement |
| 320 | initialExpansion | expand | llm | Initial (WHAT) |
| 336 | initialExpansion | expand | llm | Initial (HOW) |
| 368 | initialExpansion | combine | llm | Initial |
| 407 | initialExpansion | generate | image | Initial |
| 434 | initialExpansion | analyze | vision | Initial |
| 540 | refinementIteration | generate | critique | Refinement |
| 577 | refinementIteration | refine | llm | Refinement |

---

## 💰 Cost Formula

### Per Iteration Cost

**Iteration 0 (Initial Expansion):**
```
Cost = (3N × token_count × price_llm)
      + (N × cost_per_image)
      + (N × token_count × price_vision)
      + (rank_tokens × price_vision)

Example (N=4):
= (12 × 2500 × $0.00000005) + (4 × $0.75) + (16000 × $0.00000015) + (12000 × $0.00000015)
= $0.0015 + $3.00 + $0.0024 + $0.0018
= ~$3.00
```

**Iterations 1+ (per iteration):**
```
Cost = ((2N + M) × token_count × avg_price_llm)
      + (N × cost_per_image)
      + ((N + rank_tokens) × price_vision)

Example (N=4, M=2):
= (10 × 2500 × $0.00000015) + (4 × $0.75) + (16000 × $0.00000015) + (18000 × $0.00000015)
= $0.0038 + $3.00 + $0.0024 + $0.0027
= ~$3.00
```

**Total for maxIterations = 2:**
```
Total Cost = $3.00 + $3.00 = ~$6.00
```

---

## 🚀 Getting Started

### 1. Review the Tracking (2 minutes)
Read: [TOKEN-TRACKING-SUMMARY.md](./TOKEN-TRACKING-SUMMARY.md)

### 2. Estimate Your Costs (5 minutes)
Read: [cost-estimation-breakdown.md#complete-cost-calculation](./cost-estimation-breakdown.md#complete-cost-calculation)

### 3. Implement in Code (10 minutes)
Read: [COST-TRACKING-IMPLEMENTATION.md#quick-start](./COST-TRACKING-IMPLEMENTATION.md#quick-start)

### 4. Run and Analyze (5 minutes)
```javascript
const tokenTracker = new TokenTracker();
const result = await beamSearch(prompt, providers, { tokenTracker });
console.log(tokenTracker.formatSummary());
```

---

## ✅ Verification Status

- [x] All 11 API calls tracked
- [x] Complete metadata for each call
- [x] Token counting implemented
- [x] Cost estimation working
- [x] Model pricing updated (Dec 2025)
- [x] Documentation complete
- [x] Examples provided
- [x] No missing tracking points

---

## 📚 Related Files

### Source Code
- [src/orchestrator/beam-search.js](../src/orchestrator/beam-search.js) - All tracking points
- [src/utils/token-tracker.js](../src/utils/token-tracker.js) - TokenTracker class
- [src/config/model-pricing.js](../src/config/model-pricing.js) - Pricing data

### Usage Examples
- [demo-beam-search.js](../demo-beam-search.js) - Complete example
- [test/](../test/) - Test suite with tracking

---

## 💡 Key Insights

### Cost Drivers
1. **Image Generation (99%+ of cost)**
   - ~$0.50-1.00 per image
   - N images per iteration
   - Multiple iterations = multiplied cost

2. **LLM Operations (<1% of cost)**
   - Expand: gpt-5-nano ($0.05/1M)
   - Refine: gpt-5-mini ($0.25/1M)
   - Combine: gpt-5-nano ($0.05/1M)

3. **Vision Operations (<1% of cost)**
   - Analyze: gpt-4o-mini ($0.15/1M)
   - Rank: gpt-4o-mini ($0.15/1M)

### Cost Optimization
- **Use comparative ranking** - Skips vision analyze for initial candidates
- **Reduce N** - Fewer candidates per iteration
- **Reduce maxIterations** - Fewer refinement cycles
- **Use efficient models** - nano/mini for simple tasks

---

## 🔧 Troubleshooting

### No cost showing?
1. Check tokenTracker passed to beamSearch
2. Verify recordUsage() calls have tokens field
3. Check MODEL_PRICING has entries

### Cost too high?
1. Count images: N × maxIterations
2. Check image size/quality
3. Review vision:rank token counts

### Missing data?
1. Verify all recordUsage() calls have metadata
2. Check provider/operation/tokens fields
3. Review docs/model-calls-checklist.md

---

## 📞 Support

For questions about:
- **Specific tracking points** → See model-calls-checklist.md
- **Cost calculation** → See cost-estimation-breakdown.md
- **Implementation** → See COST-TRACKING-IMPLEMENTATION.md
- **Overall approach** → See TOKEN-TRACKING-SUMMARY.md
- **Visual flow** → See token-tracking-flow.md

---

## Version History

- **v1.0** (December 2025)
  - Initial complete tracking documentation
  - All 11 API calls documented
  - Cost formulas and examples
  - Implementation guide

---

## Summary

✅ **All model API calls in the beam search orchestrator are fully tracked.**

The system provides:
- Automatic token counting for every API call
- Complete cost estimation with breakdown by provider
- Optimization suggestions for cost reduction
- Comprehensive metadata for analysis

**No tracking points are missing.** Every API call has:
1. Token tracking
2. Cost calculation
3. Metadata recording
4. Optimization analysis

See the documentation files above for complete details and examples.
