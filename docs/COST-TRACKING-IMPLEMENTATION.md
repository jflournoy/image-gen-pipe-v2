# Cost Tracking Implementation Guide

How to use and integrate the token tracking system for cost estimation.

---

## Quick Start

### 1. Create a TokenTracker Instance

```javascript
const TokenTracker = require('./src/utils/token-tracker.js');

const tokenTracker = new TokenTracker({
  sessionId: 'beam-search-session-001'
});
```

### 2. Pass to Beam Search

```javascript
const result = await beamSearch(userPrompt, providers, {
  beamWidth: 4,
  keepTop: 2,
  maxIterations: 2,
  tokenTracker,  // ← Add here
});
```

### 3. Get Results

```javascript
// Summary statistics
console.log(tokenTracker.formatSummary());

// Cost breakdown
const cost = tokenTracker.getEstimatedCost();
console.log(`Total Cost: $${cost.total.toFixed(4)}`);
console.log(`  LLM: $${cost.llm.toFixed(4)}`);
console.log(`  Vision: $${cost.vision.toFixed(4)}`);
console.log(`  Image: $${cost.imageGen.toFixed(4)}`);

// Optimization suggestions
console.log(tokenTracker.formatOptimizationReport());
```

---

## Complete Example

```javascript
#!/usr/bin/env node

const { beamSearch } = require('./src/orchestrator/beam-search.js');
const { createProviders } = require('./src/factory/provider-factory.js');
const TokenTracker = require('./src/utils/token-tracker.js');

async function demo() {
  // Create providers
  const providers = await createProviders({
    llm: { model: 'gpt-5-nano' },
    imageGen: { model: 'gpt-image-1-mini' },
    vision: { model: 'gpt-4o-mini' },
    critiqueGen: { model: 'gpt-5-mini' }
  });

  // Create token tracker
  const tokenTracker = new TokenTracker({
    sessionId: `demo-${new Date().toISOString()}`
  });

  // Run beam search
  const result = await beamSearch('A peaceful sunset over mountains', providers, {
    beamWidth: 4,
    keepTop: 2,
    maxIterations: 2,
    tokenTracker,  // ← Pass tracker
    metadataTracker,
    imageRanker // Use comparative ranking for better cost optimization
  });

  // Display results
  console.log(tokenTracker.formatSummary());
  console.log(tokenTracker.formatOptimizationReport());

  // Export to JSON for logging
  const json = tokenTracker.toJSON();
  fs.writeFileSync('cost-report.json', JSON.stringify(json, null, 2));
}

demo().catch(console.error);
```

---

## Cost Estimation Before Running

### Formula

For given parameters:
- N = beamWidth (candidates per iteration)
- M = keepTop (parents to keep)
- K = maxIterations
- Using comparative ranking = skipVisionAnalysis

**Total Cost ≈**
```
Image Cost:
  = N × K × cost_per_image
  = 4 × 2 × $0.75 (average)
  = $6.00

LLM Cost:
  Iteration 0: (2N + N) × token_count × llm_price
  = 3 × 4 × 3,000 × $0.00000005
  = $0.0018

Vision Cost:
  Iteration 0: N × 4,000 × $0.00000015 + rank_tokens × $0.00000015
  = 4 × 4,000 × $0.00000015 + 12,000 × $0.00000015
  = $0.0042

Iterations 1+: Similar pattern repeated

Total: Image dominates (~$6) + LLM/Vision (~$0.02)
```

### Pre-Run Cost Estimate

```javascript
function estimateBeamSearchCost(config) {
  const { beamWidth: N, keepTop: M, maxIterations: K } = config;
  const costPerImage = 0.75; // Average for gpt-image-1-mini

  // Image generation cost (main cost)
  const imageCost = N * K * costPerImage;

  // LLM tokens (rough estimate)
  const llmTokensPerIter = (3 * N + M * 2 + N * 2) * 2500;
  const llmCost = llmTokensPerIter * K * 0.00000025; // gpt-5-mini

  // Vision tokens
  const visionTokensPerIter = N * 4000 + 15000; // analyze + rank
  const visionCost = visionTokensPerIter * K * 0.00000015; // gpt-4o-mini

  return {
    image: imageCost,
    llm: llmCost,
    vision: visionCost,
    total: imageCost + llmCost + visionCost
  };
}

const estimate = estimateBeamSearchCost({
  beamWidth: 4,
  keepTop: 2,
  maxIterations: 2
});

console.log(`Estimated Cost: $${estimate.total.toFixed(2)}`);
console.log(`  Image: $${estimate.image.toFixed(2)}`);
console.log(`  LLM: $${estimate.llm.toFixed(4)}`);
console.log(`  Vision: $${estimate.vision.toFixed(4)}`);
```

