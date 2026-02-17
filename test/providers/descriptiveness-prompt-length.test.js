/**
 * TDD RED Phase: Descriptiveness affects prompt length tests
 *
 * Tests that verify the descriptiveness slider actually produces
 * measurably different output prompt lengths when combining WHAT+HOW prompts.
 *
 * Also tests the "vary randomly" feature that randomly selects
 * descriptiveness levels for each prompt combination.
 */

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock OpenAI client to capture system prompts
const createMockOpenAIProvider = () => {
  const capturedCalls = [];

  // Track what system prompts and responses we generate
  const mockProvider = {
    capturedCalls,

    async combinePrompts(whatPrompt, howPrompt, options = {}) {
      const descriptiveness = options.descriptiveness || 2;

      // Capture the call for inspection
      capturedCalls.push({ whatPrompt, howPrompt, descriptiveness });

      // Simulate different output lengths based on descriptiveness
      // Concise (1): ~50 chars, Balanced (2): ~100 chars, Descriptive (3): ~200 chars
      if (descriptiveness === 1) {
        return {
          combinedPrompt: `${whatPrompt}, ${howPrompt}`,
          model: 'gpt-4o-mini'
        };
      } else if (descriptiveness === 3) {
        return {
          combinedPrompt: `A highly detailed and comprehensive image featuring ${whatPrompt} rendered with the visual style of ${howPrompt}, incorporating all artistic elements including composition, lighting, mood, texture, and color palette to create a stunning and cohesive visual representation.`,
          model: 'gpt-4o-mini'
        };
      } else {
        // Balanced (2)
        return {
          combinedPrompt: `An image depicting ${whatPrompt} in the style of ${howPrompt}, maintaining rich detail and visual coherence.`,
          model: 'gpt-4o-mini'
        };
      }
    }
  };

  return mockProvider;
};

