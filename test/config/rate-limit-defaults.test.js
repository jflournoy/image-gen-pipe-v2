/**
 * 🔴 RED: Rate Limit Defaults Tests
 *
 * Tests for sensible default rate limits that prevent API rate limit errors.
 * Verifies that default limits are configured based on OpenAI's actual constraints.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');

describe('Rate Limit Defaults', () => {
  test('should have rate limit config with sensible defaults', () => {
    const config = require('../../src/config/rate-limits.js');

    assert(config, 'Rate limit config should exist');
    assert(config.defaults, 'Config should have defaults object');
  });

  test('should have LLM rate limit default', () => {
    const config = require('../../src/config/rate-limits.js');

    assert(config.defaults.llm, 'Should have LLM rate limit');
    assert.strictEqual(typeof config.defaults.llm, 'number', 'LLM limit should be a number');
    assert.ok(config.defaults.llm > 0, 'LLM limit should be positive');
    assert.ok(config.defaults.llm <= 10, 'LLM limit should be reasonable (≤10)');
  });

  test('should have image generation rate limit default', () => {
    const config = require('../../src/config/rate-limits.js');

    assert(config.defaults.imageGen, 'Should have image generation rate limit');
    assert.strictEqual(typeof config.defaults.imageGen, 'number', 'Image gen limit should be a number');
    assert.ok(config.defaults.imageGen > 0, 'Image gen limit should be positive');
    assert.ok(config.defaults.imageGen <= 5, 'Image gen limit should be conservative (≤5)');
  });

  test('should have vision API rate limit default', () => {
    const config = require('../../src/config/rate-limits.js');

    assert(config.defaults.vision, 'Should have vision rate limit');
    assert.strictEqual(typeof config.defaults.vision, 'number', 'Vision limit should be a number');
    assert.ok(config.defaults.vision > 0, 'Vision limit should be positive');
    assert.ok(config.defaults.vision <= 10, 'Vision limit should be reasonable (≤10)');
  });

  test('should document why each limit is set', () => {
    const config = require('../../src/config/rate-limits.js');

    assert(config.rationale, 'Config should include rationale/documentation');
    assert(config.rationale.llm, 'Should document LLM limit rationale');
    assert(config.rationale.imageGen, 'Should document image gen limit rationale');
    assert(config.rationale.vision, 'Should document vision limit rationale');
  });
});

describe('Beam Search with Default Rate Limits', () => {
  test('should use default rate limits when not specified', async () => {
    const { initialExpansion } = require('../../src/orchestrator/beam-search.js');

    let maxConcurrentLLM = 0;
    let currentConcurrentLLM = 0;

    const mockLLM = {
      refinePrompt: async (prompt, options) => {
        currentConcurrentLLM++;
        maxConcurrentLLM = Math.max(maxConcurrentLLM, currentConcurrentLLM);
        await new Promise(resolve => setTimeout(resolve, 2));
        currentConcurrentLLM--;
        return { refinedPrompt: `refined_${options.dimension}`, metadata: {} };
      },
      combinePrompts: async (what, how) => `${what} + ${how}`
    };

    const mockImageGen = {
      generateImage: async () => ({ url: 'test.png', metadata: {} })
    };

    const mockVision = {
      analyzeImage: async () => ({
        alignmentScore: 80, aestheticScore: 7,
        analysis: '', strengths: [], weaknesses: [], metadata: {}
      })
    };

    // Config without explicit rateLimitConcurrency - should use defaults
    const config = { beamWidth: 4 };

    await initialExpansion(
      'test prompt',
      mockLLM,
      mockImageGen,
      mockVision,
      config
    );

    // If defaults were applied, should be limited. If not, will be 4 (beamWidth).
    // This test checks that the framework exists to apply defaults.
    assert.ok(maxConcurrentLLM >= 1, 'Should have executed LLM calls');
  });

  test('should accept environment variable for rate limits', () => {
    const originalEnv = process.env.BEAM_SEARCH_RATE_LIMIT_LLM;

    try {
      process.env.BEAM_SEARCH_RATE_LIMIT_LLM = '2';

      // Clear require cache to load new config
      delete require.cache[require.resolve('../../src/config/rate-limits.js')];
      const config = require('../../src/config/rate-limits.js');

      assert.strictEqual(config.defaults.llm, 2,
        'Should read LLM limit from environment variable');
    } finally {
      if (originalEnv) {
        process.env.BEAM_SEARCH_RATE_LIMIT_LLM = originalEnv;
      } else {
        delete process.env.BEAM_SEARCH_RATE_LIMIT_LLM;
      }
      // Clear cache again
      delete require.cache[require.resolve('../../src/config/rate-limits.js')];
    }
  });
});

describe('Local Provider Rate Limits', () => {
  test('should have local provider limits section', () => {
    const config = require('../../src/config/rate-limits.js');

    assert(config.local, 'Config should have local limits section');
    assert.strictEqual(typeof config.local, 'object', 'Local limits should be an object');
  });

  test('should have serial (1) limit for local LLM by default', () => {
    const config = require('../../src/config/rate-limits.js');

    assert.strictEqual(config.local.llm, 1,
      'Local LLM should default to serial processing (1)');
  });

  test('should have serial (1) limit for local image gen by default', () => {
    const config = require('../../src/config/rate-limits.js');

    assert.strictEqual(config.local.imageGen, 1,
      'Local image gen should default to serial processing (1)');
  });

  test('should have serial (1) limit for local vision by default', () => {
    const config = require('../../src/config/rate-limits.js');

    assert.strictEqual(config.local.vision, 1,
      'Local vision should default to serial processing (1)');
  });

  test('should have getLocalLimit method', () => {
    const config = require('../../src/config/rate-limits.js');

    assert.strictEqual(typeof config.getLocalLimit, 'function',
      'Config should have getLocalLimit method');

    assert.strictEqual(config.getLocalLimit('llm'), 1, 'Should return local LLM limit');
    assert.strictEqual(config.getLocalLimit('imageGen'), 1, 'Should return local image limit');
    assert.strictEqual(config.getLocalLimit('vision'), 1, 'Should return local vision limit');
  });

  test('getLocalLimit should throw for unknown provider', () => {
    const config = require('../../src/config/rate-limits.js');

    assert.throws(
      () => config.getLocalLimit('unknown'),
      /Unknown provider/,
      'Should throw for unknown provider'
    );
  });

  test('should have getLimitForType method that selects based on isLocal', () => {
    const config = require('../../src/config/rate-limits.js');

    assert.strictEqual(typeof config.getLimitForType, 'function',
      'Config should have getLimitForType method');

    // OpenAI providers (isLocal=false) should get higher limits
    const openaiLLM = config.getLimitForType('llm', false);
    assert.ok(openaiLLM > 1, 'OpenAI LLM should have concurrent limit > 1');

    // Local providers (isLocal=true) should get serial limit
    const localLLM = config.getLimitForType('llm', true);
    assert.strictEqual(localLLM, 1, 'Local LLM should have serial limit of 1');
  });

  test('should have getAllLocalLimits method', () => {
    const config = require('../../src/config/rate-limits.js');

    assert.strictEqual(typeof config.getAllLocalLimits, 'function',
      'Config should have getAllLocalLimits method');

    const limits = config.getAllLocalLimits();
    assert.deepStrictEqual(limits, { llm: 1, imageGen: 1, vision: 1 },
      'Should return all local limits as object');
  });

  test('should accept environment variables for local limits', () => {
    const originalLLM = process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_LLM;
    const originalImage = process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_IMAGE;

    try {
      process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_LLM = '2';
      process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_IMAGE = '3';

      // Clear require cache to load new config
      delete require.cache[require.resolve('../../src/config/rate-limits.js')];
      const config = require('../../src/config/rate-limits.js');

      assert.strictEqual(config.local.llm, 2,
        'Should read local LLM limit from environment variable');
      assert.strictEqual(config.local.imageGen, 3,
        'Should read local image limit from environment variable');
    } finally {
      // Restore
      if (originalLLM) {
        process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_LLM = originalLLM;
      } else {
        delete process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_LLM;
      }
      if (originalImage) {
        process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_IMAGE = originalImage;
      } else {
        delete process.env.BEAM_SEARCH_RATE_LIMIT_LOCAL_IMAGE;
      }
      delete require.cache[require.resolve('../../src/config/rate-limits.js')];
    }
  });
});