---

## Interpreting the Cost Report

### Summary Format

```
════════════════════════════════════════════════════════════
📊 Token Usage Summary
════════════════════════════════════════════════════════════
Session: beam-search-session-001

Total Tokens: 100,000
  • LLM: 20,000
  • Vision: 60,000
  • Critique: 2,000
  • Image Gen: 8

Estimated Cost: $4.0237
  • LLM: $0.0015
  • Vision: $0.0090
  • Critique: $0.0005
  • Image Gen: $4.0000

Duration: 45.3s
Records: 22
════════════════════════════════════════════════════════════
```

### Optimization Report Format

```
════════════════════════════════════════════════════════════
💡 Model Optimization Suggestions
════════════════════════════════════════════════════════════

Current Cost: $4.0237
Optimized Cost: $3.9950
Potential Savings: $0.0287 (0.7%)

Recommendations:
────────────────────────────────────────────────────────────

Operation: refine
  Current: gpt-5-mini → Suggested: gpt-5-nano
  Tokens: 10,000
  Savings: $0.0002 (50.0%)
  Reason: Refinement benefits from gpt-5-mini's capabilities at excellent value

Operation: analyze
  Current: gpt-4o-mini → Suggested: gpt-4o-mini
  Tokens: 16,000
  Savings: $0.0000 (0.0%)
  Reason: Vision analysis works excellently with gpt-4o-mini

════════════════════════════════════════════════════════════
```

---

## Integration Points

### 1. In Beam Search Demo

File: [demo-beam-search.js](../demo-beam-search.js)

```javascript
// Around line 490
const tokenTracker = new TokenTracker({
  sessionId: sessionId
});

const result = await beamSearch(userPrompt, providers, {
  // ... other config
  tokenTracker  // ← Add this line
});

// At the end
console.log(tokenTracker.formatSummary());
```

### 2. In Web API

File: [src/api/beam-search-worker.js](../src/api/beam-search-worker.js)

```javascript
// Create tracker for each job
const tokenTracker = new TokenTracker({
  sessionId: `job-${jobId}`
});

// Pass to beamSearch
const result = await beamSearch(userPrompt, providers, {
  // ... config
  tokenTracker
});

// Return cost data with result
return {
  result,
  cost: tokenTracker.getEstimatedCost(),
  summary: tokenTracker.getSummary()
};
```

### 3. In Test Suite

File: [test/beam-search.test.js](../test/beam-search.test.js)

```javascript
it('should track all token usage', async () => {
  const tokenTracker = new TokenTracker();

  await beamSearch(prompt, providers, {
    beamWidth: 2,
    keepTop: 1,
    maxIterations: 1,
    tokenTracker
  });

  const stats = tokenTracker.getStats();
  assert(stats.llmTokens > 0, 'Should track LLM tokens');
  assert(stats.imageGenTokens > 0, 'Should track image generation');
  assert(stats.visionTokens > 0, 'Should track vision tokens');
});
```

---

## Advanced Usage

### 1. Custom Pricing

```javascript
const customPricing = {
  llm: 0.0000002,        // Custom price per token
  vision: 0.0000001,
  critique: 0.0000002,
  image: 0.0005          // Or use provider-specific: 'gpt-image-1-mini': {...}
};

const tokenTracker = new TokenTracker({
  sessionId: 'custom-pricing-test',
  pricing: customPricing
});
```

### 2. Batch Processing

