/**
 * @file Local LLM Provider
 * Implements LLM operations using local Python-based LLM service (OpenAI-compatible)
 * Supports dimension-aware prompt refinement and intelligent combination
 */

const axios = require('axios');
const ServiceConnection = require('../utils/service-connection');
const serviceManager = require('../utils/service-manager');

// Health check timeout - be patient with model loading/busy service
const HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.LLM_HEALTH_CHECK_TIMEOUT_MS || '30000', 10);

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
   * @param {Object} options.serviceConnection - Pre-built ServiceConnection (for testing)
   * @param {Object} options.serviceManager - ServiceManager override (for testing)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8003';
    this.model = options.model || 'mistralai/Mistral-7B-Instruct-v0.2';

    // Use injected ServiceConnection or create one
    this._serviceConnection = options.serviceConnection || new ServiceConnection({
      serviceName: 'llm',
      serviceManager: options.serviceManager || serviceManager,
      serviceRestarter: options.serviceRestarter || null,
      onUrlChanged: (newUrl) => { this.apiUrl = newUrl; },
    });
  }

  /**
   * Set service restarter callback (dependency injection)
   * @param {Function} restarter - Async function() => { success, error? }
   */
  setServiceRestarter(restarter) {
    this._serviceConnection.setServiceRestarter(restarter);
  }

  /**
   * Refine a prompt with dimension awareness (what/how)
   * @param {string} prompt - Original prompt to refine
   * @param {Object} options - Refinement options
   * @param {string} options.dimension - 'what' (content) or 'how' (style)
   * @param {string} options.promptStyle - 'natural' (sentences) or 'booru' (comma-separated tags)
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

      const isBooru = options.promptStyle === 'booru';

      if (options.critique) {
        // Pipeline interface: structured critique from CritiqueGenerator
        const { critique, recommendation, reason } = options.critique;
        const originalUserPrompt = options.userPrompt || prompt;

        if (isBooru) {
          systemPrompt = dimension === 'what' ?
            'You are a prompt refiner for booru-trained SDXL models, focused on CONTENT (WHAT). Based on the critique, improve the prompt to better match user intent. Use a HYBRID format: booru tags for attributes (hair_color, eye_color, 1girl) mixed with natural language for descriptions and actions. Output ONLY the improved prompt, no explanations.' :
            'You are a prompt refiner for booru-trained SDXL models, focused on VISUAL STYLE (HOW). Based on the critique, improve the style prompt. Use a HYBRID format: booru tags for quality (masterpiece, best_quality) and technical terms (depth_of_field) mixed with natural language for describing lighting and atmosphere. Output ONLY the improved prompt, no explanations.';
        } else {
          systemPrompt = dimension === 'what' ?
            'You are an SDXL prompt refiner focused on CONTENT (WHAT). Based on the critique and recommendation, improve the prompt to better match user intent while maintaining alignment with the original request.' :
            'You are an SDXL prompt refiner focused on VISUAL STYLE (HOW). Based on the critique and recommendation, improve the prompt to enhance aesthetic quality and visual appeal.';
        }

        userPromptText = `Original user request: "${originalUserPrompt}"
Current ${dimension.toUpperCase()} prompt: "${prompt}"

Critique: ${critique}
Recommendation: ${recommendation}
Reason: ${reason}

Provide an improved ${dimension.toUpperCase()} ${isBooru ? 'tags' : 'prompt'} that addresses the critique while staying aligned with the original user request.`;
      } else if (options.previousResult) {
        // Test interface: previousResult with scores
        const { prompt: prevPrompt, clipScore, aestheticScore, caption } = options.previousResult;
        const focusMetric = dimension === 'what' ?
          `CLIP score: ${clipScore}` :
          `Aesthetic score: ${aestheticScore}`;

        if (isBooru) {
          systemPrompt = dimension === 'what' ?
            'You are a prompt refiner for booru-trained SDXL models, focused on CONTENT (WHAT). Based on critique, improve the prompt to better match user intent and boost CLIP score. Use a HYBRID format: booru tags for attributes (hair_color, 1girl) mixed with natural language for descriptions. Output ONLY the improved prompt, no explanations.' :
            'You are a prompt refiner for booru-trained SDXL models, focused on VISUAL STYLE (HOW). Based on critique, improve the style prompt to enhance aesthetic quality. Use a HYBRID format: booru tags for quality/technical terms mixed with natural language for describing visual effects. Output ONLY the improved prompt, no explanations.';
        } else {
          systemPrompt = dimension === 'what' ?
            'You are an SDXL prompt refiner focused on CONTENT (WHAT). Based on critique, improve the prompt to better match user intent and boost CLIP score.' :
            'You are an SDXL prompt refiner focused on VISUAL STYLE (HOW). Based on critique, improve the prompt to enhance aesthetic quality and visual appeal.';
        }

        userPromptText = `Original prompt: "${prompt}"
Previous result: "${prevPrompt}"
Image caption: "${caption}"
Current ${focusMetric}

Provide improved ${isBooru ? 'tags' : 'a prompt'} focusing on ${dimension === 'what' ? 'content alignment' : 'visual style'}.`;
      } else {
        // Dimension-aware expansion: expand the user's prompt into what/how details
        if (dimension === 'what') {
          if (isBooru) {
            systemPrompt = 'You are a prompt generator for booru-trained SDXL models describing CONTENT (WHAT). CRITICAL: Generate a prompt for the EXACT subject given — do not change the topic or invent a different scenario. Generate a HYBRID prompt mixing booru tags with natural language. Use booru tags for categorical attributes (1girl, blue_eyes, long_hair, school_uniform) and natural language phrases for descriptions and actions. Do NOT add section labels, category prefixes, or numbering. Output ONLY the prompt, nothing else.';
            userPromptText = `User request: "${prompt}"\n\nWHAT (content):`;
          } else {
            systemPrompt = 'You are an SDXL prompt expander for CONTENT (WHAT). CRITICAL: Expand the EXACT subject given — do not change the topic or invent a different scenario. Use CONCRETE VISUAL LANGUAGE — describe what is literally visible. Write 2-4 sentences describing subjects (appearance, posture, expression), objects (shape, color, texture), actions (visible motion, gestures), and spatial relationships. Output ONLY the expanded description, no labels or commentary.';
            userPromptText = `User request: "${prompt}"\n\nWHAT (content):`;
          }
        } else {
          if (isBooru) {
            systemPrompt = 'You are a prompt generator for booru-trained SDXL models describing VISUAL STYLE (HOW). Generate a HYBRID style prompt mixing booru tags with natural language. Start with quality tags (masterpiece, best_quality, absurdres, highres), then add technical terms (depth_of_field, bokeh, chromatic_aberration) and natural language for lighting and atmosphere. Do NOT copy subject/content tags from the user request into the style prompt. Do NOT add section labels. Output ONLY the style prompt as a flat list, nothing else.';
            userPromptText = `User request: "${prompt}"\n\nHOW (style):`;
          } else {
            systemPrompt = 'You are an SDXL prompt expander for VISUAL STYLE (HOW). Use CONCRETE VISUAL LANGUAGE — describe what the visual effects look like, not just technique names. Write 2-4 sentences describing lighting (direction, quality, shadow characteristics), composition, color palette (specific hues), and atmosphere. Derive style cues from the user\'s request (mood, setting, and subject inform the style). Output ONLY the style description, no labels or commentary.';
            userPromptText = `User request: "${prompt}"\n\nHOW (style):`;
          }
        }
      }

      const { text, usage } = await this._generateChat(systemPrompt, userPromptText, options);
      const refinedPrompt = this._cleanLLMResponse(text);

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
      const isBooru = options.promptStyle === 'booru';

      // Build system prompt based on descriptiveness level and prompt style
      let systemPrompt;
      if (isBooru) {
        // Hybrid booru mode: combine tags with natural language descriptions
        if (descriptiveness === 1) {
          systemPrompt = 'You are a prompt combiner for booru-trained SDXL models. Merge WHAT and HOW into a single MINIMAL prompt. Use HYBRID format: booru tags for key attributes and quality, short natural language phrases for descriptions. Keep it concise - remove redundancies. Start with quality tags, then subject, then style. Output ONLY the combined prompt, no explanations.';
        } else if (descriptiveness === 3) {
          systemPrompt = 'You are a prompt combiner for booru-trained SDXL models. Merge WHAT and HOW into a COMPREHENSIVE prompt. Use HYBRID format: booru tags for categorical attributes (1girl, blue_eyes, masterpiece, best_quality, depth_of_field) combined with natural language descriptions for scenes, actions, and atmosphere. Include ALL relevant details from both dimensions. Be THOROUGH. Output ONLY the combined prompt, no explanations.';
        } else {
          systemPrompt = 'You are a prompt combiner for booru-trained SDXL models. Merge WHAT and HOW into a BALANCED prompt. Use HYBRID format: booru tags for categorical attributes and quality markers, natural language phrases for descriptions and atmosphere. Remove duplicates, preserve all meaningful content from both dimensions. Output ONLY the combined prompt, no explanations.';
        }
      } else {
        // Natural language mode (existing behavior)
        if (descriptiveness === 1) {
          systemPrompt = 'You are an SDXL prompt combiner. Your output MUST be BRIEF and MINIMAL. CRITICAL: Use CONCRETE VISUAL LANGUAGE - describe what is literally visible. Produce a SHORT, TERSE prompt by merging WHAT (content) and HOW (style). Strip unnecessary words. Describe physical appearances, not abstract concepts. Be direct and visual. Output ONLY the combined prompt - NO explanations. Keep it SHORT.';
        } else if (descriptiveness === 3) {
          systemPrompt = 'You are an SDXL prompt combiner. Your output MUST be COMPREHENSIVE and RICHLY DETAILED. CRITICAL: Use CONCRETE VISUAL LANGUAGE throughout - describe what is literally visible in the image. Describe physical appearances: shapes, colors, textures, materials, spatial relationships. Describe subjects: posture, expression, clothing, positioning. Describe environment: concrete spatial details, depth, scale. Describe style: lighting direction and quality, color palette, composition, visual techniques. Use specific visual descriptors rather than abstract concepts. If conveying mood, ground it in visual choices (e.g., "warm golden light" not just "cozy"). Avoid vague qualifiers like "beautiful" or "amazing" - describe HOW things look. Write a description that a viewer could verify against the actual image. Make it LONG and DETAILED.';
        } else {
          systemPrompt = 'You are an SDXL prompt combiner. Create a BALANCED prompt that is DETAILED yet FOCUSED. CRITICAL: Use CONCRETE VISUAL LANGUAGE - describe what is literally visible in the image. Describe physical appearances: shapes, colors, textures, spatial relationships. Use specific visual descriptors rather than abstract concepts. If conveying mood, ground it in visual choices (e.g., "warm golden light" not just "cozy feeling"). Avoid vague qualifiers like "beautiful" - describe HOW things look. Preserve ALL meaningful details from both WHAT and HOW dimensions. Write a description that a viewer could verify against the actual image.';
        }
      }

      const userPrompt = isBooru
        ? `WHAT tags: ${whatPrompt || '(none)'}
HOW tags: ${howPrompt || '(none)'}

Combined booru tags:`
        : `WHAT prompt: ${whatPrompt || '(none)'}
HOW prompt: ${howPrompt || '(none)'}

Combined SDXL prompt:`;

      const { text, usage } = await this._generateChat(systemPrompt, userPrompt, options);
      const combinedPrompt = this._cleanLLMResponse(text);

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
   * Generate negative prompt for SDXL image generation
   * @param {string} positivePrompt - The positive prompt to generate negatives for
   * @param {Object} options - Generation options
   * @param {boolean} options.enabled - Whether auto-generation is enabled (default: true)
   * @param {string} options.fallback - Fallback negative prompt if generation fails
   * @returns {Promise<Object>} Object with negativePrompt and metadata
   */
  async generateNegativePrompt(positivePrompt, options = {}) {
    const startTime = Date.now();
    const enabled = options.enabled !== false;
    const fallback = options.fallback || 'blurry, low quality, distorted, deformed, artifacts';

    // If disabled, return empty negative
    if (!enabled) {
      return {
        negativePrompt: '',
        metadata: {
          autoGenerated: false,
          generationTime: 0,
          model: null
        }
      };
    }

    // Handle empty prompt
    if (!positivePrompt || positivePrompt.trim().length === 0) {
      return {
        negativePrompt: fallback,
        metadata: {
          autoGenerated: false,
          generationTime: Date.now() - startTime,
          model: null,
          usedFallback: true
        }
      };
    }

    try {
      const isBooru = options.promptStyle === 'booru';

      const systemPrompt = isBooru
        ? `You are an expert at generating negative prompt tags for SDXL anime/booru-style image generation.

Generate comma-separated negative tags. Always include these standard quality negatives:
lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry

Add context-specific negative tags based on the positive prompt to prevent unwanted elements.
Output ONLY comma-separated tags, nothing else.`
        : `You are an expert at generating negative prompts for SDXL image generation.

Your task: Given a positive prompt, generate a negative prompt that:
1. Prevents common artifacts (blurry, low quality, distorted, deformed, etc.)
2. Disambiguates ambiguous terms (e.g., "old" in "30 year old" should be negated as "elderly, aged")
3. Prevents opposite characteristics from the desired result
4. Reinforces desired elements by excluding their absence (e.g., "no mountains" if mountains are wanted)
5. Does NOT negate the core subject or desired attributes

Examples:

Positive: "30 year old man"
Negative: "elderly, aged, wrinkled, senior, young, child, teenager, blurry, low quality, distorted"

Positive: "old wooden barn"
Negative: "modern, new, metal, glass, blurry, low quality, distorted, people, cars"

Positive: "beautiful sunset over mountains"
Negative: "blurry, low quality, no mountains, flat, urban, city, text, watermark"

Now generate a negative prompt for the following positive prompt. Output ONLY the negative prompt, nothing else.`;

      const userPrompt = `Positive prompt: "${positivePrompt}"`;

      const { text, usage } = await this._generateChat(systemPrompt, userPrompt, {
        temperature: 0.3,  // Lower temp for consistency
        max_tokens: 150,
      });

      const negativePrompt = this._cleanLLMResponse(text);
      const generationTime = Date.now() - startTime;

      return {
        negativePrompt,
        metadata: {
          autoGenerated: true,
          generationTime,
          model: this.model,
          usedFallback: false,
          tokensUsed: usage?.total_tokens || 0,
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0
        }
      };
    } catch (error) {
      // LLM failed, use fallback
      const generationTime = Date.now() - startTime;

      return {
        negativePrompt: fallback,
        metadata: {
          autoGenerated: false,
          generationTime,
          model: null,
          error: error.message,
          usedFallback: true
        }
      };
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
   * Strip preamble, explanations, and notes from LLM output
   * Local models often include "Improved WHAT tags: ...", "Explanation: ...", etc.
   * despite system prompts telling them not to.
   * @private
   * @param {string} text - Raw LLM output
   * @returns {string} Cleaned text with only the desired content
   */
  _cleanLLMResponse(text) {
    let cleaned = text;

    // -2. Strip Qwen3 thinking blocks: <think>...</think> or unclosed <think> at start
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
    cleaned = cleaned.replace(/^<think>\s*/i, '');

    // -1. Strip hashtag prefixes from booru tags (#tag_name → tag_name)
    cleaned = cleaned.replace(/(^|,\s*)#(\w)/g, '$1$2');

    // 0. Fix escaped underscores (model uses markdown formatting for booru tags)
    cleaned = cleaned.replace(/\\_/g, '_');

    // 0b. Collapse multiple quoted sections into one flat list
    //     e.g. "masterpiece, best_quality" "warm tones, bokeh" → masterpiece, best_quality, warm tones, bokeh
    if (/^"[^"]*"(\s+"[^"]*")+/.test(cleaned)) {
      // Replace boundaries between quoted sections with ", " then strip outer quotes
      cleaned = cleaned.replace(/"\s+"/g, ', ').replace(/^"|"$/g, '').replace(/,\s*,/g, ',').trim();
    }

    // 1. Remove trailing explanation/note blocks (everything after double-newline + marker)
    cleaned = cleaned.replace(/\n\n\s*(Explanation|Note|The combined|The revised|The improved|Additionally|Furthermore|These are|In summary|To summarize|I (?:also |have )?(?:removed|replaced|adjusted|added|simplified|restructured))[\s\S]*/i, '');

    // 2. Handle numbered lists — take only the first item
    //    e.g. "1. "A young boy..." 2. "Elegant woman..."" → first item only
    const numberedListMatch = cleaned.match(/^(?:\d+\.\s+["']?)(.+?)["']?\s*(?:\n|$)/);
    if (numberedListMatch && /^\d+\.\s+/m.test(cleaned.slice(numberedListMatch[0].length))) {
      cleaned = numberedListMatch[1];
    }

    // 3. If multiple paragraphs remain, take the last substantial one
    //    (model sometimes outputs raw tags, then a "deduplicated" version)
    const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim().length > 0);
    if (paragraphs.length > 1) {
      cleaned = paragraphs[paragraphs.length - 1];
    }

    // 3b. Handle labeled multi-line sections (quality: ...\nartistic_style: ...)
    //     Strip the labels and join lines as a flat comma-separated list
    const singleLines = cleaned.split('\n').filter(l => l.trim().length > 0);
    if (singleLines.length > 1 && singleLines.every(l => /^\w[\w_ ]*:\s*\S/.test(l.trim()))) {
      cleaned = singleLines.map(l => l.replace(/^\w[\w_ ]*:\s*/, '').trim()).join(', ');
    }

    // 4. Remove action prefixes like "Remove duplicates:", "Deduplicated:", "Combined and deduplicated:"
    cleaned = cleaned.replace(/^(?:Remove\s+duplicates|Deduplicated|Combined(?:\s+and\s+deduplicated)?|Merged)\s*:\s*/i, '');

    // 5. Remove label preambles like "Improved WHAT tags:", "Here are the tags:", etc.
    cleaned = cleaned.replace(/^(?:(?:Improved|Refined|Updated|Generated|Combined|Here (?:are|is)(?: the)?)\s+)?(?:comma-separated\s+)?(?:WHAT|HOW|CONTENT|STYLE|booru|SDXL)?\s*(?:tags|prompt|booru tags|result)\s*:\s*/i, '');

    // 5b. Strip combined/description meta-commentary prefixes
    //     e.g. "Combined natural language phrases:", "Natural language description:", "Generative description:"
    cleaned = cleaned.replace(/^(?:Combined\s+natural\s+language\s+(?:phrases|description)|Natural\s+language\s+(?:description|phrases)|Generative\s+description)\s*:\s*/i, '');

    // 5c. Strip instruction-echo patterns (model repeating the userPromptText anchor)
    //     e.g. "WHAT (content):", "HOW (style):", "Input: "..." WHAT (content):"
    cleaned = cleaned.replace(/^(?:WHAT\s*\(content\)|HOW\s*\(style\))\s*:\s*/i, '');
    // Strip full instruction-echo: "Generate CONTENT/STYLE prompt for booru-trained model: "...""
    cleaned = cleaned.replace(/^Generate\s+(?:CONTENT|STYLE)\s+(?:prompt|tags)\s+(?:for\s+booru-trained\s+model\s*)?:\s*["']?/i, '');

    // 6. Strip "quality:" prefix (model sometimes labels tag lists this way)
    cleaned = cleaned.replace(/^quality\s*:\s*/i, '');

    // 7. Strip surrounding quotes (the LLM often wraps output in quotes)
    cleaned = cleaned.replace(/^["']|["']$/g, '');

    // 8. Strip trailing period from tag lists (but not ellipses like ...)
    cleaned = cleaned.replace(/(?<![.])\.\s*$/, '');

    return cleaned.trim();
  }

  /**
   * Internal method to call local LLM API (OpenAI-compatible)
   * @private
   * @returns {Promise<{text: string, usage: Object}>} Text and usage metadata
   */
  async _generate(prompt, options = {}) {
    return this._serviceConnection.withRetry(
      async () => {
        try {
          const payload = {
            model: this.model,
            prompt: prompt,
            max_tokens: options.max_tokens || 500,
            // Qwen3 non-thinking mode recommended: temp 0.7, top_p 0.8, top_k 20
            temperature: Math.min(options.temperature || 0.7, 0.7),
            top_p: options.top_p || 0.8,
            top_k: options.top_k || 20,
            stream: false
          };

          // Add stop sequences if provided
          if (options.stop) {
            payload.stop = options.stop;
          }

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
   * Internal method to call local LLM chat API (OpenAI-compatible)
   * Uses /v1/chat/completions which applies the model's chat template,
   * enabling proper thinking mode control for Qwen3.
   * @private
   * @param {string} systemPrompt - System instruction
   * @param {string} userMessage - User message
   * @param {Object} options - Generation options
   * @returns {Promise<{text: string, usage: Object}>} Text and usage metadata
   */
  async _generateChat(systemPrompt, userMessage, options = {}) {
    return this._serviceConnection.withRetry(
      async () => {
        try {
          const payload = {
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage }
            ],
            max_tokens: options.max_tokens || 500,
            // Qwen3 non-thinking mode recommended: temp 0.7, top_p 0.8, top_k 20
            temperature: Math.min(options.temperature || 0.7, 0.7),
            top_p: options.top_p || 0.8,
            top_k: options.top_k || 20,
            stream: false
          };

          // Add stop sequences if provided
          if (options.stop) {
            payload.stop = options.stop;
          }

          const response = await axios.post(
            `${this.apiUrl}/v1/chat/completions`,
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

          // Extract text from chat completion response
          const text = response.data.choices[0]?.message?.content || '';
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
        operationName: 'LLM chat generation',
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
        timeout: HEALTH_CHECK_TIMEOUT_MS
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
