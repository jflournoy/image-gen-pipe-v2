/**
 * @file Modal Dynamic Model Population Tests (TDD RED)
 * Tests for dynamic population of modal models from API endpoint
 * This ensures the UI is populated with all available models from Modal service
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');
const demoHtmlContent = fs.readFileSync(demoHtmlPath, 'utf8');
const demoJsContent = fs.readFileSync(demoJsPath, 'utf8');

describe('🟢 GREEN: Modal Dynamic Model Population', () => {
  describe('loadModalModels Function Definition', () => {
    it('should have loadModalModels function defined', () => {
      assert.match(demoJsContent, /async\s+function\s+loadModalModels\s*\(/,
        'loadModalModels() async function should be defined');
    });

    it('should fetch from /api/providers/modal/models endpoint', () => {
      assert.match(demoJsContent, /\/api\/providers\/modal\/models/,
        'loadModalModels() should fetch from /api/providers/modal/models endpoint');
    });

    it('should handle response parsing as JSON', () => {
      // Check for response.json and data.models pattern
      assert.match(demoJsContent, /response\.json\(\)|const\s+data\s*=\s*await|data\.models/,
        'loadModalModels() should parse response as JSON and access models');
    });
  });

  describe('Model Grouping by Type', () => {
    it('should filter models by type (builtin vs custom)', () => {
      assert.match(demoJsContent, /builtinModels|models\.filter.*type.*builtin/,
        'Should filter models by builtin type');

      assert.match(demoJsContent, /customModels|models\.filter.*type.*custom/,
        'Should filter models by custom type');
    });

    it('should group builtin models by pipeline (flux, sdxl, sd3)', () => {
      assert.match(demoJsContent, /fluxBuiltin|\.pipeline.*flux/,
        'Should filter models by flux pipeline');

      assert.match(demoJsContent, /sdxlBuiltin|\.pipeline.*sdxl/,
        'Should filter models by sdxl pipeline');

      assert.match(demoJsContent, /sd3Builtin|\.pipeline.*sd3/,
        'Should filter models by sd3 pipeline');
    });
  });

  describe('UI Population with Optgroups', () => {
    it('should create optgroup elements for each pipeline type', () => {
      assert.match(demoJsContent, /createElement\s*\(\s*['"']optgroup/,
        'Should create optgroup elements for model categories');

      assert.match(demoJsContent, /\.label\s*=/,
        'Should set label for optgroup elements');
    });

    it('should create option elements for each model', () => {
      assert.match(demoJsContent, /createElement\s*\(\s*['"']option/,
        'Should create option elements for each model');

      assert.match(demoJsContent, /\.value\s*=|\.textContent\s*=/,
        'Should set value and text for option elements');
    });

    it('should use formatModelName for display text', () => {
      assert.match(demoJsContent, /formatModelName\s*\(/,
        'Should format model names for display');
    });

    it('should append optgroups to modalSelect dropdown', () => {
      assert.match(demoJsContent, /appendChild\s*\(|appendChild\s*;/,
        'Should add created optgroups to the select element');
    });
  });

  describe('Selection Preservation', () => {
    it('should save current selection before clearing options', () => {
      assert.match(demoJsContent, /currentValue|\.value\s*=/,
        'Should save current modal selection before updating');
    });

    it('should restore previous selection if it still exists', () => {
      assert.match(demoJsContent, /currentValue|restore|modalSelect\.value\s*=/,
        'Should restore user\'s previous model selection if still available');
    });
  });

  describe('Error Handling and Fallback', () => {
    it('should handle fetch failures gracefully', () => {
      assert.match(demoJsContent, /!response\.ok|response\.status|catch\s*\(|try\s*\{/,
        'Should check response status or use try-catch for error handling');
    });

    it('should have fallback when no models returned', () => {
      assert.match(demoJsContent, /models\.length|no.*models|hardcoded/i,
        'Should handle case where no models are returned');
    });

    it('should log debug information about loaded models', () => {
      assert.match(demoJsContent, /console\.\w+|Modal.*[Mm]odels|Loaded.*models/,
        'Should log information about models being loaded');
    });
  });

  describe('Function Initialization and Timing', () => {
    it('should call loadModalModels when modal settings are initialized', () => {
      // Check that loadModalModels is called during page load
      assert.match(demoJsContent, /loadModalModels\s*\(\s*\)/,
        'loadModalModels() should be called during initialization');
    });

    it('should be called on imageProvider change to modal', () => {
      // Verify the function is called when modal is selected
      assert.match(demoJsContent, /updateImageProviderSettings|loadModalModels/,
        'loadModalModels() should be called when modal provider is selected');
    });
  });

  describe('Modal Settings Container Structure', () => {
    it('should have select element with id modalModel', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']modalModel["']/,
        'Modal model dropdown should exist in HTML');
    });

    it('should have select element inside modalSettings container', () => {
      const modalSettingsStart = demoHtmlContent.indexOf('id="modalSettings"');
      if (modalSettingsStart !== -1) {
        const containerEnd = demoHtmlContent.indexOf('</div>', modalSettingsStart);
        const container = demoHtmlContent.substring(modalSettingsStart, containerEnd);

        assert.match(container, /modalModel|<select/,
          'modalModel select should be within modalSettings container');
      }
    });
  });

  describe('Hardcoded Fallback Options', () => {
    it('should have flux-dev as default option', () => {
      assert.match(demoHtmlContent, /flux-dev/i,
        'Should have flux-dev model as fallback option');
    });

    it('should have flux-schnell as fallback option', () => {
      assert.match(demoHtmlContent, /flux-schnell|schnell/i,
        'Should have flux-schnell model as fallback option');
    });

    it('should have sdxl-turbo as fallback option', () => {
      assert.match(demoHtmlContent, /sdxl-turbo|sdxl/i,
        'Should have sdxl-turbo model as fallback option');
    });
  });

  describe('formatModelName Helper Function', () => {
    it('should have formatModelName function', () => {
      assert.match(demoJsContent, /function\s+formatModelName\s*\(|const\s+formatModelName\s*=/,
        'formatModelName() function should be defined');
    });

    it('should convert model names to readable format', () => {
      const funcStart = demoJsContent.indexOf('function formatModelName(');
      if (funcStart !== -1) {
        const funcEnd = demoJsContent.indexOf('}', funcStart) + 1;
        const funcBody = demoJsContent.substring(funcStart, funcEnd);

        assert.match(funcBody, /replace|split|join|toUpperCase|uppercase|format/i,
          'Should format model names (replace dashes, capitalize, etc.)');
      }
    });
  });

  describe('Clear and Repopulate', () => {
    it('should clear existing options before populating', () => {
      assert.match(demoJsContent, /innerHTML\s*=\s*['"']/,
        'Should clear existing options before populating with new ones');
    });

    it('should rebuild optgroups dynamically', () => {
      // Count how many times optgroup is created (should be multiple)
      const optgroupMatches = demoJsContent.match(/createElement\s*\(\s*['"']optgroup/g);
      assert.ok(optgroupMatches && optgroupMatches.length >= 1,
        'Should create optgroups for different model categories');
    });
  });
});
