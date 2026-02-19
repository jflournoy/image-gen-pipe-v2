/**
 * @file Face Fixing UI Controls Tests (TDD RED Phase)
 * Tests for face fixing UI integration in demo.html and demo.js
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

describe('🔴 RED: Face Fixing UI Controls', () => {
  describe('Face Fixing Settings Container', () => {
    it('should have face fixing settings section in HTML', () => {
      assert.match(demoHtmlContent, /Face.*Fix|face.*fix/i,
        'HTML should have a face fixing settings section');
    });

    it('should have face fixing container element', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']faceFixingSettings["']|class\s*=\s*["'][^"']*face[- ]?fixing[^"']*["']/i,
        'Face fixing settings container should exist');
    });
  });

  describe('Face Fixing Enable Checkbox', () => {
    it('should have fixFaces checkbox input', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']fixFaces["']/,
        'fixFaces checkbox should exist');
    });

    it('should be checkbox type', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']fixFaces["'][^>]*type\s*=\s*["']checkbox["']|type\s*=\s*["']checkbox["'][^>]*id\s*=\s*["']fixFaces["']/i,
        'fixFaces should be a checkbox input');
    });

    it('should be unchecked by default', () => {
      const fixFacesMatch = demoHtmlContent.match(/id\s*=\s*["']fixFaces["'][^>]*/);
      assert(fixFacesMatch, 'fixFaces element should exist');
      // Should not have checked attribute by default
      assert(!fixFacesMatch[0].includes('checked'),
        'fixFaces checkbox should be unchecked by default');
    });

    it('should have descriptive label', () => {
      assert.match(demoHtmlContent, /for\s*=\s*["']fixFaces["'][^>]*>.*Fix.*Face|label[^>]*>.*Fix.*Face.*fixFaces/i,
        'fixFaces checkbox should have a descriptive label');
    });
  });

  describe('Face Restoration Strength Slider', () => {
    it('should have restorationStrength slider input', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']restorationStrength["']/,
        'restorationStrength slider should exist');
    });

    it('should be range type', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']restorationStrength["'][^>]*type\s*=\s*["']range["']|type\s*=\s*["']range["'][^>]*id\s*=\s*["']restorationStrength["']/i,
        'restorationStrength should be a range input');
    });

    it('should have min value of 0', () => {
      assert.match(demoHtmlContent, /restorationStrength[\s\S]{0,50}min\s*=\s*["']0(?:\.0)?["']/i,
        'Restoration strength min should be 0.0');
    });

    it('should have max value of 1', () => {
      assert.match(demoHtmlContent, /restorationStrength[\s\S]{0,50}max\s*=\s*["']1(?:\.0)?["']/i,
        'Restoration strength max should be 1.0');
    });

    it('should have step of 0.1 or 0.05', () => {
      assert.match(demoHtmlContent, /restorationStrength[\s\S]{0,50}step\s*=\s*["']0\.(?:1|05)["']/i,
        'Restoration strength step should be 0.1 or 0.05');
    });

    it('should default to 0.5', () => {
      assert.match(demoHtmlContent, /restorationStrength[\s\S]{0,50}value\s*=\s*["']0\.5["']/i,
        'Restoration strength should default to 0.5');
    });

    it('should display current restoration strength value', () => {
      assert.match(demoHtmlContent, /restorationStrengthValue|Restoration.*<span/i,
        'Should display current restoration strength value');
    });

    it('should update displayed value when slider changes', () => {
      assert.match(demoJsContent, /restorationStrength[\s\S]{0,200}addEventListener|restorationStrength[\s\S]{0,200}oninput/i,
        'JS should listen for fidelity slider changes');
    });

    it('should have descriptive label explaining fidelity', () => {
      assert.match(demoHtmlContent, /fidelity.*restore|restore.*fidelity|preserve.*original|GFPGAN/i,
        'Should explain fidelity parameter (restoration strength)');
    });
  });

  describe('Face Upscale Selector', () => {
    it('should have faceUpscale select dropdown', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']faceUpscale["']/,
        'faceUpscale dropdown should exist');
    });

    it('should have option for no upscaling (1x)', () => {
      assert.match(demoHtmlContent, /faceUpscale[\s\S]{0,300}value\s*=\s*["']1["'][^>]*>.*None|No.*upscale|1x/i,
        'Should have 1x (no upscaling) option');
    });

    it('should have option for 2x upscaling', () => {
      assert.match(demoHtmlContent, /faceUpscale[\s\S]{0,300}value\s*=\s*["']2["'][^>]*>.*2x|2.*upscale/i,
        'Should have 2x upscaling option');
    });

    it('should default to 1 (no upscaling)', () => {
      const selectMatch = demoHtmlContent.match(/id\s*=\s*["']faceUpscale["'][^>]*>/);
      if (selectMatch) {
        // Find first option within the select
        const afterSelect = demoHtmlContent.substring(selectMatch.index + selectMatch[0].length);
        const firstOptionMatch = afterSelect.match(/<option[^>]*value\s*=\s*["']1["'][^>]*(?:selected|>)/i);
        assert(firstOptionMatch, 'First option should be value="1" or explicitly selected');
      }
    });

    it('should have descriptive label', () => {
      assert.match(demoHtmlContent, /for\s*=\s*["']faceUpscale["'][^>]*>.*Upscale|label[^>]*>.*Upscale.*faceUpscale/i,
        'faceUpscale should have a descriptive label');
    });
  });

  describe('Face Fixing Settings Visibility', () => {
    it('should show/hide face fixing settings based on provider support', () => {
      // Face fixing is supported by Modal and Flux providers
      assert.match(demoJsContent, /faceFixingSettings|restorationStrength|fixFaces[\s\S]{0,200}display|style\.display/i,
        'JS should control face fixing settings visibility based on provider');
    });

    it('should only show for providers that support face fixing', () => {
      // Currently: Modal and Flux support face fixing
      assert.match(demoJsContent, /modal.*face|flux.*face|face.*modal|face.*flux/i,
        'JS should check provider type for face fixing support');
    });
  });

  describe('Face Fixing Integration with Config', () => {
    it('should include fixFaces in config when generating', () => {
      assert.match(demoJsContent, /config\.fixFaces|fixFaces.*config/i,
        'fixFaces should be included in config');
    });

    it('should include restorationStrength in config', () => {
      assert.match(demoJsContent, /config\.restorationStrength|restorationStrength.*config/i,
        'restorationStrength should be included in config');
    });

    it('should include faceUpscale in config', () => {
      assert.match(demoJsContent, /config\.faceUpscale|faceUpscale.*config/i,
        'faceUpscale should be included in config');
    });

    it('should parse restorationStrength as float', () => {
      assert.match(demoJsContent, /parseFloat.*restorationStrength|restorationStrength.*parseFloat/i,
        'restorationStrength should be parsed as float');
    });

    it('should parse faceUpscale as integer', () => {
      assert.match(demoJsContent, /parseInt.*faceUpscale|faceUpscale.*parseInt/i,
        'faceUpscale should be parsed as integer');
    });
  });

  describe('Face Fixing Results Display', () => {
    it('should display face fixing metadata in results', () => {
      assert.match(demoJsContent, /face_fixing|faceFix.*metadata/i,
        'JS should handle face_fixing metadata from results');
    });

    it('should show faces detected count', () => {
      assert.match(demoJsContent, /faces_count|face.*count|detected.*face/i,
        'Should display number of faces detected');
    });

    it('should show face fixing processing time', () => {
      assert.match(demoJsContent, /face_fixing.*time|time.*face/i,
        'Should display face fixing processing time');
    });
  });

  describe('Help Text and Tooltips', () => {
    it('should have help text explaining face fixing', () => {
      assert.match(demoHtmlContent, /GFPGAN|face.*enhancement|portrait.*quality/i,
        'Should explain what face fixing does (GFPGAN, enhancement)');
    });

    it('should explain fidelity trade-off', () => {
      assert.match(demoHtmlContent, /fidelity.*0.*preserve|preserve.*original|restore.*1|restoration.*strength/i,
        'Should explain fidelity trade-off (0=preserve original, 1=full restoration)');
    });

    it('should explain upscaling options', () => {
      assert.match(demoHtmlContent, /Real-ESRGAN|upscale.*enhance|2x.*resolution/i,
        'Should explain upscaling (Real-ESRGAN, 2x enhancement)');
    });
  });
});
