/**
 * TDD RED Phase: Alpha Slider Documentation Tests
 *
 * Tests for the Alpha (prompt alignment vs visual quality) slider documentation.
 * This slider controls the balance between:
 * - Low (0.0-0.3): Prioritize beauty over exact prompt matching
 * - Medium (0.4-0.6): Balance both equally
 * - High (0.7-1.0): Ensure images match your prompt exactly
 *
 * The UI should provide clear, helpful documentation for users to understand
 * what each setting does.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Alpha Slider Documentation (Prompt Alignment vs Visual Quality)', () => {
  let demoHtml;

  const setup = () => {
    demoHtml = fs.readFileSync(
      path.join(__dirname, '../../public/demo.html'),
      'utf-8'
    );
  };

  describe('Alpha slider documentation structure', () => {
    test('should have alpha slider with ID', () => {
      setup();
      assert.ok(
        demoHtml.includes('id="alpha"'),
        'Should have alpha slider with id="alpha"'
      );
    });

    test('should have a label explaining the alpha setting', () => {
      setup();
      assert.ok(
        demoHtml.includes('Alpha') || demoHtml.includes('alpha'),
        'Should have label for alpha slider'
      );
    });

    test('should have documentation section for alpha slider values', () => {
      setup();
      assert.ok(
        demoHtml.includes('prompt') && demoHtml.includes('alignment'),
        'Should mention prompt alignment in alpha documentation'
      );
    });
  });

  describe('Low value documentation (0.0-0.3)', () => {
    test('should explain low value behavior', () => {
      setup();
      assert.ok(
        demoHtml.includes('Low') &&
        (demoHtml.includes('0.0-0.3') || demoHtml.includes('0.0–0.3')),
        'Should document Low range (0.0-0.3)'
      );
    });

    test('should explain beauty prioritization at low values', () => {
      setup();
      assert.ok(
        demoHtml.includes('beauty') ||
        demoHtml.includes('Beauty') ||
        demoHtml.includes('visual quality'),
        'Should explain that low values prioritize beauty/visual quality'
      );
    });

    test('should mention exact prompt matching is deprioritized at low values', () => {
      setup();
      // Check that Low appears with either exact, prompt matching, or match nearby
      const hasLow = /Low[^<]*?(?:exact|prompt matching|match)/i.test(demoHtml) ||
                     (demoHtml.includes('Low') && demoHtml.includes('exact'));
      assert.ok(
        hasLow,
        'Should explain that exact prompt matching is less prioritized at low values'
      );
    });
  });

  describe('Medium value documentation (0.4-0.6)', () => {
    test('should explain medium value behavior', () => {
      setup();
      assert.ok(
        demoHtml.includes('Medium') &&
        (demoHtml.includes('0.4-0.6') || demoHtml.includes('0.4–0.6')),
        'Should document Medium range (0.4-0.6)'
      );
    });

    test('should explain balanced approach at medium values', () => {
      setup();
      assert.ok(
        demoHtml.includes('balance') ||
        demoHtml.includes('Balance') ||
        demoHtml.includes('equally'),
        'Should explain that medium values balance both aspects equally'
      );
    });
  });

  describe('High value documentation (0.7-1.0)', () => {
    test('should explain high value behavior', () => {
      setup();
      assert.ok(
        demoHtml.includes('High') &&
        (demoHtml.includes('0.7-1.0') || demoHtml.includes('0.7–1.0')),
        'Should document High range (0.7-1.0)'
      );
    });

    test('should explain prompt matching priority at high values', () => {
      setup();
      assert.ok(
        demoHtml.includes('exact') ||
        demoHtml.includes('Exact') ||
        demoHtml.includes('match your prompt'),
        'Should explain that high values ensure images match your prompt'
      );
    });
  });

  describe('Documentation presentation', () => {
    test('should have a visible documentation container for alpha slider', () => {
      setup();
      // Should have a container with documentation text (using <small> or similar)
      assert.ok(
        demoHtml.includes('Low') &&
        demoHtml.includes('Medium') &&
        demoHtml.includes('High'),
        'Should have all three documentation levels (Low, Medium, High)'
      );
    });

    test('documentation should be accessible to users (not hidden)', () => {
      setup();
      // Check for hidden styles that would hide the documentation
      const alphaSection = demoHtml.match(/id="alpha"[^<]*.*?<\/div>/s);
      assert.ok(alphaSection, 'Should find alpha slider section');

      // Make sure the documentation isn't hidden
      if (alphaSection) {
        const section = alphaSection[0];
        const hasHiddenDisplay = /display\s*:\s*none/.test(section);
        assert.ok(
          !hasHiddenDisplay,
          'Documentation should not be hidden with display: none'
        );
      }
    });

    test('each documentation level should explain trade-offs clearly', () => {
      setup();
      // Verify that trade-off language is used
      assert.ok(
        (demoHtml.includes('Prioritize') || demoHtml.includes('prioritize')) &&
        (demoHtml.includes('balance') || demoHtml.includes('Balance')) &&
        (demoHtml.includes('Ensure') || demoHtml.includes('ensure')),
        'Should use clear action words for each documentation level'
      );
    });
  });
});