```javascript
async function runMultipleBeamSearches(prompts) {
  const results = [];
  const totalTracker = new TokenTracker({
    sessionId: 'batch-run'
  });

  for (const prompt of prompts) {
    // Create individual tracker for each run
    const tracker = new TokenTracker();

    const result = await beamSearch(prompt, providers, {
      tokenTracker: tracker
    });

    results.push({
      prompt,
      result,
      cost: tracker.getEstimatedCost()
    });

    // Merge tracking data
    for (const record of tracker.getRecords()) {
      totalTracker.recordUsage(record);
    }
  }

  // Summary across all runs
  console.log(totalTracker.formatSummary());
  return results;
}
```

### 3. Cost Alerts

```javascript
const tokenTracker = new TokenTracker();
const costBudget = 5.00; // $5 budget

// ... run beam search ...

const cost = tokenTracker.getEstimatedCost();
if (cost.total > costBudget) {
  console.warn(`⚠️ Cost ${cost.total} exceeded budget ${costBudget}`);
  // Take action: cancel, pause, notify, etc.
}
```

### 4. Cost Analytics

```javascript
// Track cost trends
const costHistory = [];

for (let i = 0; i < 10; i++) {
  const tracker = new TokenTracker();
  await beamSearch(prompt, providers, { tokenTracker: tracker });

  costHistory.push({
    iteration: i,
    cost: tracker.getEstimatedCost().total,
    tokens: tracker.getStats().totalTokens
  });
}

// Analyze trends
const avgCost = costHistory.reduce((s, h) => s + h.cost, 0) / costHistory.length;
console.log(`Average cost per run: $${avgCost.toFixed(4)}`);
```

---

## Cost Optimization Tips

### 1. Use Comparative Ranking

Enable comparative ranking to skip vision analysis on intermediate candidates:

```javascript
const result = await beamSearch(userPrompt, {
  ...providers,
  imageRanker: rankerInstance  // ← Enables comparative ranking
}, {
  beamWidth: 4,
  keepTop: 2,
  maxIterations: 2
});

// Saves: N × vision:analyze per iteration
// For N=4, K=2: saves ~$0.002 (minimal, but helps)
```

### 2. Reduce Beam Width

Smaller N reduces image generation cost (the main cost):

```
N=2: ~$2-4 per iteration
N=4: ~$4-8 per iteration
N=8: ~$8-16 per iteration
```

### 3. Reduce Iterations

Fewer iterations = fewer candidates:

```javascript
await beamSearch(prompt, providers, {
  beamWidth: 4,
  keepTop: 2,
  maxIterations: 1  // ← Only initial expansion
  // Saves one full refinement cycle (~$4)
});
```

### 4. Monitor Token Usage

Use `tokenTracker.getOptimizationSuggestions()` to identify expensive operations:

```javascript
const suggestions = tokenTracker.getOptimizationSuggestions();
for (const sug of suggestions) {
  if (sug.potentialSavings > 0.01) {
    console.log(`💰 Save $${sug.potentialSavings.toFixed(4)}: Use ${sug.suggestedModel} for ${sug.operation}`);
  }
}
```

---

## Troubleshooting

### No Cost Showing?

1. Verify tokenTracker is passed to beamSearch
2. Check that recordUsage() calls have metadata
3. Verify MODEL_PRICING has entries for used models

### Cost Seems Too High?

1. Check image count: N × maxIterations
2. Verify image size/quality settings
3. Look at vision:rank tokens (can be large for many candidates)

### Missing Token Data?

Check that all tokenTracker.recordUsage() calls include tokens field:

```javascript
tokenTracker.recordUsage({
  provider: 'llm',
  operation: 'expand',
  tokens: 5000,  // ← Must have this
  metadata: {...}
});
```

---

## Files Referenced

- [src/utils/token-tracker.js](../src/utils/token-tracker.js) - TokenTracker class
- [src/config/model-pricing.js](../src/config/model-pricing.js) - Pricing configuration
- [src/orchestrator/beam-search.js](../src/orchestrator/beam-search.js) - Beam search with tracking
- [demo-beam-search.js](../demo-beam-search.js) - Example usage

---

## Next Steps

1. Run demo with token tracking enabled
2. Review formatSummary() output
3. Check optimization suggestions
4. Adjust model selections based on recommendations
5. Monitor costs across multiple runs
