/**
 * OpenAI Model Pricing Configuration
 *
 * Centralized pricing data for all OpenAI models used in the image generation pipeline.
 * Pricing is per token (input tokens), sourced from official OpenAI API pricing page.
 *
 * Last updated: December 2025
 * Source: https://openai.com/api/pricing/
 *
 * Usage:
 *   const { MODEL_PRICING, getPricing } = require('./config/model-pricing.js');
 *
 *   // Use default pricing
 *   const tracker = new TokenTracker({ pricing: MODEL_PRICING });
 *
 *   // Or get pricing for specific model
 *   const cost = tokens * getPricing('gpt-5.1-nano');
 */

/**
 * Official OpenAI API pricing per token (December 2025)
 * Prices shown as {input, output} objects in USD per token
 *
 * Source: https://openai.com/api/pricing/
 * Note: Output tokens cost ~4x more than input tokens
 *
 * FLEX TIER PRICING (50% savings):
 * - gpt-5-nano: $0.025/1M (Standard) → $0.0125/1M (Flex)
 * - gpt-5-mini: $0.25/1M (Standard) → $0.125/1M (Flex)
 * - gpt-5: $1.25/1M (Standard) → $0.625/1M (Flex)
 * Trade-off: Occasional 429 rate limit errors, slower response times
 * Benefits: 50% cost savings, vision-capable models, immediate response (vs Batch API 24h wait)
 */
const MODEL_PRICING = {
  // GPT-5 models (latest, most capable - December 2025 release)
  // Vision-capable with Flex pricing support
  'gpt-5.1': {
    standard: {
      input: 0.00000125,            // $1.25 per 1M input tokens (flagship reasoning)
      output: 0.000005              // $5.00 per 1M output tokens
    },
    flex: {
      input: 0.000000625,           // $0.625 per 1M input tokens (50% savings!)
      output: 0.0000025             // $2.50 per 1M output tokens
    }
  },
  'gpt-5': {
    standard: {
      input: 0.00000125,            // $1.25 per 1M input tokens
      output: 0.000005              // $5.00 per 1M output tokens
    },
    flex: {
      input: 0.000000625,           // $0.625 per 1M input tokens (50% savings!)
      output: 0.0000025             // $2.50 per 1M output tokens
    }
  },
  'gpt-5-mini': {
    standard: {
      input: 0.00000025,            // $0.25 per 1M input tokens (best balance)
      output: 0.000001              // $1.00 per 1M output tokens
    },
    flex: {
      input: 0.000000125,           // $0.125 per 1M input tokens (50% savings!)
      output: 0.0000005             // $0.50 per 1M output tokens
    }
  },
  'gpt-5-nano': {
    standard: {
      input: 0.00000005,            // $0.05 per 1M input tokens (ultra-cheap)
      output: 0.0000002             // $0.20 per 1M output tokens
    },
    flex: {
      input: 0.000000025,           // $0.025 per 1M input tokens (50% savings!) ← CURRENT DEFAULT
      output: 0.0000001             // $0.10 per 1M output tokens
    }
  },

  // GPT Image models (multimodal image generation)
  'gpt-image-1': {
    input: 0.000005,              // $5.00 per 1M text input tokens
    output: 0.00004               // $40.00 per 1M output tokens
  },
  'gpt-image-1-mini': {
    input: 0.000002,              // $2.00 per 1M text input tokens
    output: 0.000008              // $8.00 per 1M output tokens
  },

  // GPT-4o models (vision-capable) - using 4x multiplier estimate
  'gpt-4o': {
    input: 0.0000025,             // $2.50 per 1M input tokens
    output: 0.00001               // $10.00 per 1M output tokens (estimated)
  },
  'gpt-4o-mini': {
    input: 0.00000015,            // $0.15 per 1M input tokens
    output: 0.0000006             // $0.60 per 1M output tokens (estimated)
  },

  // GPT-4 models (legacy, higher cost) - using 4x multiplier estimate
  'gpt-4-turbo': {
    input: 0.00001,               // $10.00 per 1M input tokens
    output: 0.00004               // $40.00 per 1M output tokens (estimated)
  },
  'gpt-4': {
    input: 0.00003,               // $30.00 per 1M input tokens
    output: 0.00012               // $120.00 per 1M output tokens (estimated)
  },

  // GPT-3.5 models (legacy, budget option) - using 4x multiplier estimate
  'gpt-3.5-turbo': {
    input: 0.0000005,             // $0.50 per 1M input tokens
    output: 0.000002              // $2.00 per 1M output tokens (estimated)
  },

  // Generic fallback pricing (deprecated - use specific models instead)
  llm: 0.00000025,                 // Default to gpt-5-mini input pricing (legacy support)
  vision: 0.00000005,              // Default to gpt-5-nano Standard input pricing (legacy support)
  critique: 0.00000025             // Default to gpt-5-mini input pricing (legacy support)
};

