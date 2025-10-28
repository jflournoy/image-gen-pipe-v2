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
   * Combine WHAT and HOW prompts into a unified prompt for image generation
   * @param {string} whatPrompt - Content description (what is in the image)
   * @param {string} howPrompt - Style description (how it looks)
   * @returns {Promise<string>} Combined prompt suitable for image generation
   */
  async combinePrompts(whatPrompt, howPrompt) {
    // Validate whatPrompt
    if (whatPrompt === null || whatPrompt === undefined) {
      throw new Error('whatPrompt is required and cannot be null or undefined');
    }
    if (typeof whatPrompt !== 'string' || whatPrompt.trim() === '') {
      throw new Error('whatPrompt is required and cannot be empty');
    }

    // Validate howPrompt
    if (howPrompt === null || howPrompt === undefined) {
      throw new Error('howPrompt is required and cannot be null or undefined');
    }
    if (typeof howPrompt !== 'string' || howPrompt.trim() === '') {
      throw new Error('howPrompt is required and cannot be empty');
    }

    const systemPrompt = `You are an image prompt combiner. Given a WHAT prompt (describing content) and a HOW prompt (describing visual style), combine them into a single, unified prompt that captures both the content and the style.

Do not lose any important details from either prompt. Maintain a richly detailed and concise prompt that fully captures both prompts' meaning and intent.

Output only the combined prompt, with no preamble, explanations, or commentary.`;

    const userPrompt = `WHAT prompt: ${whatPrompt}

HOW prompt: ${howPrompt}

Combined prompt:`;

    try {
      // Call OpenAI API with lower temperature for more consistent combination
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5, // Lower temperature for more deterministic combination
        max_tokens: 500
      });

      const combinedPrompt = completion.choices[0].message.content.trim();

      return combinedPrompt;
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
