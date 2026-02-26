/**
 * Critique Generator
 *
 * Generates structured, actionable feedback for prompt refinement.
 * Uses the injected LLM provider to analyze evaluation results and produce:
 * - Critique: What's wrong with the current result
 * - Recommendation: Specific change to WHAT or HOW prompt
 * - Reason: Why this change addresses the critique
 */

class CritiqueGenerator {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider;
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
   * @param {string} userPrompt - Original user request (for alignment checking)
   * @param {Object} options - Generation options
   * @param {string} options.dimension - 'what' or 'how'
   * @param {number} [options.iteration] - Current iteration number
   * @returns {Promise<Object>} Structured critique with recommendation
   */
  async generateCritique(feedback, prompts, userPrompt, options) {
    if (!feedback) throw new Error('feedback is required');
    if (!prompts) throw new Error('prompts are required');
    if (!userPrompt) throw new Error('userPrompt is required');
    if (!options || !options.dimension) throw new Error('dimension is required in options');

    const { dimension } = options;
    if (dimension !== 'what' && dimension !== 'how') {
      throw new Error('dimension must be either "what" or "how"');
    }

    const isRankingBased = feedback.rank !== undefined || feedback.improvementSuggestion !== undefined;

    if (!this.llmProvider) {
      return this._generateSimpleCritique(feedback, prompts, options);
    }

    if (isRankingBased) {
      return this._generateRankingBasedCritique(feedback, prompts, userPrompt, options);
    }
    return this._generateLLMCritique(feedback, prompts, userPrompt, options);
  }

  /**
   * Generate critique using ranking feedback (no absolute scores)
   * @private
   */
  async _generateRankingBasedCritique(feedback, prompts, userPrompt, options) {
    const { dimension, iteration } = options;
    const { rank, reason, strengths, weaknesses, improvementSuggestion } = feedback;

    const systemPrompt = `You are an expert at providing actionable feedback for prompt refinement based on comparative ranking.

Your task is to analyze ranking feedback and provide specific improvements for the ${dimension === 'what' ? 'WHAT (content)' : 'HOW (style)'} prompt.

You will receive:
- The ORIGINAL USER REQUEST (for alignment verification)
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
- The recommendation should build on existing strengths while fixing weaknesses
- CRITICAL: Ensure refined prompts stay aligned with the ORIGINAL USER REQUEST while addressing critique feedback`;

    const userMessage = `Original User Request: "${userPrompt}"

Current Prompts:
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

Provide critique and recommendation for improving the ${dimension.toUpperCase()} prompt while maintaining alignment with the original user request.`;

    try {
      const { text, usage } = await this.llmProvider.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        { maxTokens: 1000, temperature: 0.5, responseFormat: { type: 'json_object' } }
      );

      const parsed = JSON.parse(text);

      return {
        critique: parsed.critique,
        recommendation: parsed.recommendation,
        reason: parsed.reason,
        dimension,
        metadata: {
          tokensUsed: usage?.total_tokens,
          feedbackType: 'ranking'
        }
      };
    } catch (error) {
      console.error('Ranking-based critique generation failed:', error.message);
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
   * Generate critique using LLM
   * @private
   */
  async _generateLLMCritique(evaluation, prompts, userPrompt, options) {
    const { dimension, iteration, parentScore } = options;
    const { alignmentScore, aestheticScore, analysis, strengths, weaknesses } = evaluation;

    let scoreType = 'alignment';
    if (dimension === 'how' && aestheticScore !== undefined) {
      scoreType = 'aesthetic';
    }

    const systemPrompt = `You are an expert at analyzing image generation results and providing actionable feedback for prompt refinement.

Your task is to analyze the evaluation of a generated image and provide structured feedback that maintains alignment with the user's original request.

You will receive:
- The ORIGINAL USER REQUEST (for alignment verification)
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
- CRITICAL: Ensure refined prompts stay aligned with the ORIGINAL USER REQUEST while addressing evaluation feedback
- For high scores (>80 or >8/10): suggest minor refinements that build on strengths
- For medium scores (60-80 or 6-8/10): suggest moderate improvements while preserving strengths
- For low scores (<60 or <6/10): suggest significant revisions but keep any identified strengths`;

    const userMessage = `Original User Request: "${userPrompt}"

Current Prompts:
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

Provide critique and recommendation for improving the ${dimension.toUpperCase()} prompt while maintaining alignment with the original user request${dimension === 'how' && aestheticScore !== undefined ? ' (focus on visual quality/aesthetic score)' : dimension === 'what' ? ' (focus on content/alignment score)' : ''}.`;

    try {
      const { text, usage } = await this.llmProvider.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        { maxTokens: 1000, temperature: 0.5, responseFormat: { type: 'json_object' } }
      );

      if (!text) {
        throw new Error('LLM returned empty content');
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        console.error('Failed to parse critique JSON:', text);
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
          tokensUsed: usage?.total_tokens,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.warn('LLM critique generation failed, using fallback:', error.message);
      return this._generateSimpleCritique(evaluation, prompts, options);
    }
  }

  /**
   * Generate simple rule-based critique (fallback when no LLM provider)
   * @private
   */
  _generateSimpleCritique(evaluation, prompts, options) {
    const { dimension } = options;
    const { alignmentScore, aestheticScore, weaknesses } = evaluation;

    let relevantScore = alignmentScore;
    let scoreType = 'alignment';

    if (dimension === 'how' && aestheticScore !== undefined) {
      relevantScore = aestheticScore * 10;
      scoreType = 'aesthetic';
    }

    let critique, recommendation, reason;

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
