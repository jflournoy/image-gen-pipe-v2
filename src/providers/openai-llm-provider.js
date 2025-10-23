/**
 * TDD GREEN Phase: OpenAI LLM Provider
 *
 * Real OpenAI API implementation for prompt refinement.
 * Uses GPT-4 to expand prompts in WHAT (content) or HOW (style) dimensions.
 */

const OpenAI = require('openai');

class OpenAILLMProvider {
  constructor(apiKey, options = {}) {
    // Validate API key
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('API key is required');
    }

    this.name = 'openai-llm-provider';
    this.apiKey = apiKey;

    // Configuration options
    this.model = options.model || 'gpt-4';
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000;

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: this.apiKey,
      maxRetries: this.maxRetries,
      timeout: this.timeout
    });
  }

  /**
   * Refine a prompt using OpenAI's GPT model
   * @param {string} prompt - The original prompt to refine
   * @param {Object} options - Refinement options
   * @param {string} options.dimension - 'what' (content) or 'how' (style)
   * @param {number} options.temperature - Randomness (0.0-1.0)
   * @param {number} options.maxTokens - Maximum tokens to generate
   * @returns {Promise<Object>} Refined prompt with metadata
   */
  async refinePrompt(prompt, options = {}) {
    // Validate prompt
    if (prompt === null || prompt === undefined) {
      throw new Error('Prompt is required and cannot be null or undefined');
    }

    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('Prompt is required and cannot be empty');
    }

    // Validate and default options
    const {
      dimension = 'what',
      temperature = 0.7,
      maxTokens = 500
    } = options;

    // Validate dimension
    if (dimension !== 'what' && dimension !== 'how') {
      throw new Error('Dimension must be either "what" or "how"');
    }

    // Validate temperature
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
      throw new Error('Temperature out of range: must be between 0.0 and 1.0');
    }

    // Build system prompt based on dimension
    const systemPrompt = this._buildSystemPrompt(dimension);

    try {
      // Call OpenAI API
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: maxTokens
      });

      const refinedPrompt = completion.choices[0].message.content.trim();

      return {
        refinedPrompt,
        explanation: `Refined prompt for ${dimension} dimension using ${this.model}`,
        metadata: {
          model: completion.model,
          dimension,
          tokensUsed: completion.usage.total_tokens,
          temperature,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      // Wrap OpenAI errors with more context
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }

  /**
   * Build system prompt based on refinement dimension
   * @private
   */
  _buildSystemPrompt(dimension) {
    if (dimension === 'what') {
      return `You are an expert at refining image generation prompts by expanding CONTENT details.
Focus on: subjects, objects, actions, scenes, and specific elements.
Take the user's prompt and expand it with rich content details while preserving the original intent.
Return ONLY the refined prompt, no explanations or commentary.`;
    } else {
      return `You are an expert at refining image generation prompts by expanding STYLE details.
Focus on: lighting, composition, atmosphere, artistic style, color palette, and visual techniques.
Take the user's prompt and expand it with rich stylistic details while preserving the original intent.
Return ONLY the refined prompt, no explanations or commentary.`;
    }
  }
}

module.exports = OpenAILLMProvider;
