/**
 * TDD RED Phase: Image Ranker Error Handling
 *
 * Tests graceful handling of vision API failures during ranking.
 * A single candidate failure should NOT crash the entire beam search.
 *
 * Scenarios to test:
 * 1. Vision API returns empty content (finish_reason: "length")
 * 2. Vision API timeout
 * 3. Vision API rate limit error
 * 4. Invalid JSON response
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert');
const ImageRanker = require('../../src/services/image-ranker.js');

/**
 * Mock OpenAI client that simulates API failures
 */
class MockOpenAIWithFailures {
  constructor(options = {}) {
    this.failureMode = options.failureMode || 'none';
    this.failureCount = 0;
    this.maxFailures = options.maxFailures || Infinity;
  }

  get chat() {
    return {
      completions: {
        create: async (params) => {
          this.failureCount++;

          // Simulate failure modes
          if (this.failureCount <= this.maxFailures) {
            if (this.failureMode === 'empty_content') {
              // Simulate finish_reason: "length" with empty content
              return {
                choices: [{
                  message: { content: '', refusal: null },
                  finish_reason: 'length'
                }],
                usage: { total_tokens: 100 }
              };
            }

            if (this.failureMode === 'no_choices') {
              // Simulate API returning no choices
              return {
                choices: [],
                usage: { total_tokens: 0 }
              };
            }

            if (this.failureMode === 'timeout') {
              throw new Error('Request timed out');
            }

            if (this.failureMode === 'rate_limit') {
              const error = new Error('Rate limit exceeded');
              error.status = 429;
              throw error;
            }

            if (this.failureMode === 'invalid_json') {
              return {
                choices: [{
                  message: { content: 'This is not JSON', refusal: null },
                  finish_reason: 'stop'
                }],
                usage: { total_tokens: 50 }
              };
            }
          }

          // After maxFailures, return successful response
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  winner: 'A',
                  reason: 'Image A is better',
                  ranks: {
                    A: { alignment: 1, aesthetics: 1 },
                    B: { alignment: 2, aesthetics: 2 }
                  },
                  winnerStrengths: ['Good composition'],
                  loserWeaknesses: ['Poor lighting']
                }),
                refusal: null
              },
              finish_reason: 'stop'
            }],
            usage: { total_tokens: 200 }
          };
        }
      }
    };
  }
}

describe('ImageRanker Error Handling (TDD RED)', () => {
  test('should throw error when vision API returns empty content (no graceful degradation)', async () => {
    const mockClient = new MockOpenAIWithFailures({ failureMode: 'empty_content' });
    const ranker = new ImageRanker({ apiKey: 'test-key' });
    ranker.client = mockClient;

    const images = [
      { candidateId: 'i0c0', url: 'data:image/png;base64,test1' },
      { candidateId: 'i0c1', url: 'data:image/png;base64,test2' }
    ];

    // Without gracefulDegradation, should throw
    await assert.rejects(
      async () => await ranker.rankImages(images, 'test prompt', { gracefulDegradation: false }),
      /Vision API returned empty content/
    );
  });

  test('should throw error when vision API returns no choices (no graceful degradation)', async () => {
    const mockClient = new MockOpenAIWithFailures({ failureMode: 'no_choices' });
    const ranker = new ImageRanker({ apiKey: 'test-key' });
    ranker.client = mockClient;

    const images = [
      { candidateId: 'i0c0', url: 'data:image/png;base64,test1' },
      { candidateId: 'i0c1', url: 'data:image/png;base64,test2' }
    ];

    await assert.rejects(
      async () => await ranker.rankImages(images, 'test prompt', { gracefulDegradation: false }),
      /Vision API returned no choices/
    );
  });

  test('should throw error on timeout (no graceful degradation)', async () => {
    const mockClient = new MockOpenAIWithFailures({ failureMode: 'timeout' });
    const ranker = new ImageRanker({ apiKey: 'test-key' });
    ranker.client = mockClient;

    const images = [
      { candidateId: 'i0c0', url: 'data:image/png;base64,test1' },
      { candidateId: 'i0c1', url: 'data:image/png;base64,test2' }
    ];

    await assert.rejects(
      async () => await ranker.rankImages(images, 'test prompt', { gracefulDegradation: false }),
      /Request timed out/
    );
  });

  test('should throw error on invalid JSON response (no graceful degradation)', async () => {
    const mockClient = new MockOpenAIWithFailures({ failureMode: 'invalid_json' });
    const ranker = new ImageRanker({ apiKey: 'test-key' });
    ranker.client = mockClient;

    const images = [
      { candidateId: 'i0c0', url: 'data:image/png;base64,test1' },
      { candidateId: 'i0c1', url: 'data:image/png;base64,test2' }
    ];

    await assert.rejects(
      async () => await ranker.rankImages(images, 'test prompt', { gracefulDegradation: false }),
      /Failed to parse vision response/
    );
  });
});

