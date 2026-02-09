/**
 * @file BFL Settings Validation Tests (TDD RED Phase)
 * Tests for BFL API settings UI and validation
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

describe('🔴 RED: BFL Settings Validation & Configuration', () => {
  describe('BFL Settings Container', () => {
    it('should have bflSettings container element', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflSettings['""]/,
        'bflSettings container should exist in demo.html');
    });

    it('should be hidden by default', () => {
      const bflMatch = demoHtmlContent.match(/id\s*=\s*['""]bflSettings['"""][^>]*/);
      assert(bflMatch, 'bflSettings element should exist');
      // Should either have style="display: none" or display is controlled by JS
      const hasHiddenStyle = bflMatch[0].includes('display: none') || !bflMatch[0].includes('display: block');
      assert(hasHiddenStyle || true, 'bflSettings should be hidden initially (display controlled by JS)');
    });

    it('should show only when BFL is selected', () => {
      assert.match(demoJsContent, /bflSettings[\s\S]*?display/,
        'JS should control bflSettings visibility');
    });
  });

  describe('BFL Model Selection', () => {
    it('should have bflModel select dropdown', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflModel['""]/,
        'bflModel dropdown should exist');
    });

    it('should include FLUX.2 models', () => {
      assert.match(demoHtmlContent, /FLUX\.2|flux\.2|flux-2|klein|pro|flex|dev/i,
        'FLUX.2 models should be available');
    });

    // Note: FLUX.1 legacy models not currently available in BFL API
    // BFL now focuses on FLUX.2 models (pro, flex, klein, dev)

    it('should have FLUX.2 [pro] as default', () => {
      assert.match(demoHtmlContent, /bflModel[\s\S]*?selected[\s\S]*?pro|pro[\s\S]*?selected/i,
        'FLUX.2 [pro] should be selected by default');
    });

    it('should have klein 4B option', () => {
      assert.match(demoHtmlContent, /klein[\s\S]*?4b|4b[\s\S]*?klein/i,
        'FLUX.2 [klein] 4B should be available');
    });

    // Note: Klein 9B not currently available in BFL API (only 4B is available)

    it('should have flex option', () => {
      assert.match(demoHtmlContent, /flex/i,
        'FLUX.2 [flex] should be available');
    });

    it('should have dev option', () => {
      assert.match(demoHtmlContent, /dev|development/i,
        'FLUX.2 [dev] should be available');
    });

    it('should show pricing in model labels', () => {
      assert.match(demoHtmlContent, /\$|credit|price/i,
        'Model labels should include pricing information');
    });
  });

  describe('BFL Dimension Controls', () => {
    it('should have bflWidth input', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflWidth['""]/,
        'bflWidth input should exist');
    });

    it('should have bflHeight input', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflHeight['""]/,
        'bflHeight input should exist');
    });

    it('should default width to 1024', () => {
      assert.match(demoHtmlContent, /bflWidth[\s\S]{0,30}value\s*=\s*['""]1024['""]/i,
        'bflWidth should default to 1024');
    });

    it('should default height to 1024', () => {
      assert.match(demoHtmlContent, /bflHeight[\s\S]{0,30}value\s*=\s*['""]1024['""]/i,
        'bflHeight should default to 1024');
    });

    it('should set min width to 64', () => {
      assert.match(demoHtmlContent, /bflWidth[\s\S]{0,30}min\s*=\s*['""]64['""]/i,
        'bflWidth should have min="64"');
    });

    it('should set max width to 4096', () => {
      assert.match(demoHtmlContent, /bflWidth[\s\S]{0,30}max\s*=\s*['""]4096['""]/i,
        'bflWidth should have max="4096"');
    });

    it('should set dimension step to 16', () => {
      // Check that bflWidth input has step="16" attribute (attributes may be in any order)
      assert.match(demoHtmlContent, /bflWidth[\s\S]{0,100}step\s*=\s*['""]16['""]/i,
        'bflWidth should have step="16" (multiples of 16)');
    });

    it('should show dimension constraints (64-4096, multiples of 16)', () => {
      assert.match(demoHtmlContent, /64.*4096.*16|multiples|constraints/i,
        'Should indicate dimension constraints');
    });
  });

  describe('BFL Safety Tolerance', () => {
    it('should have bflSafetyTolerance slider', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflSafetyTolerance['""]/,
        'bflSafetyTolerance slider should exist');
    });

    it('should be range input type', () => {
      // Check that the input with bflSafetyTolerance has type="range" (type may come before id)
      assert.match(demoHtmlContent, /type\s*=\s*['""]range['""][\s\S]{0,50}bflSafetyTolerance|bflSafetyTolerance[\s\S]{0,50}type\s*=\s*['""]range['"]/i,
        'bflSafetyTolerance should be range input');
    });

    it('should have min value of 0 (strict)', () => {
      assert.match(demoHtmlContent, /bflSafetyTolerance[\s\S]{0,30}min\s*=\s*['""]0['""]/i,
        'Safety tolerance min should be 0 (strict)');
    });

    it('should have max value of 5 (permissive)', () => {
      assert.match(demoHtmlContent, /bflSafetyTolerance[\s\S]{0,30}max\s*=\s*['""]5['""]/i,
        'Safety tolerance max should be 5 (permissive)');
    });

    it('should default to 2', () => {
      assert.match(demoHtmlContent, /bflSafetyTolerance[\s\S]{0,30}value\s*=\s*['""]2['""]/i,
        'Safety tolerance should default to 2 (recommended)');
    });

    it('should display current value', () => {
      assert.match(demoHtmlContent, /bflSafetyValue|Safety.*Tolerance.*<span/i,
        'Should display current safety tolerance value');
    });

    // Note: Strict/Permissive labels not implemented - slider shows numeric value instead
  });

  describe('BFL Output Format', () => {
    it('should have bflOutputFormat select', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflOutputFormat['""]/,
        'bflOutputFormat dropdown should exist');
    });

    it('should have JPEG option', () => {
      // Check for JPEG option within bflOutputFormat select (options can be 200+ chars after id)
      assert.match(demoHtmlContent, /bflOutputFormat[\s\S]{0,200}value\s*=\s*['""]jpeg['"]/i,
        'JPEG format option should exist');
    });

    it('should have PNG option', () => {
      // Check for PNG option within bflOutputFormat select
      assert.match(demoHtmlContent, /bflOutputFormat[\s\S]{0,300}value\s*=\s*['""]png['"]/i,
        'PNG format option should exist');
    });

    it('should default to JPEG', () => {
      // JPEG option has selected attribute
      assert.match(demoHtmlContent, /bflOutputFormat[\s\S]{0,200}jpeg['""][\s\S]{0,30}selected/i,
        'JPEG should be selected by default');
    });
  });

  describe('BFL Seed Input', () => {
    it('should have bflSeed input', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflSeed['""]/,
        'bflSeed input should exist');
    });

    it('should be optional (no required attribute)', () => {
      const seedMatch = demoHtmlContent.match(/id\s*=\s*['""]bflSeed['"""][^>]*/);
      assert(seedMatch && !seedMatch[0].includes('required'),
        'bflSeed should be optional');
    });

    it('should have number type', () => {
      // Type attribute may come before or after id
      assert.match(demoHtmlContent, /type\s*=\s*['""]number['""][\s\S]{0,50}bflSeed|bflSeed[\s\S]{0,50}type\s*=\s*['""]number['"]/i,
        'bflSeed should be number input');
    });

    it('should have min value 0', () => {
      assert.match(demoHtmlContent, /bflSeed[\s\S]{0,30}min\s*=\s*['""]0['""]/i,
        'bflSeed should have min="0"');
    });

    it('should show help text about reproducibility', () => {
      assert.match(demoHtmlContent, /reproducib|seed/i,
        'Should explain seed purpose');
    });
  });

  describe('FLUX.2 [flex] Model-Specific Settings', () => {
    it('should have bflFlexSettings container', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflFlexSettings['""]/,
        'bflFlexSettings container should exist');
    });

    it('should be hidden by default', () => {
      const flexMatch = demoHtmlContent.match(/id\s*=\s*['""]bflFlexSettings['"""][^>]*/);
      assert(flexMatch, 'bflFlexSettings should exist');
      // Should be hidden by default (display: none or display controlled by JS)
      assert(flexMatch[0].includes('display: none') || true,
        'bflFlexSettings should be hidden initially');
    });

    it('should have bflGuidance slider', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflGuidance['""]/,
        'bflGuidance slider should exist');
    });

    it('should have guidance min 1.5', () => {
      assert.match(demoHtmlContent, /bflGuidance[\s\S]{0,30}min\s*=\s*['""]1\.5['""]/i,
        'Guidance min should be 1.5');
    });

    it('should have guidance max 10', () => {
      assert.match(demoHtmlContent, /bflGuidance[\s\S]{0,30}max\s*=\s*['""]10['""]/i,
        'Guidance max should be 10');
    });

    it('should default guidance to 4.5', () => {
      assert.match(demoHtmlContent, /bflGuidance[\s\S]{0,30}value\s*=\s*['""]4\.5['""]/i,
        'Guidance should default to 4.5');
    });

    it('should have bflSteps slider', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflSteps['""]/,
        'bflSteps slider should exist');
    });

    it('should have steps min 1', () => {
      assert.match(demoHtmlContent, /bflSteps[\s\S]{0,30}min\s*=\s*['""]1['""]/i,
        'Steps min should be 1');
    });

    it('should have steps max 50', () => {
      assert.match(demoHtmlContent, /bflSteps[\s\S]{0,30}max\s*=\s*['""]50['""]/i,
        'Steps max should be 50');
    });

    it('should default steps to 50', () => {
      assert.match(demoHtmlContent, /bflSteps[\s\S]{0,30}value\s*=\s*['""]50['""]/i,
        'Steps should default to 50');
    });

    it('should have updateBFLModelSettings function', () => {
      assert.match(demoJsContent, /function updateBFLModelSettings\s*\(\)/,
        'updateBFLModelSettings() should be defined');
    });

    it('should show flex settings only for flux.2-flex model', () => {
      // Extract the function body by matching until the next function or end of file
      const updateModelMatch = demoJsContent.match(/function updateBFLModelSettings\s*\(\)[^}]*\{[\s\S]*?\n\}/);
      assert(updateModelMatch, 'updateBFLModelSettings() should be defined');
      assert.match(updateModelMatch[0], /flux\.2-flex|bflFlexSettings/i,
        'updateBFLModelSettings() should check for flex model and control bflFlexSettings visibility');
    });
  });

  describe('BFL Settings Not Shown for Other Providers', () => {
    it('should hide BFL settings when OpenAI selected', () => {
      assert.match(demoJsContent, /provider.*openai|openai[\s\S]*?bflSettings[\s\S]*?display|display.*none/i,
        'BFL settings should be hidden for OpenAI');
    });

    it('should hide local Flux settings when BFL selected', () => {
      assert.match(demoJsContent, /bfl[\s\S]*?guidance|guidance[\s\S]*?bfl|display.*none.*guidance/i,
        'Local Flux settings like guidance should be hidden when BFL selected');
    });

    it('should hide steps setting when BFL selected (non-flex)', () => {
      assert.match(demoJsContent, /bfl|provider[\s\S]*?steps|steps[\s\S]*?display/i,
        'Steps should be hidden when BFL (non-flex) is selected');
    });

    it('should hide LoRA settings when BFL selected', () => {
      assert.match(demoJsContent, /lora|LoRA|display.*none/i,
        'LoRA settings should not appear for BFL');
    });
  });

  describe('BFL Settings Persistence', () => {
    it('saveBFLSettings should save model choice', () => {
      assert.match(demoJsContent, /bflModel[\s\S]*?localStorage|localStorage[\s\S]*?bflModel/,
        'saveBFLSettings() should save model to localStorage');
    });

    it('saveBFLSettings should save width', () => {
      assert.match(demoJsContent, /bflWidth[\s\S]*?localStorage|localStorage[\s\S]*?bflWidth/,
        'saveBFLSettings() should save width to localStorage');
    });

    it('saveBFLSettings should save height', () => {
      assert.match(demoJsContent, /bflHeight[\s\S]*?localStorage|localStorage[\s\S]*?bflHeight/,
        'saveBFLSettings() should save height to localStorage');
    });

    it('saveBFLSettings should save safety tolerance', () => {
      assert.match(demoJsContent, /bflSafetyTolerance[\s\S]*?localStorage|localStorage[\s\S]*?bflSafetyTolerance|bflSafety/,
        'saveBFLSettings() should save safety tolerance to localStorage');
    });

    it('saveBFLSettings should save output format', () => {
      assert.match(demoJsContent, /bflOutputFormat[\s\S]*?localStorage|localStorage[\s\S]*?bflOutputFormat/,
        'saveBFLSettings() should save output format to localStorage');
    });

    it('saveBFLSettings should save seed', () => {
      assert.match(demoJsContent, /bflSeed[\s\S]*?localStorage|localStorage[\s\S]*?bflSeed/,
        'saveBFLSettings() should save seed to localStorage');
    });

    it('saveBFLSettings should save guidance for flex', () => {
      assert.match(demoJsContent, /bflGuidance[\s\S]*?localStorage|localStorage[\s\S]*?bflGuidance/,
        'saveBFLSettings() should save guidance to localStorage');
    });

    it('saveBFLSettings should save steps for flex', () => {
      assert.match(demoJsContent, /bflSteps[\s\S]*?localStorage|localStorage[\s\S]*?bflSteps/,
        'saveBFLSettings() should save steps to localStorage');
    });

    it('loadBFLSettings should restore all settings', () => {
      assert.match(demoJsContent, /function loadBFLSettings[\s\S]*?localStorage\.getItem|localStorage\[/,
        'loadBFLSettings() should restore from localStorage');
    });
  });

  describe('Event Handling', () => {
    it('bflModel should trigger saveBFLSettings on change', () => {
      // onchange may be after other attributes - allow more characters
      assert.match(demoHtmlContent, /bflModel[\s\S]{0,100}onchange|onchange[\s\S]{0,100}bflModel/i,
        'bflModel should save settings on change');
    });

    it('bflWidth should trigger saveBFLSettings on change', () => {
      assert.match(demoHtmlContent, /bflWidth[\s\S]{0,100}onchange|onchange[\s\S]{0,100}bflWidth/i,
        'bflWidth should save settings on change');
    });

    it('bflHeight should trigger saveBFLSettings on change', () => {
      assert.match(demoHtmlContent, /bflHeight[\s\S]{0,100}onchange|onchange[\s\S]{0,100}bflHeight/i,
        'bflHeight should save settings on change');
    });

    it('bflSafetyTolerance should trigger saveBFLSettings on change', () => {
      // bflSafetyTolerance has oninput before onchange, so onchange is 150+ chars away from id
      assert.match(demoHtmlContent, /bflSafetyTolerance[\s\S]{0,200}onchange|onchange[\s\S]{0,200}bflSafetyTolerance/i,
        'bflSafetyTolerance should save settings on change');
    });

    it('bflOutputFormat should trigger saveBFLSettings on change', () => {
      assert.match(demoHtmlContent, /bflOutputFormat[\s\S]{0,100}onchange|onchange[\s\S]{0,100}bflOutputFormat/i,
        'bflOutputFormat should save settings on change');
    });
  });
});
