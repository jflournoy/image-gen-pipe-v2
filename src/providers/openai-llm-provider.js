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

    this.maxRetries = options.maxRetries || providerConfig.llm.maxRetries;
    this.timeout = options.timeout || providerConfig.llm.timeout;

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: this.apiKey,
      maxRetries: this.maxRetries,
      timeout: this.timeout
    });

    // Log timeout configuration for debugging
    console.log(`[OpenAILLMProvider] Initialized: timeout=${this.timeout}ms, maxRetries=${this.maxRetries}`);
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
      userPrompt,
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

      // userPrompt helps maintain alignment with original user intent
      if (!userPrompt) {
        throw new Error('userPrompt is required for refine operation');
      }
    }

    // Validate temperature
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
      throw new Error('Temperature out of range: must be between 0.0 and 1.0');
    }

    // Build system prompt based on dimension, operation, and prompt style
    let systemPrompt = this._buildSystemPrompt(dimension, operation, options.promptStyle);

    // Build user message based on operation
    let userMessage;
    if (operation === 'expand') {
      userMessage = prompt;
    } else {
      // For refine operation, include original user prompt to maintain alignment
      // Handle both string and structured critique
      if (typeof critique === 'string') {
        userMessage = `Original User Request: "${userPrompt}"

Current prompt: ${prompt}

Critique: ${critique}

Refined prompt:`;
      } else {
        // Structured critique object
        userMessage = `Original User Request: "${userPrompt}"

Current ${dimension.toUpperCase()} prompt: ${prompt}

Critique: ${critique.critique}
Recommendation: ${critique.recommendation}
Reason: ${critique.reason}

Please refine the ${dimension.toUpperCase()} prompt based on the above feedback while maintaining alignment with the original user request. Output only the refined prompt, no explanation.`;
      }

      // Enhance system prompt for refine operation to include user intent guidance
      systemPrompt += `

${dimension === 'what' ? 'CRITICAL CONSTRAINT: Ensure refined WHAT prompt stays aligned with the original user request while addressing the critique feedback.' : 'CRITICAL CONSTRAINT: Ensure refined HOW prompt stays aligned with the original user request while addressing the critique feedback.'}`;
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
  async combinePrompts(whatPrompt, howPrompt, options = {}) {
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

    // Get descriptiveness level (1=concise, 2=balanced, 3=descriptive)
    const descriptiveness = options.descriptiveness || 2;
    const isBooru = options.promptStyle === 'booru';

    // Build system prompt based on descriptiveness level and prompt style
    let systemPrompt;
    if (isBooru) {
      // Hybrid booru mode: tags + natural language
      if (descriptiveness === 1) {
        systemPrompt = `You are a prompt combiner for booru-trained SDXL models. Merge WHAT and HOW into a single MINIMAL prompt. Use HYBRID format: booru tags for key attributes and quality, short natural language phrases for descriptions. Keep it concise - remove redundancies. Start with quality tags, then subject, then style. Output ONLY the combined prompt, no explanations.`;
      } else if (descriptiveness === 3) {
        systemPrompt = `You are a prompt combiner for booru-trained SDXL models. Merge WHAT and HOW into a COMPREHENSIVE prompt. Use HYBRID format: booru tags for categorical attributes (1girl, blue_eyes, masterpiece, best_quality, depth_of_field) combined with natural language descriptions for scenes, actions, and atmosphere. Include ALL relevant details from both dimensions. Be THOROUGH. Output ONLY the combined prompt, no explanations.`;
      } else {
        systemPrompt = `You are a prompt combiner for booru-trained SDXL models. Merge WHAT and HOW into a BALANCED prompt. Use HYBRID format: booru tags for categorical attributes and quality markers, natural language phrases for descriptions and atmosphere. Remove duplicates, preserve all meaningful content. Output ONLY the combined prompt, no explanations.`;
      }
    } else if (descriptiveness === 1) {
      // Concise: FORCE brevity and minimalism
      systemPrompt = `You are an image prompt combiner. Your output MUST be BRIEF and MINIMAL.

CRITICAL: Use CONCRETE VISUAL LANGUAGE. Describe what is literally visible.

Produce a SHORT, TERSE prompt by merging WHAT (content) and HOW (style). Strip unnecessary words. Describe physical appearances, not abstract concepts. Be direct and visual.

Output ONLY the combined prompt - NO explanations. Keep it SHORT.`;
    } else if (descriptiveness === 3) {
      // Descriptive: FORCE comprehensiveness and detail
      systemPrompt = `You are an image prompt combiner. Your output MUST be COMPREHENSIVE and RICHLY DETAILED.

CRITICAL: Use CONCRETE VISUAL LANGUAGE throughout. Describe what is literally visible in the image.

Create an EXTENSIVE, DETAILED prompt combining WHAT (content) and HOW (style):
- Describe physical appearances: shapes, colors, textures, materials, spatial relationships
- Describe subjects: posture, expression, clothing, positioning
- Describe environment: concrete spatial details, depth, scale
- Describe style: lighting direction and quality, color palette, composition, visual techniques
- Use specific visual descriptors rather than abstract concepts
- If conveying mood, ground it in visual choices (e.g., "warm golden light" not just "cozy")
- Avoid vague qualifiers like "beautiful," "amazing" - describe HOW things look
- Write a description that a viewer could verify against the actual image
- Make it LONG and DETAILED - comprehensive visual coverage is essential

Output only the combined prompt with NO preamble or commentary.`;
    } else {
      // Balanced (default): moderate detail with focus
      systemPrompt = `You are an image prompt combiner. Create a BALANCED prompt that is DETAILED yet FOCUSED.

CRITICAL: Use CONCRETE VISUAL LANGUAGE. Describe what is literally visible in the image.

Important guidelines:
- Combine WHAT (content) and HOW (style) into a unified description
- Describe physical appearances: shapes, colors, textures, spatial relationships
- Use specific visual descriptors rather than abstract concepts
- If conveying mood, ground it in visual choices (e.g., "warm golden light" not just "cozy feeling")
- Avoid vague qualifiers like "beautiful," "amazing" - describe HOW things look
- Preserve ALL meaningful details from both dimensions
- Write a description that a viewer could verify against the actual image

Output only the combined prompt with NO preamble or commentary.`;
    }

    const userPrompt = isBooru
      ? `WHAT tags: ${whatPrompt}

HOW tags: ${howPrompt}

Combined booru tags:`
      : `WHAT prompt: ${whatPrompt}

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
        recommendedMaxTokens: 8000 // GPT-5 needs tokens for reasoning (can be 2000-6000+) + output (500+)
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
  _buildSystemPrompt(dimension, operation = 'expand', promptStyle = 'natural') {
    const isBooru = promptStyle === 'booru';

    if (operation === 'expand') {
      // Initial expansion from terse to detailed
      if (dimension === 'what') {
        if (isBooru) {
          return `You are an expert at generating prompts for booru-trained SDXL models describing CONTENT.

Your task: Take a terse prompt and generate a HYBRID prompt mixing booru tags with natural language.

Use booru tags for categorical attributes:
- Character count (1girl, 2boys, solo)
- Physical attributes (blue_eyes, long_hair, red_hair)
- Clothing tags (school_uniform, hat, glasses)

Use natural language for descriptions and actions:
- "standing in a sunlit meadow" not "standing, sunlit, meadow"
- "looking over her shoulder with a gentle smile" not "looking_back, smile"
- Scene descriptions and spatial relationships

Important guidelines:
- Start with character count tags, then mix attributes and descriptions naturally
- Be specific with booru attributes (long_hair, blue_eyes, not just "hair, eyes")
- When generating multiple expansions, vary the interpretations
- Output ONLY the prompt, no sentences of commentary or explanation.`;
        }
        return `You are an expert at expanding image generation prompts with rich CONTENT details.

Your task: Take a terse prompt and expand it into a detailed description of WHAT is in the scene.

CRITICAL: Use CONCRETE VISUAL LANGUAGE. Describe what is literally visible.

Focus on:
- Subjects and characters - their appearance, posture, expression, clothing
- Objects and elements - shape, color, texture, material, condition
- Actions and activities - visible motion, gestures, interactions
- Setting and environment - concrete spatial details
- Spatial relationships - where things are positioned relative to each other

Important guidelines:
- Describe physical appearances rather than abstract qualities
- If evoking mood, anchor it to specific visual elements (lighting, color, composition)
- Be specific about what things LOOK LIKE, not just what they ARE
- When generating multiple expansions, introduce VARIETY in your interpretations
- Explore different aspects, angles, or moments that honor the core concept

Output ONLY the expanded prompt, no preamble or commentary.`;
      } else {
        if (isBooru) {
          return `You are an expert at generating style prompts for booru-trained SDXL models.

Your task: Take a terse prompt and generate a HYBRID style prompt mixing booru tags with natural language.

Use booru tags for:
- Quality tags (masterpiece, best_quality, absurdres, highres)
- Technical terms (depth_of_field, bokeh, chromatic_aberration)
- Composition tags (wide_shot, close-up, from_above)

Use natural language for:
- Lighting descriptions ("warm golden hour lighting with long shadows")
- Atmosphere ("soft ethereal glow filtering through mist")
- Color palette descriptions ("rich warm tones with deep amber highlights")

Important guidelines:
- Always start with quality tags (masterpiece, best_quality)
- Mix technical booru tags with descriptive natural language naturally
- When generating multiple expansions, vary the style choices
- Output ONLY the prompt, no sentences of commentary or explanation.`;
        }
        return `You are an expert at expanding image generation prompts with rich STYLE details.

Your task: Take a terse prompt and expand it into a detailed description of HOW the image should look.

CRITICAL: Use CONCRETE VISUAL LANGUAGE. Describe the visual effects, not just name the techniques.

Focus on:
- Lighting (direction, quality, color temperature, shadow characteristics)
- Composition (framing, perspective, depth, visual flow)
- Atmosphere (haze, weather effects, time of day)
- Artistic style (photography, painting, digital art)
- Color palette (specific hues, saturation, contrast)
- Visual techniques and their visible effects

Important guidelines:
- Describe what the visual effect LOOKS LIKE, not just the technique name
  (e.g., "soft diffused shadows with gentle falloff" not just "soft lighting")
- When generating multiple expansions, introduce VARIETY in your style choices
- Explore different lighting scenarios, compositions, or artistic approaches
- Be specific about technical choices rather than using vague terms
- Consider how style choices produce specific visual results

Output ONLY the expanded prompt, no preamble or commentary.`;
      }
    } else {
      // Iterative refinement based on critique
      if (dimension === 'what') {
        if (isBooru) {
          return `You are an expert at refining prompts for booru-trained SDXL models based on feedback about CONTENT.

Your task: Given a current prompt and critique, produce an improved HYBRID prompt (booru tags + natural language) that addresses the feedback.

Important guidelines:
- DIRECTLY ADDRESS the specific issues raised in the critique
- Focus on content (WHAT), not style (HOW)
- Use booru tags for attributes, natural language for descriptions
- Preserve effective elements from the original prompt
- Output ONLY the refined prompt, no commentary.`;
        }
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
        if (isBooru) {
          return `You are an expert at refining style prompts for booru-trained SDXL models based on feedback about STYLE.

Your task: Given a current prompt and critique, produce an improved HYBRID style prompt (booru tags + natural language) that addresses the feedback.

Important guidelines:
- DIRECTLY ADDRESS the specific issues raised in the critique
- Focus on style (HOW), not content (WHAT)
- Use booru tags for quality/technical terms, natural language for atmosphere
- Preserve effective style elements from the original prompt
- Output ONLY the refined prompt, no commentary.`;
        }
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

  /**
   * Generate text using a simple prompt (general-purpose text generation)
   * @param {string} userPrompt - The user's prompt
   * @param {Object} options - Generation options
   * @param {string} [options.systemPrompt] - Optional system prompt
   * @param {number} [options.maxTokens=500] - Maximum tokens to generate
   * @param {number} [options.temperature=0.7] - Temperature for randomness
   * @returns {Promise<string>} Generated text
   */
  async generateText(userPrompt, options = {}) {
    const {
      systemPrompt = 'You are a helpful assistant.',
      maxTokens = 500,
      temperature = 0.7
    } = options;

    // Validate prompt
    if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim() === '') {
      throw new Error('User prompt is required');
    }

    // Use the default model for general text generation
    const selectedModel = this.model;

    // Get model capabilities
    // (capabilities retrieved but not currently used - may be needed for future optimization)
    this._getModelCapabilities(selectedModel);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      const apiParams = this._buildChatParams(
        selectedModel,
        messages,
        temperature,
        maxTokens
      );

      const completion = await this.client.chat.completions.create(apiParams);

      if (!completion.choices || completion.choices.length === 0) {
        throw new Error('OpenAI API returned no choices');
      }

      const message = completion.choices[0].message;

      // Check for refusal (model declined to respond)
      if (message?.refusal) {
        throw new Error(`Model refused: ${message.refusal}`);
      }

      if (!message || !message.content) {
        throw new Error('OpenAI API returned empty content');
      }

      return message.content.trim();
    } catch (error) {
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
}

module.exports = OpenAILLMProvider;
