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
      maxTokens // Will use model-specific default if not provided
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

    // Get model capabilities and apply recommended token limit if not explicitly provided
    const capabilities = this._getModelCapabilities(selectedModel);
    const effectiveMaxTokens = maxTokens ?? capabilities.recommendedMaxTokens;

    try {
      // Build API parameters with correct token limit field based on model
      const apiParams = this._buildChatParams(
        selectedModel,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature,
        effectiveMaxTokens
      );

      // Call OpenAI API
      const completion = await this.client.chat.completions.create(apiParams);

      // Validate response structure
      if (!completion.choices || completion.choices.length === 0) {
        throw new Error(`OpenAI API returned no choices. Model: ${completion.model}, Finish reason: ${completion.choices?.[0]?.finish_reason || 'none'}`);
      }

      const message = completion.choices[0].message;
      if (!message || !message.content) {
        throw new Error(`OpenAI API returned empty content. Model: ${completion.model}, Finish reason: ${completion.choices[0].finish_reason}, Refusal: ${message?.refusal || 'none'}`);
      }

      const refinedPrompt = message.content.trim();

      // Validate that we got a non-empty response
      if (!refinedPrompt || refinedPrompt.length === 0) {
        throw new Error(`OpenAI API returned empty refined prompt after trimming. Model: ${completion.model}, Original content length: ${message.content.length}, Finish reason: ${completion.choices[0].finish_reason}`);
      }

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

    // Get model capabilities and use recommended token limit
    const capabilities = this._getModelCapabilities(selectedModel);

    try {
      // Build API parameters with correct token limit field based on model
      const apiParams = this._buildChatParams(
        selectedModel,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        0.5, // Lower temperature for more deterministic combination
        capabilities.recommendedMaxTokens
      );

      // Call OpenAI API
      const completion = await this.client.chat.completions.create(apiParams);

      // Validate response structure
      if (!completion.choices || completion.choices.length === 0) {
        throw new Error(`OpenAI API returned no choices for combine. Model: ${completion.model}, Finish reason: ${completion.choices?.[0]?.finish_reason || 'none'}`);
      }

      const message = completion.choices[0].message;
      if (!message || !message.content) {
        throw new Error(`OpenAI API returned empty content for combine. Model: ${completion.model}, Finish reason: ${completion.choices[0].finish_reason}, Refusal: ${message?.refusal || 'none'}`);
      }

      const combinedPrompt = message.content.trim();

      // Validate that we got a non-empty response
      if (!combinedPrompt || combinedPrompt.length === 0) {
        throw new Error(`OpenAI API returned empty combined prompt after trimming. Model: ${completion.model}, Original content length: ${message.content.length}, Finish reason: ${completion.choices[0].finish_reason}`);
      }

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
   * Get model capabilities from centralized registry
   *
   * This method returns a capabilities object that defines exactly which
   * parameters a model supports. This guarantees we never send invalid
   * parameters to the OpenAI API.
   *
   * Capabilities include:
   * - tokenParam: 'max_tokens' or 'max_completion_tokens'
   * - supportsCustomTemperature: true/false
   * - recommendedMaxTokens: Recommended token limit for this model
   *
   * @private
   * @param {string} model - Model name
   * @returns {Object} Model capabilities
   */
  _getModelCapabilities(model) {
    // GPT-5.1 family: max_completion_tokens, no custom temperature, much higher token limits
    // Note: GPT-5.1 models use reasoning_tokens internally, which count toward max_completion_tokens
    // They can use ALL tokens for reasoning, leaving zero for output. Need large buffer.
    if (model.includes('gpt-5.1')) {
      return {
        tokenParam: 'max_completion_tokens',
        supportsCustomTemperature: false,
        recommendedMaxTokens: 4000 // GPT-5.1 needs tokens for reasoning (can be 2000+) + output (500+)
      };
    }

    // GPT-5 family (non-5.1): max_completion_tokens, no custom temperature, much higher token limits
    // Note: GPT-5 models use reasoning_tokens internally, which count toward max_completion_tokens
    // They can use ALL tokens for reasoning, leaving zero for output. Need large buffer.
    if (model.includes('gpt-5')) {
      return {
        tokenParam: 'max_completion_tokens',
        supportsCustomTemperature: false,
        recommendedMaxTokens: 4000 // GPT-5 needs tokens for reasoning (can be 2000+) + output (500+)
      };
    }

    // o-series models (o1, o3, o4): max_completion_tokens, no custom temperature
    // Note: o-series models use reasoning_tokens internally, which count toward max_completion_tokens
    // They can use ALL tokens for reasoning, leaving zero for output. Need large buffer.
    if (model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
      return {
        tokenParam: 'max_completion_tokens',
        supportsCustomTemperature: false,
        recommendedMaxTokens: 4000 // o-series needs tokens for reasoning (can be 2000+) + output (500+)
      };
    }

    // Default: GPT-4, GPT-3.5, and older models
    // These support max_tokens and custom temperature
    return {
      tokenParam: 'max_tokens',
      supportsCustomTemperature: true,
      recommendedMaxTokens: 500 // Standard models work well with 500
    };
  }

  /**
   * Detect if a model uses max_completion_tokens instead of max_tokens
   *
   * OpenAI API models use different parameter names for token limits:
   * - GPT-5.1 family (gpt-5.1, gpt-5.1-mini, gpt-5.1-nano): max_completion_tokens
   * - GPT-5 family (gpt-5-mini, gpt-5-nano): max_completion_tokens
   * - o-series models (o1, o3, o4): max_completion_tokens
   * - GPT-4 family (gpt-4, gpt-4o, gpt-4-turbo): max_tokens
   * - GPT-3.5 family: max_tokens
   *
   * @private
   * @param {string} model - Model name
   * @returns {boolean} True if model uses max_completion_tokens
   */
  _usesCompletionTokens(model) {
    const capabilities = this._getModelCapabilities(model);
    return capabilities.tokenParam === 'max_completion_tokens';
  }

  /**
   * Detect if a model supports custom temperature parameter
   *
   * Some models (like GPT-5.1) only support the default temperature (1.0)
   * and will error if you pass a custom temperature value.
   *
   * @private
   * @param {string} model - Model name
   * @returns {boolean} True if model supports custom temperature
   */
  _supportsCustomTemperature(model) {
    const capabilities = this._getModelCapabilities(model);
    return capabilities.supportsCustomTemperature;
  }

  /**
   * Build chat completion parameters with correct token limit field
   *
   * This method uses the model capabilities registry to guarantee that
   * only valid parameters are included in the API request. This prevents
   * API errors from unsupported parameters.
   *
   * @private
   * @param {string} model - Model name
   * @param {Array} messages - Chat messages
   * @param {number} temperature - Temperature setting
   * @param {number} maxTokens - Maximum tokens to generate
   * @returns {Object} API parameters object with only valid parameters
   */
  _buildChatParams(model, messages, temperature, maxTokens) {
    // Get model capabilities to determine which parameters to use
    const capabilities = this._getModelCapabilities(model);

    // Start with base parameters that all models support
    const params = {
      model,
      messages
    };

    // Add temperature only if model supports custom temperature
    if (capabilities.supportsCustomTemperature) {
      params.temperature = temperature;
    }
    // Otherwise, omit temperature to use model's default (typically 1.0)

    // Add token limit using the correct parameter name for this model
    if (capabilities.tokenParam === 'max_completion_tokens') {
      params.max_completion_tokens = maxTokens;
    } else {
      params.max_tokens = maxTokens;
    }

    return params;
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
