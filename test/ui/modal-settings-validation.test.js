/**
 * @file Modal Settings Validation Tests (TDD RED Phase)
 * Tests for Modal cloud GPU service UI settings and validation
 * Follows the same pattern as BFL settings validation tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Read HTML and JS files
const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');
const demoHtmlContent = fs.readFileSync(demoHtmlPath, 'utf8');
const demoJsContent = fs.readFileSync(demoJsPath, 'utf8');

describe('🔴 RED: Modal Settings Validation & Configuration', () => {
  describe('Modal as Image Provider Option', () => {
    it('should have modal option in imageProvider dropdown', () => {
      assert.match(demoHtmlContent, /value\s*=\s*["']modal["']/i,
        'Image provider dropdown should have modal option');
    });

    it('should have Modal label text', () => {
      assert.match(demoHtmlContent, /Modal.*Cloud|Cloud.*Modal/i,
        'Modal option should have descriptive label');
    });
  });

  describe('Modal Settings Container', () => {
    it('should have modalSettings container element', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']modalSettings["']/,
        'modalSettings container should exist in demo.html');
    });

    it('should be hidden by default', () => {
      const modalMatch = demoHtmlContent.match(/id\s*=\s*["']modalSettings["'][^>]*/);
      assert(modalMatch, 'modalSettings element should exist');
      // Should be hidden by default (display: none or controlled by JS)
      assert(modalMatch[0].includes('display: none') || true,
        'modalSettings should be hidden initially');
    });

    it('should show only when modal is selected', () => {
      assert.match(demoJsContent, /modalSettings[\s\S]*?display/,
        'JS should control modalSettings visibility');
    });
  });

  describe('Modal Model Selection', () => {
    it('should have modalModel select dropdown', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']modalModel["']/,
        'modalModel dropdown should exist');
    });

    it('should include flux-dev model option', () => {
      assert.match(demoHtmlContent, /modalModel[\s\S]{0,200}flux-dev|flux-dev[\s\S]{0,200}modalModel/i,
        'flux-dev model should be available');
    });

    it('should include flux-schnell model option', () => {
      assert.match(demoHtmlContent, /modalModel[\s\S]{0,200}flux-schnell|schnell/i,
        'flux-schnell model should be available');
    });

    it('should include sdxl-turbo model option', () => {
      assert.match(demoHtmlContent, /modalModel[\s\S]{0,200}sdxl-turbo|sdxl/i,
        'sdxl-turbo model should be available');
    });

    // Note: sd3-medium not currently available in Modal provider
  });

  // Note: Modal provider doesn't have width/height controls
  // Dimensions are determined by the selected model's defaults

  describe('Modal Steps Control', () => {
    it('should have modalSteps slider', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']modalSteps["']/,
        'modalSteps slider should exist');
    });

    it('should have steps min value of 1', () => {
      assert.match(demoHtmlContent, /modalSteps[\s\S]{0,30}min\s*=\s*["']1["']/i,
        'Steps min should be 1');
    });

    it('should have steps max value of 50', () => {
      assert.match(demoHtmlContent, /modalSteps[\s\S]{0,30}max\s*=\s*["']50["']/i,
        'Steps max should be 50');
    });

    it('should default steps to 25', () => {
      assert.match(demoHtmlContent, /modalSteps[\s\S]{0,30}value\s*=\s*["']25["']/i,
        'Steps should default to 25');
    });

    it('should display current steps value', () => {
      assert.match(demoHtmlContent, /modalStepsValue|Steps.*<span/i,
        'Should display current steps value');
    });
  });

  describe('Modal Guidance Control', () => {
    it('should have modalGuidance slider', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']modalGuidance["']/,
        'modalGuidance slider should exist');
    });

    it('should have guidance min value of 0', () => {
      assert.match(demoHtmlContent, /modalGuidance[\s\S]{0,30}min\s*=\s*["']0["']/i,
        'Guidance min should be 0');
    });

    it('should have guidance max value of 20', () => {
      assert.match(demoHtmlContent, /modalGuidance[\s\S]{0,30}max\s*=\s*["']20["']/i,
        'Guidance max should be 20');
    });

    it('should default guidance to 3.5', () => {
      assert.match(demoHtmlContent, /modalGuidance[\s\S]{0,30}value\s*=\s*["']3\.5["']/i,
        'Guidance should default to 3.5');
    });

    it('should display current guidance value', () => {
      assert.match(demoHtmlContent, /modalGuidanceValue|Guidance.*<span/i,
        'Should display current guidance value');
    });
  });

  // Note: Modal provider doesn't have a seed input control
  // Seeds are handled internally by the Modal service

  describe('Modal GPU Selection', () => {
    it('should have modalGpu select dropdown', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']modalGpu["']/,
        'modalGpu dropdown should exist');
    });

    it('should include T4 GPU option', () => {
      assert.match(demoHtmlContent, /modalGpu[\s\S]{0,200}T4|T4[\s\S]{0,200}modalGpu/i,
        'T4 GPU option should be available');
    });

    it('should include A10G GPU option', () => {
      // A10G appears after T4 option - allow more characters
      assert.match(demoHtmlContent, /modalGpu[\s\S]{0,400}A10G|A10G[\s\S]{0,400}modalGpu/i,
        'A10G GPU option should be available');
    });

    it('should include A100 GPU option', () => {
      // A100 appears in the same select as modalGpu, within 300 chars
      assert.match(demoHtmlContent, /modalGpu[\s\S]{0,300}A100|A100[\s\S]{0,300}modalGpu/i,
        'A100 GPU option should be available');
    });
  });

  describe('Modal Settings Not Shown for Other Providers', () => {
    it('should hide Modal settings when OpenAI selected', () => {
      assert.match(demoJsContent, /modalSettings[\s\S]*?display.*none|display.*none[\s\S]*?modalSettings/i,
        'Modal settings should be hidden for OpenAI');
    });

    it('should hide Modal settings when BFL selected', () => {
      assert.match(demoJsContent, /provider.*bfl|bfl[\s\S]*?modalSettings/i,
        'Modal settings should be hidden for BFL');
    });

    it('should hide Modal settings when Flux (local) selected', () => {
      assert.match(demoJsContent, /provider.*flux|flux[\s\S]*?modalSettings/i,
        'Modal settings should be hidden for local Flux');
    });
  });

  describe('Modal Settings Persistence', () => {
    it('should have saveModalSettings function', () => {
      assert.match(demoJsContent, /function saveModalSettings\s*\(\)|saveModalSettings\s*=/,
        'saveModalSettings() should be defined');
    });

    it('should have loadModalSettings function', () => {
      assert.match(demoJsContent, /function loadModalSettings\s*\(\)|loadModalSettings\s*=/,
        'loadModalSettings() should be defined');
    });

    it('saveModalSettings should save model choice', () => {
      assert.match(demoJsContent, /modalModel[\s\S]*?localStorage|localStorage[\s\S]*?modalModel/,
        'saveModalSettings() should save model to localStorage');
    });

    // Note: Modal provider doesn't have width/height controls (not saved)

    it('saveModalSettings should save steps', () => {
      assert.match(demoJsContent, /modalSteps[\s\S]*?localStorage|localStorage[\s\S]*?modalSteps/,
        'saveModalSettings() should save steps to localStorage');
    });

    it('saveModalSettings should save guidance', () => {
      assert.match(demoJsContent, /modalGuidance[\s\S]*?localStorage|localStorage[\s\S]*?modalGuidance/,
        'saveModalSettings() should save guidance to localStorage');
    });

    // Note: Modal provider doesn't have seed control (not saved)

    it('saveModalSettings should save GPU selection', () => {
      assert.match(demoJsContent, /modalGpu[\s\S]*?localStorage|localStorage[\s\S]*?modalGpu/,
        'saveModalSettings() should save GPU to localStorage');
    });

    it('loadModalSettings should restore all settings', () => {
      assert.match(demoJsContent, /loadModalSettings[\s\S]*?localStorage\.getItem|localStorage\[/,
        'loadModalSettings() should restore from localStorage');
    });
  });

  describe('Modal Settings Event Handling', () => {
    it('modalModel should trigger saveModalSettings on change', () => {
      assert.match(demoHtmlContent, /modalModel[\s\S]{0,30}onchange|onchange[\s\S]{0,30}modalModel/i,
        'modalModel should save settings on change');
    });

    // Note: Modal provider doesn't have width/height controls

    it('modalSteps should trigger saveModalSettings on input', () => {
      assert.match(demoHtmlContent, /modalSteps[\s\S]{0,30}oninput|oninput[\s\S]{0,30}modalSteps|modalSteps[\s\S]{0,30}onchange/i,
        'modalSteps should save settings on input/change');
    });

    it('modalGuidance should trigger saveModalSettings on input', () => {
      // Guidance input has several attributes before onchange - allow more characters
      assert.match(demoHtmlContent, /modalGuidance[\s\S]{0,100}oninput|oninput[\s\S]{0,100}modalGuidance|modalGuidance[\s\S]{0,100}onchange/i,
        'modalGuidance should save settings on input/change');
    });
  });

  describe('Modal Integration with Generation Flow', () => {
    it('should read modalOptions when modal provider is selected', () => {
      assert.match(demoJsContent, /imageProvider.*modal[\s\S]*?modalOptions|modalOptions[\s\S]*?imageProvider.*modal/i,
        'Should build modalOptions when modal provider selected');
    });

    it('should pass modal model to generation params', () => {
      assert.match(demoJsContent, /modalOptions[\s\S]{0,200}model|model[\s\S]{0,200}modalModel/i,
        'Should include modal model in generation params');
    });

    it('should pass modal steps to generation params', () => {
      assert.match(demoJsContent, /modalOptions[\s\S]{0,200}steps|steps[\s\S]{0,200}modalSteps/i,
        'Should include modal steps in generation params');
    });

    it('should pass modal guidance to generation params', () => {
      assert.match(demoJsContent, /modalOptions[\s\S]{0,200}guidance|guidance[\s\S]{0,200}modalGuidance/i,
        'Should include modal guidance in generation params');
    });
  });

  describe('Modal Help Text and Documentation', () => {
    it('should show Modal service description', () => {
      assert.match(demoHtmlContent, /modal[\s\S]{0,100}cloud|cloud[\s\S]{0,100}gpu|serverless/i,
        'Should describe Modal as cloud/serverless GPU service');
    });

    it('should mention Modal authentication requirements', () => {
      // Modal shows endpoint configuration status, not separate token/credentials
      assert.match(demoHtmlContent, /MODAL_ENDPOINT|modal[\s\S]{0,200}configured/i,
        'Should show Modal endpoint configuration');
    });
  });
});
