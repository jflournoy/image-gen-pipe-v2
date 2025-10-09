/**
 * TDD RED Phase: Scoring Provider Interface Tests
 *
 * Scoring providers combine multiple scores to rank candidates:
 * - Alignment score (text-image semantic similarity, 0-100)
 * - Aesthetic score (visual quality, 0-10)
 * - Combined score (weighted combination using alpha parameter)
 *
 * Based on SRS Section 3.2 - Scoring and Evaluation
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('ScoringProvider Interface', () => {
  describe('Provider contract', () => {
    it('should have a name property', () => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      const provider = new MockScoringProvider();

      assert.ok(provider.name, 'Provider must have a name');
      assert.strictEqual(typeof provider.name, 'string');
    });

    it('should have a scoreCandidate method', () => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      const provider = new MockScoringProvider();

      assert.ok(provider.scoreCandidate, 'Provider must have scoreCandidate method');
      assert.strictEqual(typeof provider.scoreCandidate, 'function');
    });

    it('should return a Promise from scoreCandidate', async () => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      const provider = new MockScoringProvider();

      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = provider.scoreCandidate(candidate);
      assert.ok(result instanceof Promise, 'scoreCandidate must return a Promise');
    });
  });

  describe('scoreCandidate method', () => {
    let provider;

    beforeEach(() => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      provider = new MockScoringProvider();
    });

    it('should accept a candidate object', async () => {
      const candidate = {
        prompt: 'a mountain landscape',
        imageUrl: 'https://example.com/mountain.png',
        alignmentScore: 85
      };

      // Should not throw
      await provider.scoreCandidate(candidate);
    });

    it('should accept optional options object', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const options = {
        alpha: 0.7
      };

      // Should not throw
      await provider.scoreCandidate(candidate, options);
    });

    it('should return an object with required fields', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = await provider.scoreCandidate(candidate);

      assert.ok(result, 'Result must not be null');
      assert.strictEqual(typeof result, 'object');
      assert.ok(typeof result.totalScore === 'number', 'Result must have totalScore as number');
      assert.ok(result.breakdown, 'Result must have breakdown object');
      assert.ok(result.metadata, 'Result must have metadata');
    });

    it('should return score breakdown', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 80
      };

      const result = await provider.scoreCandidate(candidate);

      assert.ok(result.breakdown, 'Must have breakdown');
      assert.ok(typeof result.breakdown.alignment === 'number', 'Breakdown must include alignment');
      assert.ok(typeof result.breakdown.aesthetic === 'number', 'Breakdown must include aesthetic');
    });

    it('should validate candidate object', async () => {
      await assert.rejects(
        async () => await provider.scoreCandidate(null),
        /candidate.*required/i,
        'Should reject null candidate'
      );

      await assert.rejects(
        async () => await provider.scoreCandidate({}),
        /prompt.*required|imageUrl.*required|alignmentScore.*required/i,
        'Should reject incomplete candidate'
      );
    });
  });

  describe('Alignment score normalization', () => {
    let provider;

    beforeEach(() => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      provider = new MockScoringProvider();
    });

    it('should normalize alignment score to 0-100 range', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = await provider.scoreCandidate(candidate);

      assert.ok(result.breakdown.alignment >= 0, 'Alignment must be >= 0');
      assert.ok(result.breakdown.alignment <= 100, 'Alignment must be <= 100');
    });

    it('should use provided alignment score', async () => {
      const alignmentScore = 85;
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore
      };

      const result = await provider.scoreCandidate(candidate);

      // Should use the provided score (potentially normalized)
      assert.strictEqual(result.breakdown.alignment, alignmentScore);
    });
  });

  describe('Aesthetic score calculation', () => {
    let provider;

    beforeEach(() => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      provider = new MockScoringProvider();
    });

    it('should calculate aesthetic score in 0-10 range', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = await provider.scoreCandidate(candidate);

      assert.ok(result.breakdown.aesthetic >= 0, 'Aesthetic score must be >= 0');
      assert.ok(result.breakdown.aesthetic <= 10, 'Aesthetic score must be <= 10');
    });

    it('should evaluate technical quality', async () => {
      const candidate = {
        prompt: 'high quality image',
        imageUrl: 'https://example.com/hq-image.png',
        alignmentScore: 90
      };

      const result = await provider.scoreCandidate(candidate);

      // Should produce a reasonable aesthetic score
      assert.ok(result.breakdown.aesthetic > 0);
    });

    it('should be deterministic for testing', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result1 = await provider.scoreCandidate(candidate);
      const result2 = await provider.scoreCandidate(candidate);

      // Mock provider should produce consistent results
      assert.strictEqual(result1.breakdown.aesthetic, result2.breakdown.aesthetic);
    });
  });

  describe('Combined score calculation', () => {
    let provider;

    beforeEach(() => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      provider = new MockScoringProvider();
    });

    it('should compute weighted combined score', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 80
      };

      const result = await provider.scoreCandidate(candidate);

      // Combined score should be calculated from alignment and aesthetic
      assert.ok(typeof result.totalScore === 'number');
      assert.ok(result.totalScore > 0);
    });

    it('should use default alpha when not specified', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = await provider.scoreCandidate(candidate);

      // Should successfully calculate with default alpha
      assert.ok(result.totalScore > 0);
    });

    it('should respect custom alpha parameter', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 80
      };

      // Alpha = 1.0 means 100% alignment, 0% aesthetic
      const result1 = await provider.scoreCandidate(candidate, { alpha: 1.0 });

      // Alpha = 0.0 means 0% alignment, 100% aesthetic
      const result2 = await provider.scoreCandidate(candidate, { alpha: 0.0 });

      // Scores should be different
      assert.notStrictEqual(result1.totalScore, result2.totalScore);
    });

    it('should validate alpha range', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      await assert.rejects(
        async () => await provider.scoreCandidate(candidate, { alpha: 1.5 }),
        /alpha.*range|alpha.*invalid/i,
        'Should reject alpha > 1.0'
      );

      await assert.rejects(
        async () => await provider.scoreCandidate(candidate, { alpha: -0.1 }),
        /alpha.*range|alpha.*invalid/i,
        'Should reject alpha < 0.0'
      );
    });

    it('should calculate score correctly with alpha = 0.7', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 80
      };

      const alpha = 0.7;
      const result = await provider.scoreCandidate(candidate, { alpha });

      // Formula: alpha * alignment + (1 - alpha) * (aesthetic * 10)
      // With aesthetic normalized to 0-100 scale for calculation
      const expectedScore =
        alpha * result.breakdown.alignment +
        (1 - alpha) * (result.breakdown.aesthetic * 10);

      assert.ok(
        Math.abs(result.totalScore - expectedScore) < 0.01,
        `Expected score ~${expectedScore}, got ${result.totalScore}`
      );
    });
  });

  describe('Score normalization', () => {
    let provider;

    beforeEach(() => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      provider = new MockScoringProvider();
    });

    it('should produce scores in valid range', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = await provider.scoreCandidate(candidate);

      // Total score should be 0-100
      assert.ok(result.totalScore >= 0);
      assert.ok(result.totalScore <= 100);
    });

    it('should handle edge cases', async () => {
      // Minimum scores
      const minCandidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/bad.png',
        alignmentScore: 0
      };

      const minResult = await provider.scoreCandidate(minCandidate);
      assert.ok(minResult.totalScore >= 0);

      // Maximum scores
      const maxCandidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/perfect.png',
        alignmentScore: 100
      };

      const maxResult = await provider.scoreCandidate(maxCandidate);
      assert.ok(maxResult.totalScore <= 100);
    });
  });

  describe('Metadata', () => {
    let provider;

    beforeEach(() => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      provider = new MockScoringProvider();
    });

    it('should include metadata in result', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = await provider.scoreCandidate(candidate);

      assert.ok(result.metadata);
      assert.strictEqual(typeof result.metadata, 'object');
    });

    it('should include model information', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const result = await provider.scoreCandidate(candidate);

      assert.ok(result.metadata.model);
      assert.strictEqual(typeof result.metadata.model, 'string');
    });

    it('should include alpha parameter used', async () => {
      const candidate = {
        prompt: 'test',
        imageUrl: 'https://example.com/image.png',
        alignmentScore: 75
      };

      const alpha = 0.8;
      const result = await provider.scoreCandidate(candidate, { alpha });

      assert.strictEqual(result.metadata.alpha, alpha);
    });
  });

  describe('Ranking capability', () => {
    let provider;

    beforeEach(() => {
      const MockScoringProvider = require('../../src/providers/mock-scoring-provider.js');
      provider = new MockScoringProvider();
    });

    it('should enable candidate ranking by total score', async () => {
      const candidate1 = {
        prompt: 'test',
        imageUrl: 'https://example.com/good.png',
        alignmentScore: 85
      };

      const candidate2 = {
        prompt: 'test',
        imageUrl: 'https://example.com/bad.png',
        alignmentScore: 60
      };

      const result1 = await provider.scoreCandidate(candidate1);
      const result2 = await provider.scoreCandidate(candidate2);

      // Higher alignment should generally produce higher total score
      assert.ok(result1.totalScore > result2.totalScore);
    });

    it('should support sorting candidates', async () => {
      const candidates = [
        { prompt: 'test', imageUrl: 'https://example.com/a.png', alignmentScore: 70 },
        { prompt: 'test', imageUrl: 'https://example.com/b.png', alignmentScore: 90 },
        { prompt: 'test', imageUrl: 'https://example.com/c.png', alignmentScore: 80 }
      ];

      const results = await Promise.all(
        candidates.map(c => provider.scoreCandidate(c))
      );

      // Should be able to sort by totalScore
      results.sort((a, b) => b.totalScore - a.totalScore);

      assert.ok(results[0].totalScore >= results[1].totalScore);
      assert.ok(results[1].totalScore >= results[2].totalScore);
    });
  });
});
