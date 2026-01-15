/**
 * 🔴 TDD RED - VLM Service UI Clarity Tests
 * Ensure UI makes it clear how VLM relates to Vision/CLIP services
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Read UI files
const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');

let demoHtml = '';
let demoJs = '';

try {
  demoHtml = fs.readFileSync(demoHtmlPath, 'utf-8');
  demoJs = fs.readFileSync(demoJsPath, 'utf-8');
} catch (e) {
  console.error('Failed to read UI files:', e);
}

describe('VLM Service UI Clarity', () => {
  describe('Settings Modal - Service Relationship', () => {
    it('should show VLM service health status in settings', () => {
      // VLM should have a health indicator like other services
      assert.ok(
        demoHtml.includes('vlmHealth') || demoHtml.includes('vlm-health'),
        'Should show VLM service health status'
      );
    });

    it('should explain that Vision scores individual images', () => {
      // Vision/CLIP explanation
      assert.ok(
        demoHtml.includes('individual') || demoHtml.includes('each image'),
        'Should explain Vision scores individual images'
      );
    });

    it('should explain that VLM compares images pairwise', () => {
      // VLM explanation
      assert.ok(
        demoHtml.includes('compares') || demoHtml.includes('head-to-head') || demoHtml.includes('pairwise'),
        'Should explain VLM compares images'
      );
    });

    it('should clarify VLM and Vision work together, not replace each other', () => {
      // Should have text explaining they're complementary
      assert.ok(
        demoHtml.includes('both') ||
        demoHtml.includes('together') ||
        demoHtml.includes('addition') ||
        demoHtml.includes('plus') ||
        demoHtml.includes('complementary'),
        'Should clarify VLM and Vision are complementary'
      );
    });
  });

  describe('Service Health Section', () => {
    it('should list VLM service in Local Service Status section', () => {
      // VLM should be listed alongside LLM, Flux, Vision
      assert.ok(
        demoHtml.includes('8004') || demoHtml.includes('VLM') || demoHtml.includes('vlm'),
        'Should list VLM service in service status'
      );
    });

    it('should show which services are required for each ranking mode', () => {
      // When VLM ranking is selected, should indicate VLM service is needed
      assert.ok(
        demoHtml.includes('required') || demoHtml.includes('needs') || demoHtml.includes('requires'),
        'Should indicate service requirements'
      );
    });
  });

  describe('JavaScript - Service Health Checking', () => {
    it('should check VLM service health', () => {
      assert.ok(
        demoJs.includes('8004') || demoJs.includes('vlm'),
        'Should check VLM service at port 8004'
      );
    });

    it('should update VLM health indicator', () => {
      assert.ok(
        demoJs.includes('vlmHealth') || demoJs.includes('vlm-health') || demoJs.includes('VLM'),
        'Should update VLM health indicator'
      );
    });

    it('should warn if VLM ranking selected but service unavailable', () => {
      // Should warn user if they select VLM mode but service is down
      assert.ok(
        demoJs.includes('unavailable') ||
        demoJs.includes('not running') ||
        demoJs.includes('service') && demoJs.includes('warn'),
        'Should warn if VLM service unavailable'
      );
    });
  });

  describe('User Guidance', () => {
    it('should provide instructions to start VLM service', () => {
      // Should tell users how to start the service
      assert.ok(
        demoHtml.includes('vlm_service') ||
        demoHtml.includes('start') && demoHtml.includes('VLM'),
        'Should provide VLM service start instructions'
      );
    });
  });
});
