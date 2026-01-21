/**
 * Test: Configuration Preview - Encoder Display
 *
 * Validates that:
 * 1. Configuration preview correctly displays encoder requirements
 * 2. Required field indicators work for local models
 * 3. Validation summary shows configuration status
 * 4. Orphaned code is removed (no references to non-existent elements)
 * 5. Help text explains encoder requirements
 */

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '../..');
const demoJsPath = path.join(projectRoot, 'public/demo.js');
const demoHtmlPath = path.join(projectRoot, 'public/demo.html');

test('🟢 GREEN: Configuration Preview - Encoder Display', async (t) => {
  // Read files once
  const demoJs = fs.readFileSync(demoJsPath, 'utf-8');
  const demoHtml = fs.readFileSync(demoHtmlPath, 'utf-8');

  await t.test('Orphaned Code Removal - No Non-Existent Element References', async (t) => {
    // These elements are referenced in code but don't exist in HTML
    const orphanedIds = [
      'fluxEncoderInputs',
      'useLocalEncoders',
      'fluxModelSelector',
      'hfModelSection',
      'localModelSection'
    ];

    for (const id of orphanedIds) {
      await t.test(`should not reference getElementById('${id}')`, () => {
        const regex = new RegExp(`getElementById\\(['"]${id}['"]\\)`, 'g');
        const matches = demoJs.match(regex);

        assert.strictEqual(
          matches ? matches.length : 0,
          0,
          `Code should not reference non-existent element: ${id}`
        );
      });
    }
  });

  await t.test('Orphaned Functions Removal', async (t) => {
    await t.test('should remove populateLocalDefaults() function', () => {
      // Function should either not exist or be minimal (just a comment)
      const funcRegex = /function populateLocalDefaults\(\)\s*\{[\s\S]*?\n\}/;
      const match = demoJs.match(funcRegex);

      if (match) {
        const funcBody = match[0];
        // Count non-comment, non-whitespace lines
        const lines = funcBody
          .split('\n')
          .filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*'));

        assert.ok(
          lines.length <= 3,
          'populateLocalDefaults should be removed or minimal'
        );
      }
    });

    await t.test('should remove handleFluxModelSourceChange() function', () => {
      const hasFunc = demoJs.includes('function handleFluxModelSourceChange');
      assert.strictEqual(
        hasFunc,
        false,
        'handleFluxModelSourceChange should be removed'
      );
    });

    await t.test('should remove selectFluxModel() function', () => {
      const hasFunc = demoJs.includes('function selectFluxModel()');
      assert.strictEqual(
        hasFunc,
        false,
        'selectFluxModel should be removed'
      );
    });

    await t.test('should remove loadFluxModels() function', () => {
      const hasFunc = demoJs.includes('async function loadFluxModels()');
      assert.strictEqual(
        hasFunc,
        false,
        'loadFluxModels should be removed'
      );
    });
  });

  await t.test('Configuration Preview Enhancement', async (t) => {
    await t.test('should export renderConfigPreview function', () => {
      assert.ok(
        demoJs.includes('function renderConfigPreview'),
        'renderConfigPreview function should exist'
      );
    });

    await t.test('should have renderEncoderValidationSummary function', () => {
      assert.ok(
        demoJs.includes('function renderEncoderValidationSummary') ||
        demoJs.includes('renderEncoderValidationSummary'),
        'renderEncoderValidationSummary function should exist or be called'
      );
    });

    await t.test('should have CSS class for required fields', () => {
      assert.ok(
        demoHtml.includes('config-required'),
        'CSS should have config-required class for required fields'
      );
    });

    await t.test('should have CSS for validation summary', () => {
      assert.ok(
        demoHtml.includes('validation-summary') ||
        demoHtml.includes('validation-warning') ||
        demoHtml.includes('validation-success'),
        'CSS should have validation-summary styles'
      );
    });
  });

  await t.test('Help Text Improvement', async (t) => {
    await t.test('should have help text explaining encoder requirements', () => {
      const hasHelpText = demoHtml.includes('encoder') &&
        (demoHtml.includes('CLIP-L') || demoHtml.includes('T5-XXL') || demoHtml.includes('VAE'));

      assert.ok(
        hasHelpText,
        'HTML should have help text explaining encoder requirements'
      );
    });

    await t.test('should mention local checkpoint vs HuggingFace difference', () => {
      const hasLocalVsHF = demoHtml.includes('Local') && (demoHtml.includes('HuggingFace') || demoHtml.includes('Hugging Face'));

      assert.ok(
        hasLocalVsHF,
        'Help text should distinguish between local and HuggingFace models'
      );
    });
  });

  await t.test('🔴 Code Quality Checks', async (t) => {
    await t.test('no more references to non-existent HTML elements in critical paths', () => {
      // These specific patterns should be gone
      const badPatterns = [
        "getElementById('fluxEncoderInputs')",
        "getElementById('useLocalEncoders')",
        "getElementById('fluxModelSelector')",
        "getElementById('hfModelSection')",
        "getElementById('localModelSection')"
      ];

      for (const pattern of badPatterns) {
        assert.ok(
          !demoJs.includes(pattern),
          `Should not have pattern: ${pattern}`
        );
      }
    });

    await t.test('renderConfigPreview should be the primary encoder config UI', () => {
      // renderConfigPreview should be called/used prominently
      const hasRenderCall = demoJs.match(/renderConfigPreview\s*\(/);
      assert.ok(hasRenderCall, 'renderConfigPreview should be actively used');

      // Verify it's the main way config is displayed
      const renderConfigLineCount = (demoJs.match(/function renderConfigPreview/g) || []).length;
      assert.strictEqual(renderConfigLineCount, 1, 'Should have exactly one renderConfigPreview function');
    });
  });
});
