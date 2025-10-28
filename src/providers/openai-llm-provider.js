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
   * @param {string} options.operation - 'expand' (initial) or 'refine' (iterative)
   * @param {string} options.critique - Feedback for refine operation (required for 'refine')
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
      operation = 'expand',
      critique,
      temperature = 0.7,
      maxTokens = 500
    } = options;

    // Validate dimension
    if (dimension !== 'what' && dimension !== 'how') {
      throw new Error('Dimension must be either "what" or "how"');
    }

    // Validate operation
    if (operation !== 'expand' && operation !== 'refine') {
      throw new Error('Operation must be either "expand" or "refine"');
    }

    // Validate critique for refine operation
    if (operation === 'refine' && (!critique || typeof critique !== 'string' || critique.trim() === '')) {
      throw new Error('Critique is required for refine operation');
    }

    // Validate temperature
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
      throw new Error('Temperature out of range: must be between 0.0 and 1.0');
    }

    // Build system prompt based on dimension and operation
    const systemPrompt = this._buildSystemPrompt(dimension, operation);

    // Build user message based on operation
    const userMessage = operation === 'expand'
      ? prompt
      : `Current prompt: ${prompt}\n\nCritique: ${critique}\n\nRefined prompt:`;

    try {
      // Call OpenAI API
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature,
        max_tokens: maxTokens
      });

      const refinedPrompt = completion.choices[0].message.content.trim();

      return {
        refinedPrompt,
        explanation: `${operation === 'expand' ? 'Expanded' : 'Refined'} prompt for ${dimension} dimension using ${this.model}`,
        metadata: {
          model: completion.model,
          dimension,
          operation,
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
   * Build system prompt based on refinement dimension and operation
   * @private
   */
  _buildSystemPrompt(dimension, operation = 'expand') {
    if (operation === 'expand') {
      // Initial expansion from terse to detailed
      if (dimension === 'what') {
        return `You are an expert at expanding image generation prompts with rich CONTENT details.

Your task: Take a terse prompt and expand it into a detailed description of WHAT is in the scene.

Focus on:
- Subjects and characters (who/what)
- Objects and elements (physical things)
- Actions and activities (what's happening)
- Setting and environment (where)
- Mood and atmosphere (emotional content)

Use immersive, sensory-rich prose. Preserve the original intent while adding vivid detail.

Output ONLY the expanded prompt, no preamble or commentary.`;
      } else {
        return `You are an expert at expanding image generation prompts with rich STYLE details.

Your task: Take a terse prompt and expand it into a detailed description of HOW the image should look.

Focus on:
- Lighting (direction, quality, color temperature)
- Composition (framing, perspective, rule of thirds)
- Atmosphere (mood, depth, weather effects)
- Artistic style (photography, painting, digital art)
- Color palette and saturation
- Visual techniques (bokeh, HDR, long exposure)

Use concrete, descriptive language referencing photographic or cinematic techniques.

Output ONLY the expanded prompt, no preamble or commentary.`;
      }
    } else {
      // Iterative refinement based on critique
      if (dimension === 'what') {
        return `You are an expert at refining image generation prompts based on feedback about CONTENT.

Your task: Given a current prompt and a critique about its content, produce an improved version that addresses the feedback.

The critique may suggest:
- Missing or unclear content elements
- Subjects that need better description
- Actions or settings that need clarification
- Elements to emphasize or de-emphasize

Focus on content (WHAT) not style (HOW). Make targeted improvements based on the specific critique.

Output ONLY the refined prompt, no preamble or commentary.`;
      } else {
        return `You are an expert at refining image generation prompts based on feedback about STYLE.

Your task: Given a current prompt and a critique about its visual style, produce an improved version that addresses the feedback.

The critique may suggest:
- Lighting or composition adjustments
- Changes to artistic style or techniques
- Color palette modifications
- Atmosphere or mood enhancements

Focus on style (HOW) not content (WHAT). Make targeted improvements based on the specific critique.

Output ONLY the refined prompt, no preamble or commentary.`;
      }
    }
  }
}

module.exports = OpenAILLMProvider;
