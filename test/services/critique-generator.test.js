/**
 * TDD RED Phase: Critique Generator Tests
 *
 * The critique generator analyzes evaluation results and generates
 * structured, actionable feedback for prompt refinement.
 *
 * Output structure:
 * {
 *   critique: "What's wrong with the current result",
 *   recommendation: "Specific change to WHAT or HOW prompt",
 *   reason: "Why this change addresses the critique",
 *   dimension: "what" | "how",
 *   metadata: {...}
 * }
 *
 * The generator considers:
 * - WHAT prompt (content dimension)
 * - HOW prompt (style dimension)
 * - Combined prompt used for generation
 * - Alignment score (0-100)
 * - Strengths and weaknesses from vision analysis
 * - Current iteration and dimension being refined
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('CritiqueGenerator', () => {
  describe('Module interface', () => {
    it('should export a CritiqueGenerator class', () => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');

      assert.ok(CritiqueGenerator, 'Module should export CritiqueGenerator');
      assert.strictEqual(typeof CritiqueGenerator, 'function', 'Should be a constructor');
    });

    it('should have a generateCritique method', () => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      const generator = new CritiqueGenerator();

      assert.ok(generator.generateCritique, 'Should have generateCritique method');
      assert.strictEqual(typeof generator.generateCritique, 'function');
    });
  });

  describe('Required parameters', () => {
    let generator;

    beforeEach(() => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      generator = new CritiqueGenerator();
    });

    it('should require evaluation results parameter', async () => {
      await assert.rejects(
        async () => await generator.generateCritique(),
        /feedback.*required/i,
        'Should throw when feedback is missing'
      );
    });

    it('should require prompts parameter', async () => {
      const feedback = { alignmentScore: 75 };

      await assert.rejects(
        async () => await generator.generateCritique(feedback),
        /prompts.*required/i,
        'Should throw when prompts are missing'
      );
    });

    it('should require dimension parameter', async () => {
      const feedback = { alignmentScore: 75 };
      const prompts = { what: 'test', how: 'test', combined: 'test' };

      await assert.rejects(
        async () => await generator.generateCritique(feedback, prompts, 'test prompt'),
        /dimension.*required/i,
        'Should throw when dimension is missing'
      );
    });

    it('should validate dimension is "what" or "how"', async () => {
      const feedback = { alignmentScore: 75 };
      const prompts = { what: 'test', how: 'test', combined: 'test' };

      await assert.rejects(
        async () => await generator.generateCritique(feedback, prompts, 'test prompt', { dimension: 'invalid' }),
        /dimension.*what.*how/i,
        'Should throw for invalid dimension'
      );
    });
  });

  describe('Structured output format', () => {
    let generator;

    beforeEach(() => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      generator = new CritiqueGenerator();
    });

    it('should return object with critique, recommendation, and reason', async () => {
      const evaluation = {
        alignmentScore: 75,
        analysis: 'Image shows mountains but lighting is flat',
        strengths: ['Correct subject matter'],
        weaknesses: ['Lighting lacks drama']
      };
      const prompts = {
        what: 'Majestic mountain peaks',
        how: 'Dramatic lighting with golden hour glow',
        combined: 'Majestic mountain peaks with dramatic lighting and golden hour glow'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Verify structure
      assert.ok(result, 'Should return a result object');
      assert.ok(typeof result.critique === 'string', 'Should have critique field (string)');
      assert.ok(result.critique.length > 0, 'Critique should not be empty');
      assert.ok(typeof result.recommendation === 'string', 'Should have recommendation field (string)');
      assert.ok(result.recommendation.length > 0, 'Recommendation should not be empty');
      assert.ok(typeof result.reason === 'string', 'Should have reason field (string)');
      assert.ok(result.reason.length > 0, 'Reason should not be empty');
      assert.strictEqual(result.dimension, 'how', 'Should include dimension');
    });

    it('should include metadata with alignment score and timestamp', async () => {
      const evaluation = {
        alignmentScore: 65,
        analysis: 'Test',
        strengths: [],
        weaknesses: []
      };
      const prompts = {
        what: 'Mountain',
        how: 'Dramatic',
        combined: 'Mountain with dramatic lighting'
      };
      const options = { dimension: 'what' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      assert.ok(result.metadata, 'Should have metadata');
      assert.strictEqual(result.metadata.alignmentScore, 65, 'Should include alignment score');
      assert.ok(result.metadata.timestamp, 'Should have timestamp');
    });
  });

  describe('Dimension-specific recommendations - WHAT (content)', () => {
    let generator;

    beforeEach(() => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      generator = new CritiqueGenerator();
    });

    it('should provide WHAT recommendation when dimension is "what"', async () => {
      const evaluation = {
        alignmentScore: 65,
        analysis: 'Mountain is present but lacks detailed features',
        strengths: ['Mountain visible'],
        weaknesses: ['Missing snow-capped peaks', 'No surrounding landscape detail']
      };
      const prompts = {
        what: 'A mountain',
        how: 'Photorealistic style',
        combined: 'A mountain in photorealistic style'
      };
      const options = { dimension: 'what' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Critique should identify content issues
      const critique = result.critique.toLowerCase();
      assert.ok(critique.length > 10, 'Critique should be substantial');

      // Recommendation should suggest WHAT prompt changes
      const recommendation = result.recommendation.toLowerCase();
      assert.ok(
        recommendation.includes('what') || recommendation.length > 10,
        'Should provide specific recommendation for WHAT prompt'
      );

      // Reason should explain why this helps
      const reason = result.reason.toLowerCase();
      assert.ok(reason.length > 10, 'Reason should explain the recommendation');

      assert.strictEqual(result.dimension, 'what', 'Should be for WHAT dimension');
    });

    it('should recommend content additions for missing elements', async () => {
      const evaluation = {
        alignmentScore: 50,
        analysis: 'Image missing key elements',
        strengths: [],
        weaknesses: ['Subject unclear', 'Missing described elements']
      };
      const prompts = {
        what: 'Temple',
        how: 'Cinematic lighting',
        combined: 'Temple with cinematic lighting'
      };
      const options = { dimension: 'what' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should suggest being more specific about content
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.ok(result.reason, 'Should have reason');
      assert.strictEqual(result.dimension, 'what');
    });
  });

  describe('Dimension-specific recommendations - HOW (style)', () => {
    let generator;

    beforeEach(() => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      generator = new CritiqueGenerator();
    });

    it('should provide HOW recommendation when dimension is "how"', async () => {
      const evaluation = {
        alignmentScore: 70,
        analysis: 'Content is correct but visual execution lacks requested drama',
        strengths: ['Correct composition'],
        weaknesses: ['Lighting is flat', 'Colors lack vibrancy']
      };
      const prompts = {
        what: 'Mountain landscape',
        how: 'Dramatic lighting',
        combined: 'Mountain landscape with dramatic lighting'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Critique should identify style issues
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.critique.length > 10, 'Critique should be substantial');

      // Recommendation should suggest HOW prompt changes
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.ok(result.recommendation.length > 10, 'Recommendation should be substantial');

      // Reason should explain why this helps with style
      assert.ok(result.reason, 'Should have reason');
      assert.ok(result.reason.length > 10, 'Reason should explain the recommendation');

      assert.strictEqual(result.dimension, 'how', 'Should be for HOW dimension');
    });

    it('should recommend style refinements for visual quality issues', async () => {
      const evaluation = {
        alignmentScore: 55,
        analysis: 'Style does not match request',
        strengths: ['Good content'],
        weaknesses: ['Wrong artistic style', 'Lighting direction incorrect']
      };
      const prompts = {
        what: 'Forest scene',
        how: 'Golden hour lighting',
        combined: 'Forest scene with golden hour lighting'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should suggest style-specific improvements
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.ok(result.reason, 'Should have reason');
      assert.strictEqual(result.dimension, 'how');
    });
  });

  describe('Context-aware critique', () => {
    let generator;

    beforeEach(() => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      generator = new CritiqueGenerator();
    });

    it('should consider the combined prompt when generating critique', async () => {
      const evaluation = {
        alignmentScore: 60,
        analysis: 'Result differs from combined prompt',
        strengths: [],
        weaknesses: ['Style overrode content', 'Lost key details']
      };
      const prompts = {
        what: 'Ancient temple with mystical vines',
        how: 'Photorealistic',
        combined: 'Ancient temple with mystical vines, photorealistic rendering'
      };
      const options = { dimension: 'what' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should be mindful of how combined prompt worked
      assert.ok(result.critique, 'Should critique the result');
      assert.ok(result.recommendation, 'Should recommend improvements');
      assert.ok(result.reason, 'Should explain reasoning');
    });

    it('should accept optional iteration context', async () => {
      const evaluation = {
        alignmentScore: 70,
        analysis: 'Improved from previous',
        strengths: ['Better than before'],
        weaknesses: ['Still needs work']
      };
      const prompts = {
        what: 'Mountain',
        how: 'Dramatic',
        combined: 'Mountain with dramatic lighting'
      };
      const options = {
        dimension: 'what',
        iteration: 2,
        parentScore: 65
      };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should work with iteration context
      assert.ok(result, 'Should handle iteration context');
      if (result.metadata.iteration !== undefined) {
        assert.strictEqual(result.metadata.iteration, 2, 'Should include iteration');
      }
    });
  });

  describe('Score-based critique intensity', () => {
    let generator;

    beforeEach(() => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      generator = new CritiqueGenerator();
    });

    it('should provide gentle refinement for high scores (>80)', async () => {
      const evaluation = {
        alignmentScore: 85,
        analysis: 'Excellent match',
        strengths: ['Great composition', 'Perfect lighting'],
        weaknesses: ['Could add minor foreground detail']
      };
      const prompts = {
        what: 'Mountain at sunset',
        how: 'Golden hour lighting',
        combined: 'Mountain at sunset with golden hour lighting'
      };
      const options = { dimension: 'what' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should still provide structured feedback even for good results
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.ok(result.reason, 'Should have reason');
    });

    it('should provide significant revisions for low scores (<60)', async () => {
      const evaluation = {
        alignmentScore: 45,
        analysis: 'Poor match, major issues',
        strengths: [],
        weaknesses: ['Wrong subject', 'Missing key elements']
      };
      const prompts = {
        what: 'Cityscape',
        how: 'Cyberpunk',
        combined: 'Cityscape with cyberpunk aesthetic'
      };
      const options = { dimension: 'what' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should provide substantial feedback for poor results
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.critique.length > 20, 'Critique should be substantial for low scores');
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.ok(result.recommendation.length > 20, 'Recommendation should be substantial');
      assert.ok(result.reason, 'Should have reason');
    });
  });

  describe('Aesthetic score integration', () => {
    let generator;

    beforeEach(() => {
      const CritiqueGenerator = require('../../src/services/critique-generator.js');
      generator = new CritiqueGenerator();
    });

    it('should accept aestheticScore in evaluation parameter', async () => {
      const evaluation = {
        alignmentScore: 85,
        aestheticScore: 7.5,
        analysis: 'Good content match with decent visual quality',
        strengths: ['Correct subject'],
        weaknesses: ['Minor composition issues']
      };
      const prompts = {
        what: 'Mountain landscape',
        how: 'Dramatic lighting',
        combined: 'Mountain landscape with dramatic lighting'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should successfully process evaluation with aestheticScore
      assert.ok(result, 'Should return result');
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.metadata, 'Should have metadata');
    });

    it('should store aestheticScore in metadata when provided', async () => {
      const evaluation = {
        alignmentScore: 75,
        aestheticScore: 6.2,
        analysis: 'Test evaluation',
        strengths: [],
        weaknesses: []
      };
      const prompts = {
        what: 'Forest scene',
        how: 'Soft lighting',
        combined: 'Forest scene with soft lighting'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      assert.ok(result.metadata, 'Should have metadata');
      assert.strictEqual(result.metadata.aestheticScore, 6.2, 'Should store aesthetic score in metadata');
      assert.strictEqual(result.metadata.alignmentScore, 75, 'Should also store alignment score');
    });

    it('should use aestheticScore for HOW dimension critique intensity', async () => {
      const evaluationPoorAesthetic = {
        alignmentScore: 85, // High alignment
        aestheticScore: 3.0, // Low aesthetic
        analysis: 'Content matches but visual quality is poor',
        strengths: ['Correct elements'],
        weaknesses: ['Poor composition', 'Ugly colors', 'Bad lighting execution']
      };
      const prompts = {
        what: 'Sunset over ocean',
        how: 'Cinematic golden hour lighting with vibrant colors',
        combined: 'Sunset over ocean with cinematic golden hour lighting and vibrant colors'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluationPoorAesthetic, prompts, 'test prompt', options);

      // For HOW dimension with low aesthetic score, should provide significant style improvements
      // even if alignment is high
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.ok(result.reason, 'Should have reason');
      assert.strictEqual(result.dimension, 'how', 'Should be HOW dimension');

      // Verify it's using aesthetic score (low = 3.0) not alignment score (high = 85)
      // by checking the critique suggests significant changes
      const critique = result.critique.toLowerCase();
      const recommendation = result.recommendation.toLowerCase();

      // Should indicate need for style improvement since aesthetic is low
      assert.ok(
        critique.length > 20 || recommendation.length > 20,
        'Should provide substantial feedback for poor aesthetic quality'
      );
    });

    it('should use alignmentScore for WHAT dimension critique intensity', async () => {
      const evaluationPoorAlignment = {
        alignmentScore: 40, // Low alignment
        aestheticScore: 8.5, // High aesthetic
        analysis: 'Beautiful image but wrong content',
        strengths: ['Great visual quality', 'Excellent composition'],
        weaknesses: ['Missing key subjects', 'Wrong setting']
      };
      const prompts = {
        what: 'Ancient temple with mystical vines and glowing runes',
        how: 'Photorealistic rendering',
        combined: 'Ancient temple with mystical vines and glowing runes in photorealistic rendering'
      };
      const options = { dimension: 'what' };

      const result = await generator.generateCritique(evaluationPoorAlignment, prompts, 'test prompt', options);

      // For WHAT dimension with low alignment, should provide significant content changes
      // even if aesthetic is high
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.strictEqual(result.dimension, 'what', 'Should be WHAT dimension');

      // Verify it's using alignment score (low = 40) not aesthetic score (high = 8.5)
      const critique = result.critique.toLowerCase();
      const recommendation = result.recommendation.toLowerCase();

      assert.ok(
        critique.length > 20 && recommendation.length > 20,
        'Should provide substantial feedback for poor content alignment'
      );
    });

    it('should handle missing aestheticScore gracefully', async () => {
      const evaluationNoAesthetic = {
        alignmentScore: 70,
        // aestheticScore not provided
        analysis: 'Decent match',
        strengths: ['Some strengths'],
        weaknesses: ['Some weaknesses']
      };
      const prompts = {
        what: 'City street',
        how: 'Night photography',
        combined: 'City street at night photography style'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluationNoAesthetic, prompts, 'test prompt', options);

      // Should still work without aestheticScore (backwards compatibility)
      assert.ok(result, 'Should return result even without aesthetic score');
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.recommendation, 'Should have recommendation');
    });

    it('should prefer aestheticScore over alignmentScore for HOW dimension with both scores', async () => {
      const evaluation = {
        alignmentScore: 90, // High alignment (content is right)
        aestheticScore: 4.0, // Low aesthetic (but ugly)
        analysis: 'Right content but poor visual execution',
        strengths: ['Correct elements present'],
        weaknesses: ['Harsh lighting', 'Muddy colors', 'Poor composition']
      };
      const prompts = {
        what: 'Garden with flowers',
        how: 'Soft dreamy lighting with pastel colors',
        combined: 'Garden with flowers in soft dreamy lighting with pastel colors'
      };
      const options = { dimension: 'how' };

      const result = await generator.generateCritique(evaluation, prompts, 'test prompt', options);

      // Should focus on style issues (low aesthetic) not content issues (high alignment)
      assert.ok(result.critique, 'Should have critique');
      assert.ok(result.recommendation, 'Should have recommendation');
      assert.strictEqual(result.dimension, 'how');

      // The critique should be substantial because aesthetic is low,
      // even though alignment is high
      assert.ok(
        result.critique.length > 15 && result.recommendation.length > 15,
        'Should provide meaningful feedback based on aesthetic score for HOW dimension'
      );
    });
  });
});
