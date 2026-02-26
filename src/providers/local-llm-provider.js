/**
 * @file Local LLM Provider
 * Implements LLM operations using local Python-based LLM service (OpenAI-compatible)
 * Supports dimension-aware prompt refinement and intelligent combination
 */

const axios = require('axios');
const ServiceConnection = require('../utils/service-connection');
const serviceManager = require('../utils/service-manager');
const { getNegativeSystemPrompt, getCombineSystemPrompt, getExpandSystemPrompt, getRefineSystemPrompt } = require('../prompts');

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

        systemPrompt = getRefineSystemPrompt({ dimension, promptStyle: options.promptStyle, variant: 'local' });

        userPromptText = `Original user request: "${originalUserPrompt}"
Current ${dimension.toUpperCase()} prompt: "${prompt}"

Critique: ${critique}
Recommendation: ${recommendation}
Reason: ${reason}

Improved ${dimension.toUpperCase()} ${isBooru ? 'tags' : 'prompt'}:`;
      } else if (options.previousResult) {
        // Test interface: previousResult with scores
        const { prompt: prevPrompt, clipScore, aestheticScore, caption } = options.previousResult;
        const focusMetric = dimension === 'what' ?
          `CLIP score: ${clipScore}` :
          `Aesthetic score: ${aestheticScore}`;

        systemPrompt = getRefineSystemPrompt({ dimension, promptStyle: options.promptStyle, variant: 'local' });

        userPromptText = `Original prompt: "${prompt}"
Previous result: "${prevPrompt}"
Image caption: "${caption}"
Current ${focusMetric}

Improved ${dimension.toUpperCase()} ${isBooru ? 'tags' : 'prompt'}:`;
      } else {
        // Dimension-aware expansion: expand the user's prompt into what/how details
        systemPrompt = getExpandSystemPrompt({ dimension, promptStyle: options.promptStyle, variant: 'local' });
        const dimLabel = dimension === 'what' ? 'WHAT (content)' : 'HOW (style)';
        userPromptText = `User request: "${prompt}"\n\n${dimLabel}:`;
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

      const systemPrompt = getCombineSystemPrompt({ promptStyle: options.promptStyle, descriptiveness });

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
      const systemPrompt = getNegativeSystemPrompt({ promptStyle: options.promptStyle });

      const userPrompt = `Positive prompt: "${positivePrompt}"`;

      const { text, usage } = await this._generateChat(systemPrompt, userPrompt, {
        temperature: 0.3,  // Lower temp for consistency
        max_tokens: 200,   // Enough for 25-30 items without truncation
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

    // 0c. Strip markdown bold header blocks with bullet lists (meta-commentary from refine)
    //     e.g., "**Key Improvements:**\n- Added X\n- Changed Y\n- Maintained Z"
    cleaned = cleaned.replace(/\*\*[^*]+\*\*\s*:?\s*(?:\n\s*[-•]\s+[^\n]+)+/g, '').trim();

    // 0d. Strip meta-commentary sentences that describe changes rather than being prompts
    //     e.g., "This refined version strengthens...", "This refined HOW prompt enhances..."
    //     "Key improvements include...", "The changes focus on..."
    cleaned = cleaned.replace(/^(?:This\s+(?:refined|improved|updated|revised)\s+(?:version|prompt|HOW prompt|WHAT prompt|HOW|WHAT)\b[^.]*\.)\s*/im, '');
    cleaned = cleaned.replace(/^(?:Key\s+improvements?\s+(?:include|are|focus)[^.]*\.)\s*/im, '');
    cleaned = cleaned.replace(/^(?:The\s+(?:changes?|modifications?|updates?|revisions?)\s+(?:focus|include|are|address)[^.]*\.)\s*/im, '');

    // 1. Remove trailing explanation/note blocks (everything after double-newline + marker)
    cleaned = cleaned.replace(/\n\n\s*(Explanation|Note|The combined|The revised|The improved|Additionally|Furthermore|These are|In summary|To summarize|I (?:also |have )?(?:removed|replaced|adjusted|added|simplified|restructured))[\s\S]*/i, '');

    // 2. Handle numbered lists — take only the first item
    //    e.g. "1. "A young boy..." 2. "Elegant woman..."" → first item only
    const numberedListMatch = cleaned.match(/^(?:\d+\.\s+["']?)(.+?)["']?\s*(?:\n|$)/);
    if (numberedListMatch && /^\d+\.\s+/m.test(cleaned.slice(numberedListMatch[0].length))) {
      cleaned = numberedListMatch[1];
    }

    // 3. If multiple paragraphs remain, select the best one
    //    For booru: model outputs raw tags then "deduplicated" version → last is fine
    //    For natural language: last may be a truncated fragment → prefer longest
    const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim().length > 0);
    if (paragraphs.length > 1) {
      const lastParagraph = paragraphs[paragraphs.length - 1];
      const MIN_PROMPT_LENGTH = 80; // Shorter than this is likely a truncated fragment
      if (lastParagraph.trim().length < MIN_PROMPT_LENGTH) {
        // Last paragraph is suspiciously short — use the longest one instead
        const longestIdx = paragraphs.reduce((maxIdx, p, i) =>
          p.trim().length > paragraphs[maxIdx].trim().length ? i : maxIdx, 0);
        cleaned = paragraphs[longestIdx];
      } else {
        cleaned = lastParagraph;
      }
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

          // Add response format if provided (e.g. JSON mode)
          if (options.response_format) {
            payload.response_format = options.response_format;
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
   * Generic chat completion — accepts a messages array and returns { text, usage }
   * Supports responseFormat option for JSON mode.
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} options - Generation options
   * @param {Object} [options.responseFormat] - e.g. { type: 'json_object' }
   * @returns {Promise<{text: string, usage: Object}>}
   */
  async chat(messages, options = {}) {
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const userMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const chatOptions = { ...options };
    if (options.responseFormat) {
      chatOptions.response_format = options.responseFormat;
    }
    return this._generateChat(systemMsg, userMsg, chatOptions);
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