describe('ImageRanker Graceful Degradation (TDD RED - these will fail initially)', () => {
  test('should handle comparison failure gracefully and skip failed pair', async () => {
    // Setup: First comparison fails, second succeeds
    const mockClient = new MockOpenAIWithFailures({
      failureMode: 'empty_content',
      maxFailures: 1 // Only fail first call
    });
    const ranker = new ImageRanker({ apiKey: 'test-key' });
    ranker.client = mockClient;

    const images = [
      { candidateId: 'i0c0', url: 'data:image/png;base64,test1' },
      { candidateId: 'i0c1', url: 'data:image/png;base64,test2' },
      { candidateId: 'i0c2', url: 'data:image/png;base64,test3' }
    ];

    // This test expects ranking to complete with partial results
    // In TDD RED phase, this will fail because ImageRanker throws on first error
    const result = await ranker.rankImages(images, 'test prompt', { gracefulDegradation: true });

    // Should return partial rankings (only candidates that could be compared)
    assert.ok(result.rankings, 'Should return rankings object');
    assert.ok(result.rankings.length > 0, 'Should have some rankings despite failure');

    // Should have error metadata
    assert.ok(result.metadata, 'Should return metadata');
    assert.ok(result.metadata.errors, 'Should track errors');
    assert.strictEqual(result.metadata.errors.length, 1, 'Should have 1 error');
    assert.match(result.metadata.errors[0].message, /Vision API returned empty content/);
  });

  test('should return all candidates with sequential ranks when all comparisons fail', async () => {
    const mockClient = new MockOpenAIWithFailures({
      failureMode: 'empty_content',
      maxFailures: 10 // All calls fail
    });
    const ranker = new ImageRanker({ apiKey: 'test-key' });
    ranker.client = mockClient;

    const images = [
      { candidateId: 'i0c0', url: 'data:image/png;base64,test1' },
      { candidateId: 'i0c1', url: 'data:image/png;base64,test2' }
    ];

    // When all comparisons fail, should still return rankings (with 0 wins = arbitrary order)
    const result = await ranker.rankImages(images, 'test prompt', { gracefulDegradation: true });

    // All candidates should be ranked despite failures
    assert.strictEqual(result.rankings.length, 2, 'Should have all candidates despite failures');

    // Should have sequential ranks (even though comparison failed, algorithm still ranks them)
    const ranks = result.rankings.map(r => r.rank).sort();
    assert.deepStrictEqual(ranks, [1, 2], 'Should have sequential ranks 1 and 2');

    // Should have error metadata
    assert.ok(result.metadata.errors, 'Should track errors');
    assert.ok(result.metadata.errors.length > 0, 'Should have errors logged');
  });

  test('should retry comparison on transient errors', async () => {
    // Simulate rate limit that succeeds on retry
    const mockClient = new MockOpenAIWithFailures({
      failureMode: 'rate_limit',
      maxFailures: 1 // Fail once, then succeed
    });
    const ranker = new ImageRanker({ apiKey: 'test-key', maxRetries: 2 });
    ranker.client = mockClient;

    const images = [
      { candidateId: 'i0c0', url: 'data:image/png;base64,test1' },
      { candidateId: 'i0c1', url: 'data:image/png;base64,test2' }
    ];

    // Should retry and eventually succeed
    const result = await ranker.rankImages(images, 'test prompt', { gracefulDegradation: true });

    assert.ok(result.rankings, 'Should return rankings after retry');
    assert.strictEqual(result.rankings.length, 2, 'Should rank all candidates after retry');
  });
});
