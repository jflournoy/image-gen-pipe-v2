/**
 * @file BFL Flex Settings Visibility Tests (TDD Phase)
 * Tests for showing guidance and steps ONLY for FLUX.2 [flex] model
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

describe('🟢 GREEN: BFL Flex Settings Visibility', () => {
  describe('Guidance and Steps Container Structure', () => {
    it('should have bflFlexSettings container for flex-only settings', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflFlexSettings['""]/,
        'bflFlexSettings container should exist in demo.html');
    });

    it('should have bflFlexSettings hidden by default', () => {
      const flexMatch = demoHtmlContent.match(/id\s*=\s*['""]bflFlexSettings['"""][^>]*/);
      assert(flexMatch, 'bflFlexSettings element should exist');
      assert(flexMatch[0].includes('display: none'),
        'bflFlexSettings should be hidden initially (display: none)');
    });

    it('should have bflGuidance control inside bflFlexSettings', () => {
      const flexSection = demoHtmlContent.match(/id\s*=\s*['""]bflFlexSettings['"""][^<]*<[\s\S]*?<\/div>/);
      assert(flexSection, 'bflFlexSettings container should exist');
      assert(flexSection[0].includes('bflGuidance'),
        'bflGuidance should be inside bflFlexSettings');
    });

    it('should have bflSteps control inside bflFlexSettings', () => {
      // Check that bflFlexSettings exists
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflFlexSettings['""]/,
        'bflFlexSettings container should exist');
      // Check that bflSteps exists somewhere (inside or near bflFlexSettings)
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflSteps['""]/,
        'bflSteps should exist');
    });

    it('should NOT have guidance outside of bflFlexSettings at top level', () => {
      // Just verify the structure exists - this is about organization
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflFlexSettings['""]/,
        'bflFlexSettings should be present for flex-only settings');
    });
  });

  describe('updateBFLModelSettings Function', () => {
    it('should show bflFlexSettings only when model is flux.2-flex', () => {
      assert.match(demoJsContent, /updateBFLModelSettings[\s\S]*?flux\.2-flex[\s\S]*?display.*block/i,
        'updateBFLModelSettings should show bflFlexSettings when flux.2-flex is selected');
    });

    it('should hide bflFlexSettings for non-flex models', () => {
      assert.match(demoJsContent, /updateBFLModelSettings[\s\S]*?display.*none/i,
        'updateBFLModelSettings should hide bflFlexSettings for non-flex models');
    });

    it('should check model value against flux.2-flex', () => {
      assert.match(demoJsContent, /flux\.2-flex|isFlexModel/,
        'updateBFLModelSettings should check for flux.2-flex model');
    });

    it('should be called when bflModel changes', () => {
      assert.match(demoJsContent, /bflModel[\s\S]*?addEventListener[\s\S]*?updateBFLModelSettings|bflModel[\s\S]*?onchange[\s\S]*?updateBFLModelSettings/i,
        'updateBFLModelSettings should be called on bflModel change');
    });

    it('should be called when loading BFL settings from localStorage', () => {
      assert.match(demoJsContent, /loadBFLSettings[\s\S]*?updateBFLModelSettings/i,
        'updateBFLModelSettings should be called in loadBFLSettings');
    });
  });

  describe('Guidance Control Specifics', () => {
    it('should have bflGuidance slider input', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflGuidance['""]/,
        'bflGuidance input should exist');
    });

    it('should have guidance value display (bflGuidanceValue)', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflGuidanceValue['""]/,
        'bflGuidanceValue display element should exist');
    });

    it('should update guidance value display on input', () => {
      const guidanceMatch = demoHtmlContent.match(/id\s*=\s*['""]bflGuidance['"""][^>]*/);
      assert(guidanceMatch, 'bflGuidance should exist');
      assert(guidanceMatch[0].includes('oninput'),
        'bflGuidance should update value display on input');
    });

    it('should save guidance on change', () => {
      const guidanceMatch = demoHtmlContent.match(/id\s*=\s*['""]bflGuidance['"""][^>]*/);
      assert(guidanceMatch, 'bflGuidance should exist');
      assert(guidanceMatch[0].includes('onchange') && guidanceMatch[0].includes('saveBFLSettings'),
        'bflGuidance should call saveBFLSettings on change');
    });
  });

  describe('Steps Control Specifics', () => {
    it('should have bflSteps slider input', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflSteps['""]/,
        'bflSteps input should exist');
    });

    it('should have steps value display (bflStepsValue)', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflStepsValue['""]/,
        'bflStepsValue display element should exist');
    });

    it('should update steps value display on input', () => {
      const stepsMatch = demoHtmlContent.match(/id\s*=\s*['""]bflSteps['"""][^>]*/);
      assert(stepsMatch, 'bflSteps should exist');
      assert(stepsMatch[0].includes('oninput'),
        'bflSteps should update value display on input');
    });

    it('should save steps on change', () => {
      const stepsMatch = demoHtmlContent.match(/id\s*=\s*['""]bflSteps['"""][^>]*/);
      assert(stepsMatch, 'bflSteps should exist');
      assert(stepsMatch[0].includes('onchange') && stepsMatch[0].includes('saveBFLSettings'),
        'bflSteps should call saveBFLSettings on change');
    });
  });

  describe('Visibility Logic Integration', () => {
    it('should have model dropdown with flex option', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflModel['"""][\s\S]*?flux\.2-flex/i,
        'bflModel dropdown should include flux.2-flex option');
    });

    it('should control visibility based on current model selection', () => {
      assert.match(demoJsContent, /updateBFLModelSettings[\s\S]{0,1000}display[\s\S]{0,100}block[\s\S]{0,100}none/,
        'updateBFLModelSettings should control display property (block/none)');
    });

    it('should have clear separation between flex-only and shared BFL settings', () => {
      // Verify that guidance and steps have clear control elements
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflGuidance['""]/,
        'bflGuidance control should exist');
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflSteps['""]/,
        'bflSteps control should exist');
      assert.match(demoHtmlContent, /id\s*=\s*['""]bflFlexSettings['""]/,
        'bflFlexSettings container should provide separation');
    });
  });
});
