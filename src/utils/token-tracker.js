/**
 * 🟢 TDD GREEN Phase: Token Efficiency Tracker
 *
 * Tracks token usage across all providers to enable cost optimization.
 * Monitors: LLM, Vision, and Critique token consumption per operation.
 */

const { MODEL_PRICING } = require('../config/model-pricing.js');

class TokenTracker {
  /**
   * Create a new TokenTracker
   * @param {Object} options - Configuration options
   * @param {string} [options.sessionId] - Session identifier for tracking
   * @param {Object} [options.pricing] - Token pricing per provider (cost per token)
   */
  constructor(options = {}) {
    this.sessionId = options.sessionId || null;
    // Use centralized pricing from config/model-pricing.js
    // Can be overridden for testing or custom pricing scenarios
    this.pricing = options.pricing || MODEL_PRICING;

    this.records = [];
    this.startTime = Date.now();
    this.endTime = null;
  }

  /**
   * Record token usage for a provider operation
   * @param {Object} usage - Usage record
   * @param {string} usage.provider - Provider type: 'llm', 'vision', 'critique'
   * @param {string} usage.operation - Operation type: 'expand', 'refine', 'analyze', etc.
   * @param {number} usage.tokens - Number of tokens consumed
   * @param {Object} [usage.metadata] - Additional metadata (iteration, candidateId, etc.)
   */
  recordUsage(usage) {
    const record = {
      provider: usage.provider,
      operation: usage.operation,
      tokens: usage.tokens,
      metadata: usage.metadata || {},
      timestamp: Date.now()
    };

    this.records.push(record);
    this.endTime = record.timestamp;
  }

  /**
   * Get all usage records
   * @returns {Array} Array of usage records
   */
  getRecords() {
    return [...this.records];
  }

  /**
   * Get aggregated token statistics
   * @returns {Object} Token statistics
   */
  getStats() {
    const stats = {
      totalTokens: 0,
      llmTokens: 0,
      visionTokens: 0,
      critiqueTokens: 0,
      byOperation: {},
      byIteration: {}
    };

    for (const record of this.records) {
      // Aggregate total
      stats.totalTokens += record.tokens;

      // Aggregate by provider
      if (record.provider === 'llm') {
        stats.llmTokens += record.tokens;
      } else if (record.provider === 'vision') {
        stats.visionTokens += record.tokens;
      } else if (record.provider === 'critique') {
        stats.critiqueTokens += record.tokens;
      }

      // Aggregate by operation
      if (record.operation) {
        stats.byOperation[record.operation] = (stats.byOperation[record.operation] || 0) + record.tokens;
      }

      // Aggregate by iteration
      if (record.metadata && record.metadata.iteration !== undefined) {
        const iter = record.metadata.iteration;
        stats.byIteration[iter] = (stats.byIteration[iter] || 0) + record.tokens;
      }
    }

    return stats;
  }

  /**
   * Get efficiency metrics
   * @returns {Object} Efficiency metrics
   */
  getEfficiencyMetrics() {
    const stats = this.getStats();
    const metrics = {
      avgTokensPerCandidate: 0,
      providerPercentages: {
        llm: 0,
        vision: 0,
        critique: 0
      },
      mostExpensiveOperation: null,
      mostExpensiveOperationTokens: 0
    };

    // Calculate average tokens per candidate
    const candidateIds = new Set();
    for (const record of this.records) {
      if (record.metadata && record.metadata.candidateId !== undefined) {
        candidateIds.add(record.metadata.candidateId);
      }
    }

    if (candidateIds.size > 0) {
      metrics.avgTokensPerCandidate = stats.totalTokens / candidateIds.size;
    }

    // Calculate provider percentages
    if (stats.totalTokens > 0) {
      metrics.providerPercentages.llm = (stats.llmTokens / stats.totalTokens) * 100;
      metrics.providerPercentages.vision = (stats.visionTokens / stats.totalTokens) * 100;
      metrics.providerPercentages.critique = (stats.critiqueTokens / stats.totalTokens) * 100;
    }

    // Find most expensive operation
    for (const [operation, tokens] of Object.entries(stats.byOperation)) {
      if (tokens > metrics.mostExpensiveOperationTokens) {
        metrics.mostExpensiveOperation = operation;
        metrics.mostExpensiveOperationTokens = tokens;
      }
    }

    return metrics;
  }

