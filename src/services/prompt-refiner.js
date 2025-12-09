/**
 * TDD GREEN Phase: Prompt Refiner
 *
 * Uses LLM to refine prompts that triggered content policy violations.
 * Preserves original intent while making minimal necessary changes to avoid violations.
 *
 * Features:
 * - LLM-powered refinement for nuanced understanding
 * - Uses ViolationTracker to find similar past violations for guidance
 * - Preserves as much of original prompt as possible
 * - Model-aware parameter handling (gpt-5 vs others)
 */

const OpenAI = require('openai');
const providerConfig = require('../config/provider-config.js');

class PromptRefiner {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || providerConfig.llm.models.refine;
    this.violationTracker = options.violationTracker || null;

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        maxRetries: options.maxRetries || providerConfig.llm.maxRetries,
        timeout: options.timeout || providerConfig.llm.timeout
      });
    }
  }

  /**
   * Refine a prompt that triggered a content violation
   * @param {string} prompt - The problematic prompt
   * @param {Object} context - Context about the violation
   * @param {Error} context.error - The error that occurred
   * @param {number} context.attempt - Current retry attempt number
   * @param {string} context.originalPrompt - The original unmodified prompt
   * @returns {Promise<string>} Refined prompt
   */
  async refinePrompt(prompt, context) {
    if (!this.apiKey) {
      throw new Error('API key required for prompt refinement');
    }

    const { error, attempt, originalPrompt } = context;

    // Build system prompt
    const systemPrompt = `You are an expert at refining image generation prompts to avoid content policy violations while preserving the original creative intent as much as possible.

Your task is to take a prompt that triggered a content policy violation and refine it to be acceptable while:
1. Preserving the core creative intent and subject matter
2. Making MINIMAL changes - only what's necessary to avoid violations
3. Keeping the refined prompt as close as possible to the original
4. Maintaining the same level of detail and specificity

Guidelines for refinement:
- Replace potentially problematic terms with acceptable alternatives
- Soften extreme or graphic language
- Reframe controversial concepts in neutral ways
- Maintain artistic and creative value
- Keep the same scene/subject/mood if possible

Output ONLY the refined prompt text, nothing else.`;

    // Build user prompt with context
    let userPrompt = `Original prompt that triggered violation:
"${prompt}"

Error message: ${error.message}

Attempt number: ${attempt}

${originalPrompt !== prompt ? `First attempt was: "${originalPrompt}"` : ''}`;

    // Add similar examples if ViolationTracker is available
    if (this.violationTracker) {
      const similarViolations = this.violationTracker.findSimilar(prompt);

      if (similarViolations && similarViolations.length > 0) {
        userPrompt += `\n\nSimilar past violations and their successful refinements:`;

        for (const example of similarViolations) {
          userPrompt += `\n- Original: "${example.original}"`;
          userPrompt += `\n  Refined to: "${example.refined}"`;
          userPrompt += `\n  Similarity: ${(example.similarity * 100).toFixed(0)}%\n`;
        }

        userPrompt += `\nUse these examples as guidance for your refinement.`;
      }
    }

    userPrompt += `\n\nProvide a refined prompt that avoids the violation while preserving the original intent.`;

    try {
      // Determine model capabilities
      const isGpt5 = this.model.includes('gpt-5');
      const tokenParam = isGpt5 ? 'max_completion_tokens' : 'max_tokens';

      const requestParams = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      };

      // Add temperature only for non-gpt-5 models
      if (!isGpt5) {
        requestParams.temperature = 0.7; // Slightly creative for better refinements
      }

      // Add token limit using model-appropriate parameter
      // Refinements should be similar length to original prompts
      requestParams[tokenParam] = 500;

      const completion = await this.client.chat.completions.create(requestParams);

      const refinedPrompt = completion.choices[0].message.content.trim();

      return refinedPrompt;
    } catch (error) {
      throw new Error(`Failed to refine prompt: ${error.message}`);
    }
  }
}

module.exports = PromptRefiner;
