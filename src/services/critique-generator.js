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
const providerConfig = require('../config/provider-config.js');

class CritiqueGenerator {
  constructor(options = {}) {
    // Use OpenAI for critique generation if API key provided
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    // Use refine model from config (critique is a moderate complexity task like refine)
    this.model = options.model || providerConfig.llm.models.refine;

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        maxRetries: options.maxRetries || providerConfig.llm.maxRetries,
        timeout: options.timeout || providerConfig.llm.timeout
      });
    }
  }

  /**
   * Generate structured critique for prompt refinement
   * @param {Object} feedback - Evaluation or ranking feedback
   * @param {number} [feedback.alignmentScore] - Score 0-100 (evaluation mode)
   * @param {number} [feedback.aestheticScore] - Score 0-10 (evaluation mode)
   * @param {string} [feedback.analysis] - Vision analysis text (evaluation mode)
   * @param {number} [feedback.rank] - Comparative rank (ranking mode)
   * @param {string} [feedback.reason] - Ranking reason (ranking mode)
   * @param {string} [feedback.improvementSuggestion] - Direct suggestion (ranking mode)
   * @param {string[]} feedback.strengths - What worked well
   * @param {string[]} feedback.weaknesses - What needs improvement
   * @param {Object} prompts - The prompts used
   * @param {string} prompts.what - Content prompt
   * @param {string} prompts.how - Style prompt
   * @param {string} prompts.combined - Combined prompt used for generation
   * @param {Object} options - Generation options
   * @param {string} options.dimension - 'what' or 'how'
   * @param {number} [options.iteration] - Current iteration number
   * @returns {Promise<Object>} Structured critique with recommendation
   */
  async generateCritique(feedback, prompts, options) {
    // Validate required parameters
    if (!feedback) {
      throw new Error('feedback is required');
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

    // Detect feedback type: ranking-based vs evaluation-based
    const isRankingBased = feedback.rank !== undefined || feedback.improvementSuggestion !== undefined;

    // If no API key, generate a simple rule-based critique
    if (!this.apiKey) {
      return this._generateSimpleCritique(feedback, prompts, options);
    }

    // Use appropriate LLM critique method based on feedback type
    if (isRankingBased) {
      return this._generateRankingBasedCritique(feedback, prompts, options);
    }
    return this._generateLLMCritique(feedback, prompts, options);
  }

  /**
   * Generate critique using ranking feedback (no absolute scores)
   * @private
   */
  async _generateRankingBasedCritique(feedback, prompts, options) {
    const { dimension, iteration } = options;
    const { rank, reason, strengths, weaknesses, improvementSuggestion } = feedback;

    const systemPrompt = `You are an expert at providing actionable feedback for prompt refinement based on comparative ranking.

Your task is to analyze ranking feedback and provide specific improvements for the ${dimension === 'what' ? 'WHAT (content)' : 'HOW (style)'} prompt.

You will receive:
- The WHAT prompt (content description)
- The HOW prompt (visual style description)
- Comparative ranking feedback (rank, reason, strengths, weaknesses)
- An improvement suggestion from the ranking

Output format (JSON):
{
  "critique": "Clear statement of the main issue OR what could be enhanced",
  "recommendation": "Specific change to the ${dimension.toUpperCase()} prompt that PRESERVES strengths while addressing weaknesses",
  "reason": "Why this change will improve ${dimension === 'how' ? 'visual quality' : 'content alignment'}"
}

Guidelines:
- Focus ONLY on ${dimension === 'what' ? 'content elements (subjects, objects, actions, setting)' : 'style elements (lighting, composition, color, atmosphere, artistic techniques)'}
- PRESERVE and CAPITALIZE on the strengths - don't remove or dilute what's working
- Address the weaknesses with targeted improvements
- Be specific and actionable
- The recommendation should build on existing strengths while fixing weaknesses`;

    const userPrompt = `Current Prompts:
WHAT: "${prompts.what}"
HOW: "${prompts.how}"
COMBINED: "${prompts.combined}"

Comparative Ranking Feedback:
- Rank: ${rank} (1 = best)
- Reason: ${reason || 'Not provided'}
- Strengths: ${strengths?.length > 0 ? strengths.join(', ') : 'None identified'}
- Weaknesses: ${weaknesses?.length > 0 ? weaknesses.join(', ') : 'None identified'}
- Improvement Suggestion: ${improvementSuggestion || 'Not provided'}

${iteration !== undefined ? `Iteration: ${iteration}` : ''}

Provide critique and recommendation for improving the ${dimension.toUpperCase()} prompt.`;

    try {
      const isGpt5 = this.model.includes('gpt-5');
      const tokenParam = isGpt5 ? 'max_completion_tokens' : 'max_tokens';
      // GPT-5 models need more tokens for reasoning overhead
      const tokenLimit = isGpt5 ? 4000 : 1000;

      const requestParams = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      };
      requestParams[tokenParam] = tokenLimit;

      const response = await this.client.chat.completions.create(requestParams);
      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content);

      return {
        critique: parsed.critique,
        recommendation: parsed.recommendation,
        reason: parsed.reason,
        dimension,
        metadata: {
          model: response.model,
          tokensUsed: response.usage?.total_tokens,
          feedbackType: 'ranking'
        }
      };
    } catch (error) {
      console.error('Ranking-based critique generation failed:', error.message);
      // Fallback: use the improvement suggestion directly
      return {
        critique: weaknesses?.[0] || 'Could be improved',
        recommendation: improvementSuggestion || 'Refine the prompt for better results',
        reason: reason || 'Based on comparative analysis',
        dimension,
        metadata: { feedbackType: 'ranking-fallback', tokensUsed: 0 }
      };
    }
  }

  /**
   * Generate critique using LLM (GPT-4)
   * @private
   */
  async _generateLLMCritique(evaluation, prompts, options) {
    const { dimension, iteration, parentScore } = options;
    const { alignmentScore, aestheticScore, analysis, strengths, weaknesses } = evaluation;

    // Determine which score type to use for critique intensity
    // WHAT dimension: use alignmentScore (content match)
    // HOW dimension: use aestheticScore if available, otherwise alignmentScore
    let scoreType = 'alignment';

    if (dimension === 'how' && aestheticScore !== undefined) {
      scoreType = 'aesthetic';
    }

    // Build system prompt
    const systemPrompt = `You are an expert at analyzing image generation results and providing actionable feedback for prompt refinement.

Your task is to analyze the evaluation of a generated image and provide structured feedback.

You will receive:
- The WHAT prompt (content description)
- The HOW prompt (visual style description)
- The COMBINED prompt (what was actually used)
- Alignment score (0-100, where 100 is perfect content match)
${aestheticScore !== undefined ? '- Aesthetic score (0-10, where 10 is exceptional visual quality)' : ''}
- Analysis of what worked and what didn't

You must provide feedback for ${dimension === 'what' ? 'WHAT (content)' : 'HOW (style)'} dimension only.

${dimension === 'how' && aestheticScore !== undefined ?
  'IMPORTANT: For HOW dimension, focus primarily on the aesthetic score (visual quality) rather than alignment score (content match).' :
  dimension === 'what' ?
  'IMPORTANT: For WHAT dimension, focus primarily on the alignment score (content match).' : ''}

Output format (JSON):
{
  "critique": "Clear statement of the main issue OR what could be enhanced",
  "recommendation": "Specific change to the ${dimension.toUpperCase()} prompt that PRESERVES strengths while addressing weaknesses",
  "reason": "Why this change will address the critique and improve ${dimension === 'how' ? 'visual quality' : 'content alignment'}"
}

Guidelines:
- Be specific and actionable
- Focus ONLY on ${dimension === 'what' ? 'content elements (subjects, objects, actions, setting)' : 'style elements (lighting, composition, color, atmosphere, artistic techniques)'}
- PRESERVE and CAPITALIZE on identified strengths - don't remove or dilute what's working
- Address the weaknesses with targeted improvements
- Consider how the WHAT and HOW interact in the combined prompt
- For high scores (>80 or >8/10): suggest minor refinements that build on strengths
- For medium scores (60-80 or 6-8/10): suggest moderate improvements while preserving strengths
- For low scores (<60 or <6/10): suggest significant revisions but keep any identified strengths`;

    const userPrompt = `Current Prompts:
WHAT: "${prompts.what}"
HOW: "${prompts.how}"
COMBINED: "${prompts.combined}"

Evaluation Results:
- Alignment Score: ${alignmentScore}/100 (content match)
${aestheticScore !== undefined ? `- Aesthetic Score: ${aestheticScore}/10 (visual quality)` : ''}
- Analysis: ${analysis}
- Strengths: ${strengths.length > 0 ? strengths.join(', ') : 'None identified'}
- Weaknesses: ${weaknesses.length > 0 ? weaknesses.join(', ') : 'None identified'}

${iteration !== undefined ? `Iteration: ${iteration}` : ''}
${parentScore !== undefined ? `Previous score: ${parentScore}/100` : ''}

Provide critique and recommendation for improving the ${dimension.toUpperCase()} prompt${dimension === 'how' && aestheticScore !== undefined ? ' (focus on visual quality/aesthetic score)' : dimension === 'what' ? ' (focus on content/alignment score)' : ''}.`;

    try {
      // Determine model capabilities
      // gpt-5 models: use max_completion_tokens, no custom temperature
      // Other models: use max_tokens, support custom temperature
      const isGpt5 = this.model.includes('gpt-5');
      const tokenParam = isGpt5 ? 'max_completion_tokens' : 'max_tokens';

      const requestParams = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      };

      // Add temperature only for non-gpt-5 models (gpt-5 only supports default temperature=1)
      if (!isGpt5) {
        requestParams.temperature = 0.5; // Balanced creativity and consistency
      }

      // Add token limit using model-appropriate parameter
      // gpt-5 models use reasoning tokens (internal thinking) which count against the limit
      // Need much higher limit: ~800 for reasoning + ~400 for actual JSON response
      requestParams[tokenParam] = isGpt5 ? 4000 : 800;

      const completion = await this.client.chat.completions.create(requestParams);

      // Debug: Check what we got back
      if (!completion.choices || completion.choices.length === 0) {
        console.error('Critique API returned no choices:', JSON.stringify(completion, null, 2));
        throw new Error('Critique API returned no choices');
      }

      const responseText = completion.choices[0].message?.content?.trim() || '';

      // Better error handling for JSON parsing
      if (!responseText) {
        console.error('Critique API returned empty content. Full response:', JSON.stringify(completion, null, 2));
        throw new Error('Critique API returned empty content');
      }

      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse critique JSON.');
        console.error('Response length:', responseText.length);
        console.error('Response text:', responseText);
        console.error('Parse error:', parseError.message);
        console.error('Full completion object:', JSON.stringify(completion, null, 2));
        throw new Error(`Failed to parse critique response: ${parseError.message}`);
      }

      return {
        critique: parsed.critique || 'Unable to generate critique',
        recommendation: parsed.recommendation || 'Unable to generate recommendation',
        reason: parsed.reason || 'Unable to generate reason',
        dimension,
        metadata: {
          alignmentScore,
          aestheticScore,
          relevantScore: dimension === 'how' && aestheticScore !== undefined ? aestheticScore : alignmentScore,
          scoreType,
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
    const { alignmentScore, aestheticScore, weaknesses } = evaluation;

    // Choose relevant score based on dimension
    // WHAT dimension: use alignmentScore (content match)
    // HOW dimension: use aestheticScore if available, otherwise alignmentScore
    let relevantScore = alignmentScore;
    let scoreType = 'alignment';

    if (dimension === 'how' && aestheticScore !== undefined) {
      relevantScore = aestheticScore * 10; // Convert 0-10 to 0-100 scale for comparison
      scoreType = 'aesthetic';
    }

    let critique, recommendation, reason;

    // Determine severity based on relevant score
    if (relevantScore >= 80) {
      critique = `The ${dimension} prompt is performing well with minor room for improvement.`;
      recommendation = `Add subtle refinements to the ${dimension.toUpperCase()} prompt to enhance specific details.`;
      reason = 'Minor refinements can push a good result toward excellence.';
    } else if (relevantScore >= 60) {
      const weakness = weaknesses.length > 0 ? weaknesses[0] : 'some aspects need improvement';
      critique = `The ${dimension} prompt needs moderate improvement. Issue: ${weakness}`;
      recommendation = `Revise the ${dimension.toUpperCase()} prompt to address: ${weakness}`;
      reason = `Addressing this weakness will improve ${dimension === 'how' ? 'visual quality' : 'content alignment'}.`;
    } else {
      const issues = weaknesses.length > 0 ? weaknesses.join(', ') : 'multiple significant issues';
      critique = `The ${dimension} prompt requires significant revision. Issues: ${issues}`;
      recommendation = `Completely rework the ${dimension.toUpperCase()} prompt to address: ${issues}`;
      reason = `Major revisions are needed to achieve acceptable ${dimension === 'how' ? 'visual quality' : 'content alignment'}.`;
    }

    return {
      critique,
      recommendation,
      reason,
      dimension,
      metadata: {
        alignmentScore,
        aestheticScore,
        relevantScore: dimension === 'how' && aestheticScore !== undefined ? aestheticScore : alignmentScore,
        scoreType,
        method: 'rule-based',
        tokensUsed: 0,
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = CritiqueGenerator;
