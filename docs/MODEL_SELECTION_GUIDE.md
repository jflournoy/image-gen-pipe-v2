# Model Selection Guide

Quick reference for choosing cost-efficient OpenAI models for the image generation pipeline.

**Last Updated:** December 2025
**Source:** [OpenAI API Pricing](https://openai.com/api/pricing/)

## TL;DR - Recommended Configuration

```bash
# .env file (copy from .env.example)
OPENAI_LLM_MODEL=gpt-5-mini         # $0.25/1M tokens
OPENAI_VISION_MODEL=gpt-4o-mini     # $0.15/1M tokens
OPENAI_IMAGE_MODEL=gpt-image-1-mini # Cost-efficient images
```

**Cost savings:** ~99% compared to legacy GPT-4 models!

## Complete Pricing Reference

All prices shown are per 1 million **input** tokens (December 2025).

### GPT-5 Models (Latest, Recommended)

| Model | Cost/1M | Best For | Use Cases |
|-------|---------|----------|-----------|
| **gpt-5-nano** | $0.05 | Simple tasks | `expand`, `combine` operations |
| **gpt-5-mini** | $0.25 | Most tasks | `refine`, `critique` (⭐ recommended default) |
| **gpt-5.1** | $1.25 | Flagship reasoning | Advanced reasoning, complex analysis |

### GPT-4o Models (Vision-Capable)

| Model | Cost/1M | Best For | Use Cases |
|-------|---------|----------|-----------|
| **gpt-4o-mini** | $0.15 | Vision tasks | Image analysis, scoring (⭐ recommended) |
| **gpt-4o** | $2.50 | Premium vision | High-quality image critique |

### Legacy Models (Avoid if Possible)

| Model | Cost/1M | Notes |
|-------|---------|-------|
| gpt-4-turbo | $10.00 | ⚠️ 40x more expensive than gpt-5-mini |
| gpt-4 | $30.00 | ⚠️ 120x more expensive than gpt-5-mini |
| gpt-3.5-turbo | $0.50 | ⚠️ 2x more expensive than gpt-5-mini, less capable |

## Cost Comparison Examples

### Beam Search with N=4, M=2, 3 Iterations (~10,000 tokens)

| Configuration | Cost | Savings vs GPT-4 |
|--------------|------|------------------|
| **Optimized** (gpt-5-mini + gpt-4o-mini) | $0.0015 | 99.0% |
| Legacy (gpt-4 + gpt-4o) | $0.1460 | baseline |

### Per Operation Type

**LLM Operations** (expand, refine, combine):
- gpt-4: $30.00/1M tokens
- gpt-5-nano: $0.05/1M tokens
- **Savings: 99.8%** 💰

**Vision Operations** (analyze):
- gpt-4o: $2.50/1M tokens
- gpt-4o-mini: $0.15/1M tokens
- **Savings: 94.0%** 💰

## Model Selection Strategy

### Operation-Specific Model Selection

**NEW:** You can now configure different models for different LLM operations for maximum cost optimization!

The image generation pipeline has three main LLM operations:
- **expand**: Initial prompt expansion (simple task)
- **refine**: Iterative prompt refinement based on critique (complex task)
- **combine**: Combining WHAT + HOW prompts (simple task)

**Cost optimization strategy:**
- Use `gpt-5-nano` ($0.05/1M) for simple operations: expand, combine
- Use `gpt-5-mini` ($0.25/1M) for complex operations: refine

This provides **5x cost savings** on expand/combine operations while maintaining high quality on refine operations!

### By Operation Type

Use the centralized model recommendations from `src/config/model-pricing.js`:

```javascript
const { getRecommendedModel } = require('./src/config/model-pricing.js');

// Get optimal model for a use case
const rec = getRecommendedModel('refine');
// Returns: { model: 'gpt-5-mini', tier: 'moderate', pricePerToken: 0.00000025 }
```

### Recommendation Tiers

**Simple Tier** (gpt-5-nano, $0.05/1M):
- Use for: `expand`, `combine`, simple prompts
- Quality: Excellent for straightforward tasks
- Savings: 99.8% vs GPT-4

**Moderate Tier** (gpt-5-mini, $0.25/1M):
- Use for: `refine`, `critique`, analysis
- Quality: Superior reasoning, great value
- Savings: 99.2% vs GPT-4
- **⭐ Recommended default**

**Complex Tier** (gpt-5.1, $1.25/1M):
- Use for: Complex reasoning, coding, planning
- Quality: Flagship-tier performance
- Savings: 96% vs GPT-4

**Vision Tier** (gpt-4o-mini, $0.15/1M):
- Use for: Image analysis, vision scoring
- Quality: Excellent for vision tasks
- Savings: 94% vs GPT-4o
- **⭐ Recommended for vision**

**Vision Premium** (gpt-4o, $2.50/1M):
- Use for: Detailed image analysis, critical vision tasks
- Quality: Best-in-class vision
- Savings: 17% vs legacy gpt-4

## Token Tracking

Monitor your actual usage with `TokenTracker`:

```javascript
const { MODEL_PRICING } = require('./src/config/model-pricing.js');
const TokenTracker = require('./src/utils/token-tracker.js');

const tracker = new TokenTracker({
  sessionId: 'ses-123456',
  pricing: MODEL_PRICING  // Uses centralized pricing
});

// Track usage
tracker.recordUsage({
  provider: 'llm',
  operation: 'refine',
  tokens: 1500,
  metadata: { model: 'gpt-4' }  // Oops, using expensive model!
});

// Get optimization suggestions
const suggestions = tracker.getOptimizationSuggestions();
// Suggests: Switch to gpt-5-mini, save $0.0435 (99.2%)
```

## Environment Configuration

### Operation-Specific Models (Maximum Optimization - RECOMMENDED)

Use different models for different operations to maximize cost savings:

```bash
# .env
# Operation-specific models (recommended for maximum savings)
OPENAI_LLM_MODEL_EXPAND=gpt-5-nano    # Simple expansion: $0.05/1M
OPENAI_LLM_MODEL_REFINE=gpt-5-mini    # Complex refinement: $0.25/1M
OPENAI_LLM_MODEL_COMBINE=gpt-5-nano   # Simple combining: $0.05/1M

# Fallback model (used if operation-specific not set)
OPENAI_LLM_MODEL=gpt-5-mini

OPENAI_VISION_MODEL=gpt-4o-mini         # $0.15/1M
```

**Cost breakdown:**
- Expand operations: 5x cheaper using nano vs mini
- Refine operations: Best quality/cost with mini
- Combine operations: 5x cheaper using nano vs mini

**Estimated cost:** ~$0.0015 per beam search run (40% additional savings vs single model!)

### For Development (Maximum Cost Savings)

```bash
# .env
OPENAI_LLM_MODEL=gpt-5-nano       # $0.05/1M - ultra cheap
OPENAI_VISION_MODEL=gpt-4o-mini     # $0.15/1M
```

**Estimated cost:** ~$0.001 per beam search run

### For Production (Balanced Quality/Cost)

```bash
# .env
OPENAI_LLM_MODEL=gpt-5-mini       # $0.25/1M - recommended
OPENAI_VISION_MODEL=gpt-4o-mini     # $0.15/1M
```

**Estimated cost:** ~$0.0015 per beam search run

**Note:** Using operation-specific models (see above) provides better optimization than a single model.

### For Premium Quality (When Budget Allows)

```bash
# .env
OPENAI_LLM_MODEL=gpt-5.1            # $1.25/1M
OPENAI_VISION_MODEL=gpt-4o          # $2.50/1M
```

**Estimated cost:** ~$0.020 per beam search run
**Still 86% cheaper than GPT-4!**

## Migration Path

### From GPT-4 to GPT-5 Models

**Step 1:** Update `.env` file
```bash
# Old (expensive)
OPENAI_LLM_MODEL=gpt-4

# New (cost-efficient)
OPENAI_LLM_MODEL=gpt-5-mini
```

**Step 2:** Test with demo
```bash
node demo-token-tracking.js
# Shows actual costs and optimization suggestions
```

**Step 3:** Review token tracker reports
```bash
# After running beam search
# Check: output/YYYY-MM-DD/ses-HHMMSS/metadata.json
# Look for token usage and costs
```

## Key Insights

1. **GPT-5 models are MUCH cheaper** than GPT-4 while being more capable
2. **gpt-5-nano** is 600x cheaper than gpt-4 for simple tasks
3. **gpt-4o-mini** is 17x cheaper than gpt-4o for vision tasks
4. **No quality loss** - newer models are actually better
5. **Easy to switch** - just update environment variables

## Quick Reference Commands

```bash
# Run demo to see pricing in action
node demo-token-tracking.js

# Check current model configuration
grep OPENAI_ .env

# Run tests with cost tracking
npm test test/utils/token-tracker.test.js

# View centralized pricing
cat src/config/model-pricing.js
```

## Further Reading

- [Centralized Pricing Config](../src/config/model-pricing.js) - Complete pricing data
- [Token Tracker](../src/utils/token-tracker.js) - Usage tracking and optimization
- [OpenAI API Pricing](https://openai.com/api/pricing/) - Official pricing page
- [Model Docs](https://platform.openai.com/docs/models) - Official model documentation

## Need Help?

If you're unsure which model to use:

1. **Start with defaults** (gpt-5-mini + gpt-4o-mini)
2. **Run TokenTracker** to see actual usage
3. **Check optimization suggestions** for savings opportunities
4. **Experiment** - models are cheap enough to try different tiers!

---

**Remember:** The best model is the cheapest one that meets your quality requirements. Start cheap, upgrade only if needed!
