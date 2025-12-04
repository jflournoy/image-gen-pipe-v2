/**
 * TDD GREEN Phase: OpenAI LLM Provider
 *
 * Real OpenAI API implementation for prompt refinement.
 * Uses cost-optimized models from provider-config.js by default.
 */

const OpenAI = require('openai');
const providerConfig = require('../config/provider-config.js');

class OpenAILLMProvider {
  constructor(apiKey, options = {}) {
    // Validate API key
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('API key is required');
    }

    this.name = 'openai-llm-provider';
    this.apiKey = apiKey;

    // Configuration options - defaults from provider-config.js
    this.model = options.model || providerConfig.llm.model;

    // Operation-specific models for cost optimization
    // Falls back to single model if not specified
    this.models = options.models || {
      expand: options.model || providerConfig.llm.models.expand,
      refine: options.model || providerConfig.llm.models.refine,
      combine: options.model || providerConfig.llm.models.combine
    };

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

    // Validate and format critique for refine operation
    if (operation === 'refine') {
      if (!critique) {
        throw new Error('Critique is required for refine operation');
      }

      // Accept either string or structured critique object
      if (typeof critique === 'string' && critique.trim() === '') {
        throw new Error('Critique is required for refine operation');
      }
      if (typeof critique === 'object' && (!critique.critique || !critique.recommendation)) {
        throw new Error('Structured critique must have critique and recommendation fields');
      }
    }

    // Validate temperature
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
      throw new Error('Temperature out of range: must be between 0.0 and 1.0');
    }

    // Build system prompt based on dimension and operation
    const systemPrompt = this._buildSystemPrompt(dimension, operation);

    // Build user message based on operation
    let userMessage;
    if (operation === 'expand') {
      userMessage = prompt;
    } else {
      // Handle both string and structured critique
      if (typeof critique === 'string') {
        userMessage = `Current prompt: ${prompt}\n\nCritique: ${critique}\n\nRefined prompt:`;
      } else {
        // Structured critique object
        userMessage = `Current ${dimension.toUpperCase()} prompt: ${prompt}

Critique: ${critique.critique}
Recommendation: ${critique.recommendation}
Reason: ${critique.reason}

Please refine the ${dimension.toUpperCase()} prompt based on the above feedback. Output only the refined prompt, no explanation.`;
      }
    }

    // Select model based on operation for cost optimization
    const selectedModel = this.models[operation] || this.model;

    try {
      // Call OpenAI API
      const completion = await this.client.chat.completions.create({
        model: selectedModel,
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

Important guidelines:
- Do NOT lose any important details from either prompt
- Preserve ALL semantic content from both WHAT and HOW
- Create a natural, flowing description that integrates content and style seamlessly
- Maintain specificity - don't generalize or abstract the details
- Ensure the combined prompt would generate an image matching both inputs
- Keep the prompt richly detailed yet concise

Output only the combined prompt, with no preamble, explanations, or commentary.`;

    const userPrompt = `WHAT prompt: ${whatPrompt}

HOW prompt: ${howPrompt}

Combined prompt:`;

    // Select model for combine operation (simple task, use cost-efficient model)
    const selectedModel = this.models.combine || this.model;

    try {
      // Call OpenAI API with lower temperature for more consistent combination
      const completion = await this.client.chat.completions.create({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5, // Lower temperature for more deterministic combination
        max_tokens: 500
      });

      const combinedPrompt = completion.choices[0].message.content.trim();

      // Return object with metadata (consistent with refinePrompt)
      return {
        combinedPrompt,
        metadata: {
          model: completion.model,
          tokensUsed: completion.usage.total_tokens,
          timestamp: new Date().toISOString()
        }
      };
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

Important guidelines:
- Use immersive, sensory-rich prose
- Preserve the original intent while adding vivid detail
- When generating multiple expansions, introduce VARIETY in your interpretations
- Explore different aspects, angles, or moments that honor the core concept
- Be specific and concrete rather than generic

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

Important guidelines:
- Use concrete, descriptive language referencing photographic or cinematic techniques
- When generating multiple expansions, introduce VARIETY in your style choices
- Explore different lighting scenarios, compositions, or artistic approaches
- Be specific about technical choices rather than using vague terms
- Consider how style choices interact with and enhance the content

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

Important guidelines:
- DIRECTLY ADDRESS the specific issues raised in the critique
- Focus on content (WHAT) not style (HOW)
- Make measurable improvements that would increase alignment scores
- Preserve effective elements from the original prompt
- Be specific about what changed and why it addresses the critique

Output ONLY the refined prompt, no preamble or commentary.`;
      } else {
        return `You are an expert at refining image generation prompts based on feedback about STYLE.

Your task: Given a current prompt and a critique about its visual style, produce an improved version that addresses the feedback.

The critique may suggest:
- Lighting or composition adjustments
- Changes to artistic style or techniques
- Color palette modifications
- Atmosphere or mood enhancements

Important guidelines:
- DIRECTLY ADDRESS the specific issues raised in the critique
- Focus on style (HOW) not content (WHAT)
- Make measurable improvements that would increase aesthetic scores
- Preserve effective style elements from the original prompt
- Be specific about technical changes (e.g., "golden hour lighting" not just "better lighting")

Output ONLY the refined prompt, no preamble or commentary.`;
      }
    }
  }
}

module.exports = OpenAILLMProvider;
