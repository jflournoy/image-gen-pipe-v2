/**
 * @file Local LLM Provider
 * Implements LLM operations using local Python-based LLM service (OpenAI-compatible)
 * Supports dimension-aware prompt refinement and intelligent combination
 */

const axios = require('axios');

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
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8003';
    this.model = options.model || 'mistralai/Mistral-7B-Instruct-v0.2';
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
  async combinePrompts(whatPrompt, howPrompt) {
    try {
      const systemPrompt = 'You are an SDXL prompt combiner. Given a WHAT prompt (describing content) and a HOW prompt (describing visual style), combine them into a single, comma-separated SDXL prompt that captures both the content and the style. Do not lose any important details from either prompt. Maintain a richly detailed and concise prompt.';

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
