/**
 * TDD GREEN Phase: Critique Generator
 *
 * Generates structured, actionable feedback for prompt refinement.
 * Uses LLM to analyze evaluation results and produce:
 * - Critique: What's wrong with the current result
 * - Recommendation: Specific change to WHAT or HOW prompt
 * - Reason: Why this change addresses the critique
 */

const OpenAI = require('openai');

class CritiqueGenerator {
  constructor(options = {}) {
    // Use OpenAI for critique generation if API key provided
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || 'gpt-4o-mini'; // Fast model for critique generation

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        maxRetries: options.maxRetries || 3,
        timeout: options.timeout || 15000
      });
    }
  }

  /**
   * Generate structured critique for prompt refinement
   * @param {Object} evaluation - Vision provider evaluation results
   * @param {number} evaluation.alignmentScore - Score 0-100
   * @param {string} evaluation.analysis - Vision analysis text
   * @param {string[]} evaluation.strengths - What worked well
   * @param {string[]} evaluation.weaknesses - What needs improvement
   * @param {Object} prompts - The prompts used
   * @param {string} prompts.what - Content prompt
   * @param {string} prompts.how - Style prompt
   * @param {string} prompts.combined - Combined prompt used for generation
   * @param {Object} options - Generation options
   * @param {string} options.dimension - 'what' or 'how'
   * @param {number} [options.iteration] - Current iteration number
   * @param {number} [options.parentScore] - Previous iteration score
   * @returns {Promise<Object>} Structured critique with recommendation
   */
  async generateCritique(evaluation, prompts, options) {
    // Validate required parameters
    if (!evaluation) {
      throw new Error('evaluation is required');
    }

    if (!prompts) {
      throw new Error('prompts are required');
    }

    if (!options || !options.dimension) {
      throw new Error('dimension is required in options');
    }

    const { dimension } = options;

    // Validate dimension
    if (dimension !== 'what' && dimension !== 'how') {
      throw new Error('dimension must be either "what" or "how"');
    }

    // If no API key, generate a simple rule-based critique
    if (!this.apiKey) {
      return this._generateSimpleCritique(evaluation, prompts, options);
    }

    // Use LLM to generate sophisticated critique
    return this._generateLLMCritique(evaluation, prompts, options);
  }

  /**
   * Generate critique using LLM (GPT-4)
   * @private
   */
  async _generateLLMCritique(evaluation, prompts, options) {
    const { dimension, iteration, parentScore } = options;
    const { alignmentScore, analysis, strengths, weaknesses } = evaluation;

    // Build system prompt
    const systemPrompt = `You are an expert at analyzing image generation results and providing actionable feedback for prompt refinement.

Your task is to analyze the evaluation of a generated image and provide structured feedback.

You will receive:
- The WHAT prompt (content description)
- The HOW prompt (visual style description)
- The COMBINED prompt (what was actually used)
- Alignment score (0-100, where 100 is perfect)
- Analysis of what worked and what didn't

You must provide feedback for ${dimension === 'what' ? 'WHAT (content)' : 'HOW (style)'} dimension only.

Output format (JSON):
{
  "critique": "Clear statement of the main issue with current result",
  "recommendation": "Specific change to the ${dimension.toUpperCase()} prompt",
  "reason": "Why this change will address the critique and improve alignment"
}

Guidelines:
- Be specific and actionable
- Focus ONLY on ${dimension === 'what' ? 'content elements (subjects, objects, actions, setting)' : 'style elements (lighting, composition, color, atmosphere, artistic techniques)'}
- Consider how the WHAT and HOW interact in the combined prompt
- For high scores (>80): suggest minor refinements
- For medium scores (60-80): suggest moderate improvements
- For low scores (<60): suggest significant revisions`;

    const userPrompt = `Current Prompts:
WHAT: "${prompts.what}"
HOW: "${prompts.how}"
COMBINED: "${prompts.combined}"

Evaluation Results:
- Alignment Score: ${alignmentScore}/100
- Analysis: ${analysis}
- Strengths: ${strengths.length > 0 ? strengths.join(', ') : 'None identified'}
- Weaknesses: ${weaknesses.length > 0 ? weaknesses.join(', ') : 'None identified'}

${iteration !== undefined ? `Iteration: ${iteration}` : ''}
${parentScore !== undefined ? `Previous score: ${parentScore}/100` : ''}

Provide critique and recommendation for improving the ${dimension.toUpperCase()} prompt.`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5, // Balanced creativity and consistency
        max_tokens: 400,
        response_format: { type: 'json_object' }
      });

      const responseText = completion.choices[0].message.content.trim();
      const parsed = JSON.parse(responseText);

      return {
        critique: parsed.critique || 'Unable to generate critique',
        recommendation: parsed.recommendation || 'Unable to generate recommendation',
        reason: parsed.reason || 'Unable to generate reason',
        dimension,
        metadata: {
          alignmentScore,
          iteration,
          parentScore,
          model: completion.model,
          tokensUsed: completion.usage.total_tokens,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      // Fallback to simple critique if LLM fails
      console.warn('LLM critique generation failed, using fallback:', error.message);
      return this._generateSimpleCritique(evaluation, prompts, options);
    }
  }

  /**
   * Generate simple rule-based critique (fallback)
   * @private
   */
  _generateSimpleCritique(evaluation, prompts, options) {
    const { dimension } = options;
    const { alignmentScore, weaknesses } = evaluation;

    let critique, recommendation, reason;

    // Determine severity based on score
    if (alignmentScore >= 80) {
      critique = `The ${dimension} prompt is performing well with minor room for improvement.`;
      recommendation = `Add subtle refinements to the ${dimension.toUpperCase()} prompt to enhance specific details.`;
      reason = 'Minor refinements can push a good result toward excellence.';
    } else if (alignmentScore >= 60) {
      const weakness = weaknesses.length > 0 ? weaknesses[0] : 'some aspects need improvement';
      critique = `The ${dimension} prompt needs moderate improvement. Issue: ${weakness}`;
      recommendation = `Revise the ${dimension.toUpperCase()} prompt to address: ${weakness}`;
      reason = `Addressing this weakness will improve alignment and move closer to the target.`;
    } else {
      const issues = weaknesses.length > 0 ? weaknesses.join(', ') : 'multiple significant issues';
      critique = `The ${dimension} prompt requires significant revision. Issues: ${issues}`;
      recommendation = `Completely rework the ${dimension.toUpperCase()} prompt to address: ${issues}`;
      reason = 'Major revisions are needed to achieve acceptable alignment with the target.';
    }

    return {
      critique,
      recommendation,
      reason,
      dimension,
      metadata: {
        alignmentScore,
        method: 'rule-based',
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = CritiqueGenerator;
