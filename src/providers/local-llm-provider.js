/**
 * @file Local LLM Provider
 * Implements LLM operations using local Python-based LLM service (OpenAI-compatible)
 * Supports dimension-aware prompt refinement and intelligent combination
 */

const axios = require('axios');

// Retry configuration for service recovery
const MAX_RETRIES = parseInt(process.env.LLM_MAX_RETRIES || '3', 10);
const INITIAL_RETRY_DELAY_MS = parseInt(process.env.LLM_INITIAL_RETRY_DELAY_MS || '2000', 10);
const MAX_RETRY_DELAY_MS = parseInt(process.env.LLM_MAX_RETRY_DELAY_MS || '30000', 10);

/**
 * Local LLM Provider
 * Uses local Python LLM service for prompt expansion, refinement, and combination
 * Compatible with any OpenAI-compatible API endpoint
 */
class LocalLLMProvider {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - Base URL of the local LLM service
   * @param {string} options.model - Model identifier
   * @param {Function} options.serviceRestarter - Service restart callback (dependency injection)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8003';
    this.model = options.model || 'mistralai/Mistral-7B-Instruct-v0.2';
    // Service restart callback (can be injected for dependency injection)
    this._serviceRestarter = options.serviceRestarter || null;
    // Retry configuration
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.initialRetryDelay = options.initialRetryDelay ?? INITIAL_RETRY_DELAY_MS;
    this.maxRetryDelay = options.maxRetryDelay ?? MAX_RETRY_DELAY_MS;
  }

  /**
   * Set service restarter callback (dependency injection)
   * @param {Function} restarter - Async function() => { success, error? }
   */
  setServiceRestarter(restarter) {
    this._serviceRestarter = restarter;
  }

  /**
   * Retry an operation with exponential backoff and optional service restart
   * @param {Function} operation - Async function to retry
   * @param {Object} options - Retry options
   * @param {string} options.operationName - Name for logging
   * @param {boolean} options.attemptRestart - Whether to attempt service restart on failure
   * @returns {Promise<*>} Result of the operation
   * @private
   */
  async _retryWithBackoff(operation, options = {}) {
    const { operationName = 'LLM operation', attemptRestart = true } = options;
    let lastError;
    let delay = this.initialRetryDelay;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if this is a connection error
        const isConnectionError =
          error.code === 'ECONNREFUSED' ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('Cannot reach local LLM service');

        if (!isConnectionError) {
          // Non-connection error - fail immediately
          throw error;
        }

        // Connection error - attempt restart and retry
        if (attempt < this.maxRetries) {
          console.warn(
            `[LocalLLMProvider] ${operationName} failed (attempt ${attempt + 1}/${this.maxRetries + 1}): ${error.message}`
          );

          // Attempt service restart on first failure
          if (attempt === 0 && attemptRestart && this._serviceRestarter) {
            console.log(`[LocalLLMProvider] Attempting to restart LLM service...`);
            try {
              const restartResult = await this._serviceRestarter();
              if (restartResult.success) {
                console.log(`[LocalLLMProvider] Service restart successful`);
                // Wait a bit for service to stabilize before retrying
                await new Promise(resolve => setTimeout(resolve, 2000));
              } else {
                console.warn(`[LocalLLMProvider] Service restart failed: ${restartResult.error || 'unknown error'}`);
              }
            } catch (restartError) {
              console.warn(`[LocalLLMProvider] Service restart threw error: ${restartError.message}`);
            }
          }

          // Wait before retry with exponential backoff
          console.log(`[LocalLLMProvider] Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, this.maxRetryDelay);
        } else {
          // Final attempt failed
          console.error(`[LocalLLMProvider] ${operationName} failed after ${this.maxRetries + 1} attempts`);
          throw new Error(`LLM service unavailable after ${this.maxRetries + 1} attempts: ${lastError.message}`);
        }
      }
    }

    throw lastError;
  }

  /**
   * Refine a prompt with dimension awareness (what/how)
   * @param {string} prompt - Original prompt to refine
   * @param {Object} options - Refinement options
   * @param {string} options.dimension - 'what' (content) or 'how' (style)
   * @param {Object} options.previousResult - Previous generation result for critique-based refinement (test interface)
   * @param {Object} options.critique - Structured critique from CritiqueGenerator (pipeline interface)
   * @param {string} options.userPrompt - Original user request (for alignment)
   * @returns {Promise<Object>} Object with refinedPrompt and metadata
   */
  async refinePrompt(prompt, options = {}) {
    try {
      const dimension = options.dimension || 'what';
      let systemPrompt;
      let userPromptText;

      if (options.critique) {
        // Pipeline interface: structured critique from CritiqueGenerator
        const { critique, recommendation, reason } = options.critique;
        const originalUserPrompt = options.userPrompt || prompt;

        systemPrompt = dimension === 'what' ?
          'You are an SDXL prompt refiner focused on CONTENT (WHAT). Based on the critique and recommendation, improve the prompt to better match user intent while maintaining alignment with the original request.' :
          'You are an SDXL prompt refiner focused on VISUAL STYLE (HOW). Based on the critique and recommendation, improve the prompt to enhance aesthetic quality and visual appeal.';

        userPromptText = `Original user request: "${originalUserPrompt}"
Current ${dimension.toUpperCase()} prompt: "${prompt}"

Critique: ${critique}
Recommendation: ${recommendation}
Reason: ${reason}

Provide an improved ${dimension.toUpperCase()} prompt that addresses the critique while staying aligned with the original user request.`;
      } else if (options.previousResult) {
        // Test interface: previousResult with scores
        const { prompt: prevPrompt, clipScore, aestheticScore, caption } = options.previousResult;
        const focusMetric = dimension === 'what' ?
          `CLIP score: ${clipScore}` :
          `Aesthetic score: ${aestheticScore}`;

        systemPrompt = dimension === 'what' ?
          'You are an SDXL prompt refiner focused on CONTENT (WHAT). Based on critique, improve the prompt to better match user intent and boost CLIP score.' :
          'You are an SDXL prompt refiner focused on VISUAL STYLE (HOW). Based on critique, improve the prompt to enhance aesthetic quality and visual appeal.';

        userPromptText = `Original prompt: "${prompt}"
Previous result: "${prevPrompt}"
Image caption: "${caption}"
Current ${focusMetric}

Provide an improved prompt focusing on ${dimension === 'what' ? 'content alignment' : 'visual style'}.`;
      } else {
        // Dimension-aware expansion/refinement
        if (dimension === 'what') {
          systemPrompt = 'You are an SDXL prompt expander for CONTENT (WHAT). Write a concise description (2-4 sentences) that vividly describes WHAT is in the scene: characters, objects, actions, setting, and mood. Use immersive, sensory-rich prose.';
          userPromptText = `Expand this prompt focusing on CONTENT: "${prompt}"`;
        } else {
          systemPrompt = 'You are an SDXL prompt expander for VISUAL STYLE (HOW). Write a concise description (2-4 sentences) that vividly describes HOW the image appears: lighting, composition, color palette, texture, and atmosphere. Use concrete, descriptive language referencing photographic or cinematic techniques.';
          userPromptText = `Expand this prompt focusing on STYLE: "${prompt}"`;
        }
      }

      const fullPrompt = `${systemPrompt}\n\n${userPromptText}`;

      const { text, usage } = await this._generate(fullPrompt, options);
      const refinedPrompt = text.trim();

      // Return object matching OpenAI provider interface
      return {
        refinedPrompt,
        metadata: {
          model: this.model,
          tokensUsed: usage?.total_tokens || 0,
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0
        }
      };
    } catch (error) {
      throw new Error(`Failed to refine prompt: ${error.message}`);
    }
  }

  /**
   * Combine WHAT and HOW prompts intelligently
   * @param {string} whatPrompt - Content description
   * @param {string} howPrompt - Style description
   * @returns {Promise<Object>} Object with combinedPrompt and metadata
   */
  async combinePrompts(whatPrompt, howPrompt, options = {}) {
    try {
      // Get descriptiveness level (1=concise, 2=balanced, 3=descriptive)
      const descriptiveness = options.descriptiveness || 2;

      // Build system prompt based on descriptiveness level
      let systemPrompt;
      if (descriptiveness === 1) {
        // Concise: minimal instructions
        systemPrompt = 'You are an SDXL prompt combiner. Merge the WHAT (content) and HOW (style) prompts into a single SDXL prompt.';
      } else if (descriptiveness === 3) {
        // Descriptive: extensive guidelines
        systemPrompt = 'You are an SDXL prompt combiner. Given a WHAT prompt (describing content) and a HOW prompt (describing visual style), combine them into a comprehensive, richly detailed SDXL prompt that captures all elements from both. Preserve every important detail from both prompts. Use comma-separated style descriptors. Maximize quality and specificity while maintaining coherence.';
      } else {
        // Balanced (default): current balanced instructions
        systemPrompt = 'You are an SDXL prompt combiner. Given a WHAT prompt (describing content) and a HOW prompt (describing visual style), combine them into a single, comma-separated SDXL prompt that captures both the content and the style. Do not lose any important details from either prompt. Maintain a richly detailed and concise prompt.';
      }

      const userPrompt = `WHAT prompt: ${whatPrompt || '(none)'}
HOW prompt: ${howPrompt || '(none)'}

Combined SDXL prompt:`;

      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      const { text, usage } = await this._generate(fullPrompt);
      const combinedPrompt = text.trim();

      // Return object matching OpenAI provider interface
      return {
        combinedPrompt,
        metadata: {
          model: this.model,
          tokensUsed: usage?.total_tokens || 0,
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0
        }
      };
    } catch (error) {
      throw new Error(`Failed to combine prompts: ${error.message}`);
    }
  }

  /**
   * Generate text from a prompt (general-purpose)
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<string>} Generated text
   */
  async generateText(prompt, options = {}) {
    try {
      const { text } = await this._generate(prompt, options);
      return text.trim();
    } catch (error) {
      throw new Error(`Failed to generate text: ${error.message}`);
    }
  }

  /**
   * Internal method to call local LLM API (OpenAI-compatible)
   * @private
   * @returns {Promise<{text: string, usage: Object}>} Text and usage metadata
   */
  async _generate(prompt, options = {}) {
    return this._retryWithBackoff(
      async () => {
        try {
          const payload = {
            model: this.model,
            prompt: prompt,
            max_tokens: options.max_tokens || 500,
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            stream: false
          };

          const response = await axios.post(
            `${this.apiUrl}/v1/completions`,
            payload,
            {
              // 3 minute timeout: local LLM processes requests sequentially on single GPU,
              // so with 4 parallel beam search candidates, later requests may wait 60-90+ seconds
              timeout: 180000,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );

          // Extract text and usage from OpenAI-compatible response
          const text = response.data.choices[0]?.text || '';
          const usage = response.data.usage || {};

          return { text, usage };
        } catch (error) {
          if (error.response) {
            throw new Error(
              `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
            );
          } else if (error.request) {
            throw new Error(
              `Cannot reach local LLM service at ${this.apiUrl}. Is it running?`
            );
          } else {
            throw error;
          }
        }
      },
      {
        operationName: 'LLM generation',
        attemptRestart: true
      }
    );
  }

  /**
   * Check health status of the local LLM service
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.apiUrl}/health`, {
        timeout: 5000
      });

      if (response.status !== 200) {
        throw new Error('Service unavailable');
      }

      return {
        status: 'healthy',
        // LLM service returns model_repo and model_file, not model
        model: response.data.model_repo || response.data.model,
        model_file: response.data.model_file,
        model_loaded: response.data.model_loaded,
        device: response.data.device,
        gpu_layers: response.data.gpu_layers
      };
    } catch (error) {
      throw new Error(`Service unavailable: ${error.message}`);
    }
  }
}

module.exports = LocalLLMProvider;