  /**
   * Get estimated cost based on token usage and pricing
   * @returns {Object} Cost breakdown by provider
   */
  getEstimatedCost() {
    const stats = this.getStats();

    return {
      total: stats.llmTokens * this.pricing.llm +
             stats.visionTokens * this.pricing.vision +
             stats.critiqueTokens * this.pricing.critique,
      llm: stats.llmTokens * this.pricing.llm,
      vision: stats.visionTokens * this.pricing.vision,
      critique: stats.critiqueTokens * this.pricing.critique
    };
  }

  /**
   * Get summary of token usage
   * @returns {Object} Summary object
   */
  getSummary() {
    const stats = this.getStats();

    return {
      sessionId: this.sessionId,
      totalTokens: stats.totalTokens,
      totalRecords: this.records.length,
      startTime: this.startTime,
      endTime: this.endTime || Date.now()
    };
  }

  /**
   * Format summary as readable string
   * @returns {string} Formatted summary
   */
  formatSummary() {
    const stats = this.getStats();
    const cost = this.getEstimatedCost();
    const duration = ((this.endTime || Date.now()) - this.startTime) / 1000;

    const lines = [];
    lines.push('═'.repeat(60));
    lines.push('📊 Token Usage Summary');
    lines.push('═'.repeat(60));

    if (this.sessionId) {
      lines.push(`Session: ${this.sessionId}`);
    }

    lines.push('');
    lines.push(`Total Tokens: ${stats.totalTokens.toLocaleString()}`);
    lines.push(`  • LLM: ${stats.llmTokens.toLocaleString()}`);
    lines.push(`  • Vision: ${stats.visionTokens.toLocaleString()}`);
    lines.push(`  • Critique: ${stats.critiqueTokens.toLocaleString()}`);

    lines.push('');
    lines.push(`Estimated Cost: $${cost.total.toFixed(4)}`);
    lines.push(`  • LLM: $${cost.llm.toFixed(4)}`);
    lines.push(`  • Vision: $${cost.vision.toFixed(4)}`);
    lines.push(`  • Critique: $${cost.critique.toFixed(4)}`);

    lines.push('');
    lines.push(`Duration: ${duration.toFixed(1)}s`);
    lines.push(`Records: ${this.records.length}`);

    lines.push('═'.repeat(60));

    return lines.join('\n');
  }

  /**
   * Export to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      pricing: this.pricing,
      records: this.records,
      startTime: this.startTime,
      endTime: this.endTime,
      totalTokens: this.getStats().totalTokens
    };
  }

  /**
   * Create TokenTracker from JSON data
   * @param {Object} data - JSON data
   * @returns {TokenTracker} New TokenTracker instance
   * @static
   */
  static fromJSON(data) {
    const tracker = new TokenTracker({
      sessionId: data.sessionId,
      pricing: data.pricing
    });

    tracker.records = data.records || [];
    tracker.startTime = data.startTime;
    tracker.endTime = data.endTime;

    return tracker;
  }