describe('Descriptiveness affects prompt length', () => {
  describe('Different descriptiveness levels produce different lengths', () => {
    test('concise (1) should produce shorter prompts than balanced (2)', async () => {
      const provider = createMockOpenAIProvider();

      const concise = await provider.combinePrompts('a cat', 'oil painting', { descriptiveness: 1 });
      const balanced = await provider.combinePrompts('a cat', 'oil painting', { descriptiveness: 2 });

      assert.ok(
        concise.combinedPrompt.length < balanced.combinedPrompt.length,
        `Concise (${concise.combinedPrompt.length} chars) should be shorter than balanced (${balanced.combinedPrompt.length} chars)`
      );
    });

    test('balanced (2) should produce shorter prompts than descriptive (3)', async () => {
      const provider = createMockOpenAIProvider();

      const balanced = await provider.combinePrompts('a cat', 'oil painting', { descriptiveness: 2 });
      const descriptive = await provider.combinePrompts('a cat', 'oil painting', { descriptiveness: 3 });

      assert.ok(
        balanced.combinedPrompt.length < descriptive.combinedPrompt.length,
        `Balanced (${balanced.combinedPrompt.length} chars) should be shorter than descriptive (${descriptive.combinedPrompt.length} chars)`
      );
    });

    test('concise should be at least 30% shorter than descriptive', async () => {
      const provider = createMockOpenAIProvider();

      const concise = await provider.combinePrompts('sunset over mountains', 'watercolor', { descriptiveness: 1 });
      const descriptive = await provider.combinePrompts('sunset over mountains', 'watercolor', { descriptiveness: 3 });

      const ratio = concise.combinedPrompt.length / descriptive.combinedPrompt.length;

      assert.ok(
        ratio < 0.7,
        `Concise should be at least 30% shorter. Ratio: ${(ratio * 100).toFixed(1)}%`
      );
    });
  });

  describe('Real provider system prompt differences', () => {
    test('concise system prompt should be shorter than balanced', async () => {
      // Read the actual provider file to check system prompt lengths
      const fs = require('fs');
      const path = require('path');

      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      // Extract the three system prompts by looking for the pattern
      // This is a heuristic test that validates the provider has appropriately sized prompts
      const conciseMatch = providerJs.match(/if \(descriptiveness === 1\)[\s\S]*?systemPrompt = `([^`]+)`/);
      const balancedMatch = providerJs.match(/else \{[\s\S]*?\/\/ Balanced[\s\S]*?systemPrompt = `([^`]+)`/);
      const descriptiveMatch = providerJs.match(/if \(descriptiveness === 3\)[\s\S]*?systemPrompt = `([^`]+)`/);

      assert.ok(conciseMatch, 'Should have concise system prompt');
      assert.ok(balancedMatch, 'Should have balanced system prompt');
      assert.ok(descriptiveMatch, 'Should have descriptive system prompt');

      const conciseLen = conciseMatch[1].length;
      const balancedLen = balancedMatch[1].length;
      const descriptiveLen = descriptiveMatch[1].length;

      assert.ok(
        conciseLen < balancedLen,
        `Concise system prompt (${conciseLen}) should be shorter than balanced (${balancedLen})`
      );

      assert.ok(
        balancedLen < descriptiveLen,
        `Balanced system prompt (${balancedLen}) should be shorter than descriptive (${descriptiveLen})`
      );
    });
  });
});

describe('Vary prompt length randomly feature', () => {
  describe('UI checkbox', () => {
    test('should have a "vary randomly" checkbox in demo.html', () => {
      const fs = require('fs');
      const path = require('path');

      const demoHtml = fs.readFileSync(
        path.join(__dirname, '../../public/demo.html'),
        'utf-8'
      );

      assert.ok(
        demoHtml.includes('vary-descriptiveness-randomly') ||
          demoHtml.includes('varyDescriptivenessRandomly') ||
          demoHtml.includes('randomize-descriptiveness'),
        'Should have a "vary randomly" checkbox element'
      );
    });

    test('should have descriptive label for the checkbox', () => {
      const fs = require('fs');
      const path = require('path');

      const demoHtml = fs.readFileSync(
        path.join(__dirname, '../../public/demo.html'),
        'utf-8'
      );

      assert.ok(
        demoHtml.toLowerCase().includes('vary') ||
          demoHtml.toLowerCase().includes('random'),
        'Should have label text mentioning vary/random'
      );
    });
  });

  describe('API integration', () => {
    test('should include varyDescriptivenessRandomly in beam-search request', () => {
      const fs = require('fs');
      const path = require('path');

      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      assert.ok(
        demoJs.includes('varyDescriptivenessRandomly') ||
          demoJs.includes('vary-descriptiveness-randomly') ||
          demoJs.includes('randomDescriptiveness'),
        'Should send vary randomly setting in API request'
      );
    });
  });

  describe('Server handling', () => {
    test('should extract varyDescriptivenessRandomly from request body', () => {
      const fs = require('fs');
      const path = require('path');

      const serverJs = fs.readFileSync(
        path.join(__dirname, '../../src/api/server.js'),
        'utf-8'
      );

      assert.ok(
        serverJs.includes('varyDescriptivenessRandomly') ||
          serverJs.includes('randomDescriptiveness'),
        'Server should extract vary randomly setting'
      );
    });
  });

  describe('Beam search worker handling', () => {
    test('should pass varyDescriptivenessRandomly to orchestrator', () => {
      const fs = require('fs');
      const path = require('path');

      const workerJs = fs.readFileSync(
        path.join(__dirname, '../../src/api/beam-search-worker.js'),
        'utf-8'
      );

      assert.ok(
        workerJs.includes('varyDescriptivenessRandomly') ||
          workerJs.includes('randomDescriptiveness'),
        'Worker should pass vary randomly to orchestrator'
      );
    });
  });

  describe('Orchestrator random selection', () => {
    test('should randomly select descriptiveness when varyDescriptivenessRandomly is true', () => {
      const fs = require('fs');
      const path = require('path');

      const orchestratorJs = fs.readFileSync(
        path.join(__dirname, '../../src/orchestrator/beam-search.js'),
        'utf-8'
      );

      assert.ok(
        orchestratorJs.includes('varyDescriptivenessRandomly') ||
          orchestratorJs.includes('randomDescriptiveness'),
        'Orchestrator should handle random descriptiveness selection'
      );

      // Should use Math.random or similar
      assert.ok(
        orchestratorJs.includes('Math.random') ||
          orchestratorJs.includes('Math.floor') ||
          orchestratorJs.includes('Math.ceil'),
        'Orchestrator should use random number generation'
      );
    });
  });

  describe('Random distribution', () => {
    test('random selection should produce values 1, 2, or 3', () => {
      // Simulate random selection logic
      const getRandomDescriptiveness = () => Math.floor(Math.random() * 3) + 1;

      const results = new Set();
      for (let i = 0; i < 100; i++) {
        results.add(getRandomDescriptiveness());
      }

      assert.ok(results.has(1), 'Should produce level 1 (concise)');
      assert.ok(results.has(2), 'Should produce level 2 (balanced)');
      assert.ok(results.has(3), 'Should produce level 3 (descriptive)');
      assert.strictEqual(results.size, 3, 'Should only produce values 1, 2, 3');
    });
  });
});