/**
 * Model recommendation tiers for cost optimization
 * Maps use cases to recommended models based on capability/cost trade-offs
 */
const MODEL_RECOMMENDATIONS = {
  // Simple text operations - use nano tier
  simple: {
    model: 'gpt-5-nano',
    use_cases: ['expand', 'combine', 'simple_prompts'],
    cost_per_1m: 0.05
  },

  // Moderate complexity - use mini tier
  moderate: {
    model: 'gpt-5-mini',
    use_cases: ['refine', 'critique', 'analysis'],
    cost_per_1m: 0.25
  },

  // Complex reasoning - use full tier
  complex: {
    model: 'gpt-5.1',
    use_cases: ['complex_reasoning', 'coding', 'planning'],
    cost_per_1m: 1.25
  },

  // Vision tasks - use vision-optimized models with Flex pricing (50% savings)
  vision: {
    model: 'gpt-5-nano',
    use_cases: ['image_analysis', 'vision_scoring'],
    cost_per_1m: 0.025,  // Flex pricing: $0.025/1M (was $0.05 Standard)
    tier: 'flex'
  },

  // High-quality vision - use better vision model
  vision_premium: {
    model: 'gpt-5-mini',
    use_cases: ['detailed_image_analysis', 'vision_critique'],
    cost_per_1m: 0.125,  // Flex pricing: $0.125/1M (was $0.25 Standard)
    tier: 'flex'
  }
};

/**
 * Get pricing for a specific model
 * @param {string} modelName - Model name (e.g., 'gpt-5-nano')
 * @returns {Object|number|null} Pricing object {input, output} or single number, or null if model not found
 */
function getPricing(modelName) {
  return MODEL_PRICING[modelName] || null;
}

/**
 * Get recommended model for a use case
 * @param {string} useCase - Use case (e.g., 'expand', 'refine', 'analyze')
 * @returns {Object} Recommendation with model name and pricing
 */
function getRecommendedModel(useCase) {
  // Find the tier that includes this use case
  for (const [tier, config] of Object.entries(MODEL_RECOMMENDATIONS)) {
    if (config.use_cases.includes(useCase)) {
      const pricing = MODEL_PRICING[config.model];
      return {
        model: config.model,
        tier,
        pricePerToken: typeof pricing === 'object' ? pricing.input : pricing,
        costPer1M: config.cost_per_1m
      };
    }
  }

  // Default to moderate tier if not found
  const moderatePricing = MODEL_PRICING[MODEL_RECOMMENDATIONS.moderate.model];
  return {
    model: MODEL_RECOMMENDATIONS.moderate.model,
    tier: 'moderate',
    pricePerToken: typeof moderatePricing === 'object' ? moderatePricing.input : moderatePricing,
    costPer1M: MODEL_RECOMMENDATIONS.moderate.cost_per_1m
  };
}

/**
 * Calculate cost for token usage
 * @param {string} modelName - Model name
 * @param {number|Object} tokens - Number of tokens (legacy) or {input, output} object
 * @returns {number} Cost in USD
 */
function calculateCost(modelName, tokens) {
  const pricing = getPricing(modelName);
  if (!pricing) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  // Handle new format: {input, output} token counts
  if (typeof tokens === 'object' && tokens !== null) {
    // Pricing must be an object with input/output
    if (typeof pricing === 'object' && pricing.input !== undefined && pricing.output !== undefined) {
      const inputCost = (tokens.input || 0) * pricing.input;
      const outputCost = (tokens.output || 0) * pricing.output;
      return inputCost + outputCost;
    }
    // Legacy pricing (single number) with new token format - use input price only
    if (typeof pricing === 'number') {
      return (tokens.input || 0) * pricing;
    }
  }

  // Handle legacy format: single token count
  if (typeof tokens === 'number') {
    // If pricing is object, use input price only for backward compatibility
    if (typeof pricing === 'object' && pricing.input !== undefined) {
      return tokens * pricing.input;
    }
    // Legacy pricing (single number)
    if (typeof pricing === 'number') {
      return tokens * pricing;
    }
  }

  throw new Error(`Invalid tokens format for model ${modelName}`);
}

/**
 * Get cost comparison between two models
 * @param {string} currentModel - Current model name
 * @param {string} suggestedModel - Suggested model name
 * @param {number} tokens - Number of tokens
 * @returns {Object} Comparison with savings
 */
function compareCosts(currentModel, suggestedModel, tokens) {
  const currentCost = calculateCost(currentModel, tokens);
  const suggestedCost = calculateCost(suggestedModel, tokens);
  const savings = currentCost - suggestedCost;
  const savingsPercentage = (savings / currentCost) * 100;

  return {
    currentCost,
    suggestedCost,
    savings,
    savingsPercentage,
    worthSwitching: savings > 0.001 // At least $0.001 savings
  };
}

module.exports = {
  MODEL_PRICING,
  MODEL_RECOMMENDATIONS,
  getPricing,
  getRecommendedModel,
  calculateCost,
  compareCosts
};
