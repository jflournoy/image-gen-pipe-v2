/**
 * TDD GREEN Phase: Mock LLM Provider
 *
 * Minimal implementation for prompt refinement testing.
 * Simulates LLM behavior for WHAT (content) and HOW (style) dimensions.
 */

class MockLLMProvider {
  constructor() {
    this.name = 'mock-llm-provider';
  }

  /**
   * Refine a prompt by expanding either content (WHAT) or style (HOW) dimensions
   * @param {string} prompt - The original prompt to refine
   * @param {Object} options - Refinement options
   * @param {string} options.dimension - 'what' (content) or 'how' (style)
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
      temperature = 0.7,
      maxTokens = 500
    } = options;

    // Validate dimension
    if (dimension !== 'what' && dimension !== 'how') {
      throw new Error('Dimension must be either "what" or "how"');
    }

    // Validate temperature
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
      throw new Error('Temperature out of range: must be between 0.0 and 1.0');
    }

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Generate deterministic refinement based on dimension
    let refinedPrompt;
    let explanation;

    if (dimension === 'what') {
      // WHAT dimension: expand content details (subjects, objects, actions)
      refinedPrompt = this._expandWhatDimension(prompt);
      explanation = 'Expanded content details: added specific subjects and objects';
    } else {
      // HOW dimension: expand style details (lighting, composition, atmosphere)
      refinedPrompt = this._expandHowDimension(prompt);
      explanation = 'Expanded style details: added lighting, composition, and atmosphere';
    }

    // Calculate mock token usage (simple heuristic)
    const tokensUsed = Math.min(
      Math.floor(refinedPrompt.length / 4) + 50, // ~4 chars per token + overhead
      maxTokens
    );

    return {
      refinedPrompt,
      explanation,
      metadata: {
        model: 'mock-gpt-4',
        dimension,
        tokensUsed,
        temperature,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Expand WHAT dimension (content: subjects, objects, actions)
   * @private
   */
  _expandWhatDimension(prompt) {
    // Deterministic expansion for testing
    const contentAdditions = [
      'with detailed textures',
      'featuring multiple elements',
      'showing clear subjects'
    ];

    return `${prompt}, ${contentAdditions.join(', ')}`;
  }

  /**
   * Expand HOW dimension (style: lighting, composition, atmosphere)
   * @private
   */
  _expandHowDimension(prompt) {
    // Deterministic expansion for testing
    const styleAdditions = [
      'with dramatic lighting',
      'composed using rule of thirds',
      'atmospheric depth'
    ];

    return `${prompt}, ${styleAdditions.join(', ')}`;
  }

  /**
   * Combine WHAT and HOW prompts into a unified prompt
   * @param {string} whatPrompt - Content description (what is in the image)
   * @param {string} howPrompt - Style description (how it looks)
   * @returns {Promise<Object>} Combined prompt with metadata
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

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Simple combination: merge both prompts
    const combinedPrompt = `${whatPrompt}, ${howPrompt}`;

    // Calculate mock token usage
    const tokensUsed = Math.floor(combinedPrompt.length / 4) + 30;

    return {
      combinedPrompt,
      metadata: {
        model: 'mock-gpt-4',
        tokensUsed,
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = MockLLMProvider;