  /**
   * Get model optimization suggestions
   * Suggests cheaper models for operations where they'd be suitable
   * @returns {Array} Array of optimization suggestions
   */
  getOptimizationSuggestions() {
    // Define model recommendation rules (December 2025 - GPT-5 era)
    const recommendations = {
      // LLM operations - use GPT-5 nano/mini for cost efficiency
      expand: { suggested: 'gpt-5-nano', reason: 'Expansion is a simpler task - gpt-5-nano provides excellent quality at lowest cost ($0.05/1M tokens)' },
      refine: { suggested: 'gpt-5-mini', reason: 'Refinement benefits from gpt-5-mini\'s capabilities at $0.25/1M tokens (10x cheaper than gpt-4o)' },
      combine: { suggested: 'gpt-5-nano', reason: 'Combining prompts is straightforward - gpt-5-nano is 50x cheaper than gpt-4o with great results' },

      // Vision operations - gpt-4o-mini still best value for vision
      analyze: { suggested: 'gpt-4o-mini', reason: 'Vision analysis works excellently with gpt-4o-mini at $0.15/1M tokens (17x cheaper than gpt-4o)' },

      // Critique generation
      generate: { suggested: 'gpt-5-mini', reason: 'Critique generation benefits from gpt-5-mini\'s improved reasoning at excellent value' }
    };

    // Group records by operation and model
    const operationStats = {};

    for (const record of this.records) {
      const operationKey = `${record.operation}-${record.metadata?.model || 'unknown'}`;

      if (!operationStats[operationKey]) {
        operationStats[operationKey] = {
          operation: record.operation,
          currentModel: record.metadata?.model || 'unknown',
          totalTokens: 0,
          records: []
        };
      }

      operationStats[operationKey].totalTokens += record.tokens;
      operationStats[operationKey].records.push(record);
    }

    // Generate suggestions
    const suggestions = [];

    for (const [, stats] of Object.entries(operationStats)) {
      const recommendation = recommendations[stats.operation];

      if (!recommendation) continue;

      const currentModel = stats.currentModel;
      const suggestedModel = recommendation.suggested;

      // Check if we have pricing for both models
      const currentPricing = this.pricing[currentModel];
      const suggestedPricing = this.pricing[suggestedModel];

      if (!currentPricing || !suggestedPricing) continue;

      // Extract input price (for estimation purposes, assume mostly input tokens)
      const currentPrice = typeof currentPricing === 'object' ? currentPricing.input : currentPricing;
      const suggestedPrice = typeof suggestedPricing === 'object' ? suggestedPricing.input : suggestedPricing;

      // Calculate potential savings (using input token pricing as baseline)
      const currentCost = stats.totalTokens * currentPrice;
      const suggestedCost = stats.totalTokens * suggestedPrice;
      const potentialSavings = currentCost - suggestedCost;

      // Only suggest if there are actual savings
      if (potentialSavings > 0.0001) { // Minimum threshold to avoid tiny suggestions
        suggestions.push({
          operation: stats.operation,
          currentModel,
          suggestedModel,
          tokens: stats.totalTokens,
          currentCost,
          suggestedCost,
          potentialSavings,
          savingsPercentage: (potentialSavings / currentCost) * 100,
          reason: recommendation.reason
        });
      }
    }

    // Sort by potential savings (highest first)
    suggestions.sort((a, b) => b.potentialSavings - a.potentialSavings);

    return suggestions;
  }

  /**
   * Get optimization summary with total savings estimate
   * @returns {Object} Optimization summary
   */
  getOptimizationSummary() {
    const suggestions = this.getOptimizationSuggestions();

    // Calculate totals
    let currentCost = 0;
    let optimizedCost = 0;

    for (const suggestion of suggestions) {
      currentCost += suggestion.currentCost;
      optimizedCost += suggestion.suggestedCost;
    }

    // Add costs from operations without suggestions
    const operationsWithSuggestions = new Set(suggestions.map(s => s.operation));

    for (const record of this.records) {
      if (!operationsWithSuggestions.has(record.operation)) {
        const price = this.pricing[record.metadata?.model] || this.pricing.llm || 0;
        const cost = record.tokens * price;
        currentCost += cost;
        optimizedCost += cost; // No optimization for these
      }
    }

    const totalSavings = currentCost - optimizedCost;
    const savingsPercentage = currentCost > 0 ? (totalSavings / currentCost) * 100 : 0;

    return {
      currentCost,
      optimizedCost,
      totalSavings,
      savingsPercentage,
      suggestions
    };
  }

  /**
   * Format optimization report as readable string
   * @returns {string} Formatted optimization report
   */
  formatOptimizationReport() {
    const optimization = this.getOptimizationSummary();

    if (optimization.suggestions.length === 0) {
      return '\n💡 No optimization suggestions - already using efficient models!\n';
    }

    const lines = [];
    lines.push('\n' + '═'.repeat(60));
    lines.push('💡 Model Optimization Suggestions');
    lines.push('═'.repeat(60));

    lines.push('');
    lines.push(`Current Cost: $${optimization.currentCost.toFixed(4)}`);
    lines.push(`Optimized Cost: $${optimization.optimizedCost.toFixed(4)}`);
    lines.push(`Potential Savings: $${optimization.totalSavings.toFixed(4)} (${optimization.savingsPercentage.toFixed(1)}%)`);

    lines.push('');
    lines.push('Recommendations:');
    lines.push('─'.repeat(60));

    for (const suggestion of optimization.suggestions) {
      lines.push('');
      lines.push(`Operation: ${suggestion.operation}`);
      lines.push(`  Current: ${suggestion.currentModel} → Suggested: ${suggestion.suggestedModel}`);
      lines.push(`  Tokens: ${suggestion.tokens.toLocaleString()}`);
      lines.push(`  Savings: $${suggestion.potentialSavings.toFixed(4)} (${suggestion.savingsPercentage.toFixed(1)}%)`);
      lines.push(`  Reason: ${suggestion.reason}`);
    }

    lines.push('');
    lines.push('═'.repeat(60));

    return lines.join('\n');
  }
}

module.exports = TokenTracker;
