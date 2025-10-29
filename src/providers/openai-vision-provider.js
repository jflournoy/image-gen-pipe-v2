/**
 * TDD GREEN Phase: OpenAI Vision Provider
 *
 * Real OpenAI GPT-4 Vision API implementation for image evaluation.
 * Evaluates generated images for prompt fidelity and provides actionable feedback.
 */

const OpenAI = require('openai');

class OpenAIVisionProvider {
  constructor(apiKey, options = {}) {
    // Validate API key
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('API key is required');
    }

    this.name = 'openai-vision-provider';
    this.apiKey = apiKey;

    // Configuration options
    // Note: gpt-4-vision-preview is deprecated, use gpt-4o or gpt-4o-mini
    this.model = options.model || 'gpt-4o';
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
   * Analyze an image and calculate alignment with prompt and aesthetic quality
   * @param {string} imageUrl - URL of the image to analyze
   * @param {string} prompt - The prompt that was used to generate the image
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Analysis result with alignment score (0-100), aesthetic score (0-10), and detailed feedback
   */
  async analyzeImage(imageUrl, prompt, _options = {}) {
    // Validate imageUrl
    if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
      throw new Error('imageUrl is required and cannot be empty');
    }

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('prompt is required and cannot be empty');
    }

    // Build evaluation prompt
    const systemPrompt = `You are an expert image evaluator. Your task is to analyze how well an image matches a given prompt AND evaluate its aesthetic quality.

Evaluate the image based on:
1. Content accuracy - Does the image contain the elements described in the prompt?
2. Style execution - Does the visual style match what was requested?
3. Overall fidelity - How faithfully does the image represent the prompt?
4. Aesthetic quality - Visual appeal, composition, color harmony, technical execution

Provide:
- A prompt fidelity score from 0.0 to 1.0 (where 1.0 is perfect match)
- An aesthetic score from 0.0 to 10.0 (where 10.0 is exceptional visual quality)
- A brief analysis explaining your scores
- Strengths: What the image does well
- Weaknesses: What could be improved

Respond in this exact JSON format:
{
  "promptFidelity": 0.85,
  "aestheticScore": 7.5,
  "analysis": "Brief explanation of the scores",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"]
}`;

    const userPrompt = `Evaluate this image against the prompt: "${prompt}"

Provide your evaluation in the JSON format specified.`;

    try {
      // Call OpenAI Vision API
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent evaluation
        max_tokens: 500
      });

      const responseText = completion.choices[0].message.content.trim();

      // Parse JSON response
      let evaluation;
      try {
        // Try to extract JSON from markdown code blocks if present
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                         responseText.match(/```\n([\s\S]*?)\n```/) ||
                         [null, responseText];
        evaluation = JSON.parse(jsonMatch[1] || responseText);
      } catch {
        // If JSON parsing fails, create a default response
        evaluation = {
          promptFidelity: 0.5,
          aestheticScore: 5.0,
          analysis: responseText,
          strengths: [],
          weaknesses: ['Unable to parse structured evaluation']
        };
      }

      // Validate and convert promptFidelity (0-1) to alignmentScore (0-100)
      let alignmentScore = evaluation.promptFidelity || 0.5;
      if (typeof alignmentScore !== 'number' || alignmentScore < 0 || alignmentScore > 1) {
        alignmentScore = 0.5;
      }
      // Convert to 0-100 scale
      alignmentScore = Math.round(alignmentScore * 100);

      // Validate aestheticScore (0-10 scale)
      let aestheticScore = evaluation.aestheticScore || 5.0;
      if (typeof aestheticScore !== 'number' || aestheticScore < 0 || aestheticScore > 10) {
        aestheticScore = 5.0;
      }

      // Ensure arrays exist
      evaluation.strengths = evaluation.strengths || [];
      evaluation.weaknesses = evaluation.weaknesses || [];

      return {
        analysis: evaluation.analysis || 'No analysis provided',
        alignmentScore: alignmentScore,
        aestheticScore: aestheticScore,
        strengths: evaluation.strengths,
        weaknesses: evaluation.weaknesses,
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
}

module.exports = OpenAIVisionProvider;
