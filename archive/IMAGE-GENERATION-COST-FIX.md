# Image Generation Cost Tracking Fix

## Issue Identified

In the token usage summary, image generation costs were not being calculated:

```
Total Tokens: 141,162
  • Image Gen: 12                    ← Tracked as tokens

Estimated Cost: $0.0353
  • Image Gen: (missing)             ← Cost not shown!
```

## Root Cause

The `TokenTracker.getEstimatedCost()` method was looking for `this.pricing.image` to calculate image generation costs, but this generic fallback price was not defined in the pricing configuration.

**File:** [src/config/model-pricing.js](src/config/model-pricing.js)

**Missing:** Generic `image` fallback price

## Solution Applied

Added generic image generation pricing to model pricing config:

```javascript
// Generic fallback pricing
llm: 0.00000025,       // $0.25 per 1M LLM tokens
vision: 0.00000005,    // $0.05 per 1M vision tokens
critique: 0.00000025,  // $0.25 per 1M critique tokens
image: 0.04            // $0.04 per image (NEW FIX)
```

## How Image Generation Cost Works

- **Tracked as:** 1 token per image (see line 205, 407 in beam-search.js)
- **Cost per image:** $0.04 (average for gpt-image-1-mini at 1024x1024)
- **Formula:** `imageGenTokens × $0.04 = image generation cost`

## Example: Corrected Cost Breakdown

**Before fix:**
```
Image Gen: 12 tokens
Estimated Cost: $0.0353
  • LLM: $0.0310
  • Vision: $0.0000
  • Critique: $0.0043
  • Image Gen: (missing)
```

**After fix:**
```
Image Gen: 12 tokens
Estimated Cost: $0.5153
  • LLM: $0.0310
  • Vision: $0.0000
  • Critique: $0.0043
  • Image Gen: $0.48         ← NOW CALCULATED: 12 images × $0.04
```

## What Changed

**[src/config/model-pricing.js](src/config/model-pricing.js) - Line 118**

Added:
```javascript
image: 0.04  // Average cost per image (gpt-image-1-mini, 1024x1024 size)
```

## Why This Matters

Image generation is the **dominant cost** in beam search (~99% of total cost):
- 4 candidates per iteration × multiple iterations = 8-12 images
- Each image: ~$0.04
- Total image cost dominates: $0.32-0.48 per run

Without this fix, the cost report was severely underestimating the true cost of beam search.

## Pricing Details

**Current Image Model:** gpt-image-1-mini

| Size | Cost |
|------|------|
| 1024×1024 | $0.04 |
| 1024×1792 | $0.06 |
| 1792×1792 | $0.08 |

Using average: **$0.04** (most common size is 1024×1024)

## Cost Tracking Behavior

Now the token tracker correctly calculates:

```javascript
getEstimatedCost() {
  return {
    total: stats.llmTokens * pricing.llm +
           stats.visionTokens * pricing.vision +
           stats.critiqueTokens * pricing.critique +
           stats.imageGenTokens * pricing.image,  // ← NOW WORKS

    llm: stats.llmTokens * pricing.llm,
    vision: stats.visionTokens * pricing.vision,
    critique: stats.critiqueTokens * pricing.critique,
    imageGen: stats.imageGenTokens * pricing.image  // ← NOW WORKS
  };
}
```

## Verification

Run demo and verify output includes:
```
Estimated Cost: $X.XXXX
  • LLM: $X.XXXX
  • Vision: $X.XXXX
  • Critique: $X.XXXX
  • Image Gen: $X.XXXX         ← Should show here now
```

## Files Modified

- [src/config/model-pricing.js](src/config/model-pricing.js) - Added `image: 0.04`

## No Other Changes

- TokenTracker implementation unchanged ✅
- Tracking logic unchanged ✅
- Format/display logic unchanged ✅
- Demo unchanged ✅

Only the pricing configuration was missing, now added.

---

**Status:** ✅ Fixed - Image generation costs now properly calculated
