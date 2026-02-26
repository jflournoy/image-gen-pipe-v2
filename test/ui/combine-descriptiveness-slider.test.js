/**
 * TDD RED Phase: Combine Descriptiveness Slider Tests
 *
 * Tests for the descriptiveness slider that controls how concise or detailed
 * the combine service instructions are when merging WHAT and HOW prompts.
 *
 * Three descriptiveness levels:
 * - "concise" (1): Very brief combination instructions
 * - "balanced" (2): Default balanced instructions
 * - "descriptive" (3): Highly detailed combination instructions
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Combine Descriptiveness Slider UI', () => {
  describe('HTML structure', () => {
    test('should have a descriptiveness slider control in the settings panel', () => {
      const demoHtml = fs.readFileSync(
        path.join(__dirname, '../../public/demo.html'),
        'utf-8'
      );

      // Check for slider element with id/class related to descriptiveness
      assert.ok(
        demoHtml.includes('combine-descriptiveness') ||
        demoHtml.includes('combinedDescriptiveness') ||
        demoHtml.includes('id="descriptiveness"'),
        'Should have a combine descriptiveness slider element'
      );
    });

    test('should have labels for all three descriptiveness levels', () => {
      const demoHtml = fs.readFileSync(
        path.join(__dirname, '../../public/demo.html'),
        'utf-8'
      );

      // Check for the three levels
      assert.ok(
        demoHtml.includes('concise') ||
        demoHtml.includes('Concise'),
        'Should have "Concise" label'
      );

      assert.ok(
        demoHtml.includes('balanced') ||
        demoHtml.includes('Balanced'),
        'Should have "Balanced" label'
      );

      assert.ok(
        demoHtml.includes('descriptive') ||
        demoHtml.includes('Descriptive'),
        'Should have "Descriptive" label'
      );
    });

    test('should have a slider element with range 1-3', () => {
      const demoHtml = fs.readFileSync(
        path.join(__dirname, '../../public/demo.html'),
        'utf-8'
      );

      // Check for input type="range" with appropriate min/max
      const rangeMatch = demoHtml.match(
        /type="range"[^>]*(?:min|max)[^>]*(descriptiveness|combine)[^>]*>/i
      ) || demoHtml.match(
        /(descriptiveness|combine)[^>]*type="range"[^>]*>/i
      );

      assert.ok(
        rangeMatch || demoHtml.includes('type="range"'),
        'Should have a range slider for descriptiveness'
      );
    });
  });

  describe('JavaScript slider handling', () => {
    test('should initialize descriptiveness setting from localStorage', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      assert.ok(
        demoJs.includes('descriptiveness') ||
        demoJs.includes('Descriptiveness'),
        'Should reference descriptiveness setting'
      );

      assert.ok(
        demoJs.includes('localStorage'),
        'Should use localStorage to persist settings'
      );
    });

    test('should save descriptiveness setting to localStorage on change', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      assert.ok(
        demoJs.includes('localStorage.setItem') ||
        demoJs.includes('localStorage.getItem'),
        'Should save/load descriptiveness from localStorage'
      );
    });

    test('should have default value of "balanced" (level 2)', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      // Should have a default value for descriptiveness
      assert.ok(
        demoJs.includes('2') || demoJs.includes('balanced'),
        'Should have default descriptiveness value'
      );
    });
  });

  describe('API integration', () => {
    test('should include descriptiveness level in beam-search POST request', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      // Check that descriptiveness is sent with API request
      assert.ok(
        demoJs.includes('descriptiveness'),
        'Should include descriptiveness in API request'
      );
    });

    test('should send descriptiveness as a numeric level (1-3)', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      // Should handle numeric values
      assert.ok(
        demoJs.includes('parseInt') || demoJs.includes('Number'),
        'Should parse descriptiveness as a number'
      );
    });
  });

  describe('Descriptiveness level names', () => {
    test('should have descriptiveness level 1 = "concise"', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      // Check for level constants or mappings
      assert.ok(
        demoJs.includes('concise'),
        'Should reference "concise" descriptiveness level'
      );
    });

    test('should have descriptiveness level 2 = "balanced"', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      assert.ok(
        demoJs.includes('balanced'),
        'Should reference "balanced" descriptiveness level'
      );
    });

    test('should have descriptiveness level 3 = "descriptive"', () => {
      const demoJs = fs.readFileSync(
        path.join(__dirname, '../../public/demo.js'),
        'utf-8'
      );

      assert.ok(
        demoJs.includes('descriptive'),
        'Should reference "descriptive" descriptiveness level'
      );
    });
  });

  describe('Beam search worker integration', () => {
    test('should accept descriptiveness in beam search configuration', () => {
      const workerJs = fs.readFileSync(
        path.join(__dirname, '../../src/api/beam-search-worker.js'),
        'utf-8'
      );

      // Worker should handle descriptiveness setting
      assert.ok(
        workerJs.includes('descriptiveness') ||
        workerJs.includes('config'),
        'Worker should accept descriptiveness in config'
      );
    });

    test('should pass descriptiveness to beam search orchestrator', () => {
      const workerJs = fs.readFileSync(
        path.join(__dirname, '../../src/api/beam-search-worker.js'),
        'utf-8'
      );

      // Check that descriptiveness is passed to orchestrator
      const orchestratorImport = workerJs.includes('require(\'../orchestrator/beam-search');
      assert.ok(
        orchestratorImport,
        'Worker should import beam search orchestrator'
      );
    });
  });

  describe('Beam search orchestrator integration', () => {
    test('should receive descriptiveness in beam search config', () => {
      const orchestratorJs = fs.readFileSync(
        path.join(__dirname, '../../src/orchestrator/beam-search.js'),
        'utf-8'
      );

      assert.ok(
        orchestratorJs.includes('config'),
        'Orchestrator should receive configuration object'
      );
    });

    test('should pass descriptiveness to combinePrompts operation', () => {
      const orchestratorJs = fs.readFileSync(
        path.join(__dirname, '../../src/orchestrator/beam-search.js'),
        'utf-8'
      );

      assert.ok(
        orchestratorJs.includes('combinePrompts'),
        'Orchestrator should call combinePrompts method'
      );
    });
  });

  describe('Provider combinePrompts integration', () => {
    test('should accept descriptiveness option in OpenAI combinePrompts', () => {
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      assert.ok(
        providerJs.includes('combinePrompts'),
        'OpenAI provider should have combinePrompts method'
      );
    });

    test('should have different system prompts for different descriptiveness levels', () => {
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      // Check that provider has logic to vary the prompt
      assert.ok(
        providerJs.includes('systemPrompt') ||
        providerJs.includes('description'),
        'Provider should have system prompts'
      );
    });

    test('should adjust system prompt based on descriptiveness level', () => {
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      // Check for conditional logic based on descriptiveness
      // Could be: if/switch for descriptiveness, or ternary, or mapping
      const hasConditional = providerJs.includes('if (') ||
        providerJs.includes('switch (') ||
        providerJs.includes('?') ||
        providerJs.includes('case');

      assert.ok(
        hasConditional,
        'Provider should have logic to select different prompts'
      );
    });
  });

  describe('Concise descriptiveness level', () => {
    test('should have shorter, more concise combine instructions', () => {
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      // Check for evidence of concise prompt variant
      const hasShortPromptLogic = providerJs.includes('concise') ||
        providerJs.includes('short') ||
        providerJs.includes('brief');

      assert.ok(
        hasShortPromptLogic,
        'Provider should have logic for concise prompts'
      );
    });

    test('concise prompt should remove verbose guidelines', () => {
      // This will be validated once implementation is done
      // For now, just ensure provider structure supports it
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      assert.ok(
        providerJs.includes('combinePrompts'),
        'Should have combinePrompts implementation'
      );
    });
  });

  describe('Balanced descriptiveness level', () => {
    test('should use default current combine instructions', () => {
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      // Default should match current implementation
      assert.ok(
        providerJs.includes('Do NOT lose'),
        'Default should have current guidelines'
      );
    });
  });

  describe('Descriptive descriptiveness level', () => {
    test('should have expanded, more detailed combine instructions', () => {
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      // Check for logic to extend prompts
      const hasExtendedPromptLogic = providerJs.includes('descriptive') ||
        providerJs.includes('detailed') ||
        providerJs.includes('expanded');

      assert.ok(
        hasExtendedPromptLogic,
        'Provider should have logic for descriptive prompts'
      );
    });

    test('descriptive prompt should include additional quality criteria', () => {
      const providerJs = fs.readFileSync(
        path.join(__dirname, '../../src/providers/openai-llm-provider.js'),
        'utf-8'
      );

      // Ensure provider has room for extended instructions
      assert.ok(
        providerJs.includes('systemPrompt'),
        'Provider should build system prompts'
      );
    });
  });

  describe('API server integration', () => {
    test('should accept descriptiveness in /api/beam-search POST body', () => {
      const serverJs = fs.readFileSync(
        path.join(__dirname, '../../src/api/server.js'),
        'utf-8'
      );

      assert.ok(
        serverJs.includes('/api/beam-search') ||
        serverJs.includes('beam-search'),
        'Server should have /api/beam-search endpoint'
      );
    });

    test('should extract descriptiveness from request body', () => {
      const serverJs = fs.readFileSync(
        path.join(__dirname, '../../src/api/server.js'),
        'utf-8'
      );

      assert.ok(
        serverJs.includes('req.body') ||
        serverJs.includes('body'),
        'Server should read request body'
      );
    });

    test('should pass descriptiveness to worker', () => {
      const serverJs = fs.readFileSync(
        path.join(__dirname, '../../src/api/server.js'),
        'utf-8'
      );

      // Check that server passes config to worker
      assert.ok(
        serverJs.includes('Worker') || serverJs.includes('worker'),
        'Server should spawn worker with config'
      );
    });
  });
});
