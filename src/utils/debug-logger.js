/**
 * 🟢 TDD GREEN Phase: Debug Logger Utility
 *
 * Provides debug logging for demos showing model names and token counts
 * at every step for better visibility and cost tracking.
 */

class DebugLogger {
  /**
   * Create a new DebugLogger
   * @param {Object} options - Configuration options
   * @param {boolean} [options.debug=false] - Enable debug output
   */
  constructor(options = {}) {
    this.debugEnabled = options.debug || false;
  }

  /**
   * Log a provider call with model and token information
   * @param {Object} call - Provider call information
   * @param {string} call.provider - Provider type (llm, vision, image)
   * @param {string} call.operation - Operation type (expand, refine, analyze, generate)
   * @param {Object} call.metadata - Metadata from provider response
   * @returns {string} Formatted debug string (empty if debug disabled)
   */
  logProviderCall(call) {
    if (!this.debugEnabled) {
      return '';
    }

    const { provider, operation, metadata = {} } = call;

    // Format model info
    const modelInfo = this.formatModelInfo(metadata);

    // Build debug string
    return `     🔧 [${provider}:${operation}] ${modelInfo}`;
  }

  /**
   * Format model name and token count in compact form
   * @param {Object} metadata - Metadata from provider response
   * @param {string} [metadata.model] - Model name
   * @param {number} [metadata.tokensUsed] - Token count
   * @returns {string} Formatted string: [model | tokens]
   */
  formatModelInfo(metadata = {}) {
    const { model, tokensUsed } = metadata;

    const parts = [];

    if (model) {
      parts.push(model);
    }

    if (tokensUsed !== undefined) {
      parts.push(`${tokensUsed} tokens`);
    }

    if (parts.length === 0) {
      return '[no model info]';
    }

    return `[${parts.join(' | ')}]`;
  }

  /**
   * Wrap a provider to add debug information to responses
   * @param {Object} provider - Provider instance to wrap
   * @param {string} providerType - Provider type (llm, vision, image)
   * @returns {Object} Wrapped provider
   */
  wrapProvider(provider, providerType) {
    const self = this;

    // Handle LLM provider
    if (providerType === 'llm') {
      return {
        refinePrompt: async (prompt, options) => {
          const result = await provider.refinePrompt(prompt, options);

          if (self.debugEnabled && result.metadata) {
            const debugInfo = self.logProviderCall({
              provider: 'llm',
              operation: options.operation || 'refine',
              metadata: result.metadata
            });
            result._debugInfo = debugInfo;
          }

          return result;
        },

        combinePrompts: async (whatPrompt, howPrompt) => {
          const result = await provider.combinePrompts(whatPrompt, howPrompt);

          if (self.debugEnabled && result.metadata) {
            const debugInfo = self.logProviderCall({
              provider: 'llm',
              operation: 'combine',
              metadata: result.metadata
            });
            result._debugInfo = debugInfo;
          }

          return result;
        }
      };
    }

    // Handle Vision provider
    if (providerType === 'vision') {
      return {
        analyzeImage: async (imageUrl, prompt) => {
          const result = await provider.analyzeImage(imageUrl, prompt);

          if (self.debugEnabled && result.metadata) {
            const debugInfo = self.logProviderCall({
              provider: 'vision',
              operation: 'analyze',
              metadata: result.metadata
            });
            result._debugInfo = debugInfo;
          }

          return result;
        }
      };
    }

    // Handle Image provider
    if (providerType === 'image') {
      return {
        generateImage: async (prompt, options) => {
          const result = await provider.generateImage(prompt, options);

          if (self.debugEnabled && result.metadata) {
            const debugInfo = self.logProviderCall({
              provider: 'image',
              operation: 'generate',
              metadata: result.metadata
            });
            result._debugInfo = debugInfo;
          }

          return result;
        }
      };
    }

    // Return unwrapped provider if type not recognized
    return provider;
  }
}

module.exports = DebugLogger;
