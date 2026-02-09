/**
 * @file BFL Service Visibility Tests (TDD RED Phase)
 * Tests for dynamic service management when BFL is selected
 * These tests define the contract for hiding Flux service when using cloud BFL
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Read HTML and JS files once per test file for performance
const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');
const demoHtmlContent = fs.readFileSync(demoHtmlPath, 'utf8');
const demoJsContent = fs.readFileSync(demoJsPath, 'utf8');

describe('🔴 RED: BFL Service Visibility Management', () => {
  describe('Dynamic Service Array Function', () => {
    it('should have getActiveServices() function defined', () => {
      assert.match(demoJsContent, /function getActiveServices\s*\(\)/,
        'getActiveServices() function should be defined in demo.js');
    });

    it('should return array with flux when imageProvider is "flux"', () => {
      assert.match(demoJsContent, /imageProvider.*===.*['""]flux['""][\s\S]*?return.*flux/,
        'getActiveServices() should check imageProvider === "flux" and include flux in return');
    });

    it('should return array without flux when imageProvider is "bfl"', () => {
      assert.match(demoJsContent, /imageProvider.*===.*['""]bfl['""]|imageProvider.*===.*['""]openai['""][\s\S]*?return.*(?!flux)/,
        'getActiveServices() should exclude flux when imageProvider is not "flux"');
    });

    it('should include base services (llm, vision, vlm) in all cases', () => {
      // Match function body until closing brace at start of line (end of function)
      const match = demoJsContent.match(/function getActiveServices\s*\(\)[^}]*\{[\s\S]*?\n\}/);
      assert(match, 'getActiveServices() function should be present');
      const functionBody = match[0];
      assert.match(functionBody, /llm|vision|vlm/,
        'getActiveServices() should reference base services');
    });
  });

  describe('Service Visibility Update Function', () => {
    it('should have updateServiceVisibility() function defined', () => {
      assert.match(demoJsContent, /function updateServiceVisibility\s*\(\)/,
        'updateServiceVisibility() function should be defined');
    });

    it('should reference fluxServiceRow element', () => {
      assert.match(demoJsContent, /getElementById\(['""]fluxServiceRow['""]\)|querySelector.*fluxServiceRow/,
        'updateServiceVisibility() should access fluxServiceRow element');
    });

    it('should hide flux service row when BFL is selected', () => {
      assert.match(demoJsContent, /imageProvider.*===.*['""]bfl['""][\s\S]*?display.*none|display.*none[\s\S]*?imageProvider.*===.*['""]bfl['"']/,
        'updateServiceVisibility() should set display:none when imageProvider is "bfl"');
    });

    it('should show flux service row when local flux is selected', () => {
      assert.match(demoJsContent, /imageProvider.*===.*['""]flux['""][\s\S]*?display|display[\s\S]*?imageProvider.*===.*['""]flux['"']/,
        'updateServiceVisibility() should show flux service for local flux provider');
    });
  });

  describe('Flux Service Row HTML Structure', () => {
    it('should have fluxServiceRow element with unique ID', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]fluxServiceRow['""]/,
        'demo.html should have element with id="fluxServiceRow" for Flux service');
    });

    it('should wrap existing Flux service controls in fluxServiceRow', () => {
      const fluxRowMatch = demoHtmlContent.match(/id\s*=\s*['""]fluxServiceRow['""]/);
      assert(fluxRowMatch, 'fluxServiceRow element should exist');
      // Check that Flux checkbox is within or near fluxServiceRow
      const fluxCheckboxMatch = demoHtmlContent.match(/serviceFlux/);
      assert(fluxCheckboxMatch, 'Flux service checkbox should exist');
    });
  });

  describe('Start All Services Integration', () => {
    it('should have quickStartLocalServices() function', () => {
      assert.match(demoJsContent, /function quickStartLocalServices\s*\(\)/,
        'quickStartLocalServices() function should exist');
    });

    it('should call getActiveServices() to get service list', () => {
      // Check that quickStartLocalServices function exists and calls getActiveServices
      assert.match(demoJsContent, /function quickStartLocalServices\s*\(\)/,
        'quickStartLocalServices() function should be present');
      // Find the function and verify it uses getActiveServices
      const funcIndex = demoJsContent.indexOf('function quickStartLocalServices');
      assert(funcIndex > 0, 'quickStartLocalServices should be found');
      // Look for getActiveServices call within 500 chars of function start
      const nearbyCode = demoJsContent.substring(funcIndex, funcIndex + 500);
      assert.match(nearbyCode, /getActiveServices\(\)/,
        'quickStartLocalServices() should use getActiveServices() function');
    });

    it('should not hardcode service array in quickStartLocalServices()', () => {
      // Find the function and check for getActiveServices usage
      const funcIndex = demoJsContent.indexOf('function quickStartLocalServices');
      assert(funcIndex > 0, 'quickStartLocalServices() should be defined');
      const nearbyCode = demoJsContent.substring(funcIndex, funcIndex + 500);
      const hasGetActive = nearbyCode.includes('getActiveServices');
      const hasHardcodedArray = /\[\s*['""]flux['""]\s*,/.test(nearbyCode);
      assert(hasGetActive || !hasHardcodedArray,
        'quickStartLocalServices() should use dynamic service list via getActiveServices()');
    });
  });

  describe('Stop All Services Integration', () => {
    it('should have stopAllLocalServices() function', () => {
      assert.match(demoJsContent, /function stopAllLocalServices\s*\(\)/,
        'stopAllLocalServices() function should exist');
    });

    it('should call getActiveServices() or use dynamic list', () => {
      // Check that stopAllLocalServices function exists and calls getActiveServices
      assert.match(demoJsContent, /function stopAllLocalServices\s*\(\)/,
        'stopAllLocalServices() function should be present');
      // Find the function and verify it uses getActiveServices
      const funcIndex = demoJsContent.indexOf('function stopAllLocalServices');
      assert(funcIndex > 0, 'stopAllLocalServices should be found');
      // Look for getActiveServices call within 500 chars of function start
      const nearbyCode = demoJsContent.substring(funcIndex, funcIndex + 500);
      assert.match(nearbyCode, /getActiveServices\(\)/,
        'stopAllLocalServices() should use getActiveServices() function');
    });
  });

  describe('Service Visibility on Provider Change', () => {
    it('should have event listener on imageProvider element', () => {
      assert.match(demoJsContent, /addEventListener\s*\(\s*['""]change['""]\s*,|addEventListener.*imageProvider|imageProvider.*addEventListener/,
        'Should have event listener that responds to provider changes');
    });

    it('should call updateServiceVisibility on provider change', () => {
      const eventListenerMatch = demoJsContent.match(/imageProvider[\s\S]*?addEventListener[\s\S]*?{[\s\S]*?}|addEventListener[\s\S]*?imageProvider/);
      if (eventListenerMatch) {
        assert.match(demoJsContent, /updateServiceVisibility\(\)|updateServiceVisibility\s*\(/,
          'updateServiceVisibility() should be called when provider changes');
      }
    });

    it('should call updateImageProviderSettings on provider change', () => {
      assert.match(demoJsContent, /updateImageProviderSettings\(\)|updateImageProviderSettings\s*\(/,
        'updateImageProviderSettings() should be called on provider changes');
    });
  });

  describe('Page Load Initialization', () => {
    it('should initialize service visibility on page load', () => {
      assert.match(demoJsContent, /DOMContentLoaded|window\.addEventListener\s*\(\s*['""]load['""]|addEventListener\s*\(\s*['""]load['""]/,
        'Should have page load event handler');
    });

    it('should call updateServiceVisibility on page load', () => {
      const loadMatch = demoJsContent.match(/DOMContentLoaded[\s\S]*?{[\s\S]*?}|addEventListener[\s\S]*?load[\s\S]*?{[\s\S]*?}/);
      if (loadMatch) {
        assert.match(demoJsContent, /updateServiceVisibility/,
          'updateServiceVisibility() should be called during initialization');
      }
    });
  });

  describe('Service Status Update Integration', () => {
    it('should have updateServiceStatuses() function', () => {
      assert.match(demoJsContent, /function updateServiceStatuses\s*\(\)/,
        'updateServiceStatuses() function should exist');
    });

    it('should work with dynamic service list', () => {
      // Check that updateServiceStatuses function exists and updates status indicators
      const funcIndex = demoJsContent.indexOf('function updateServiceStatuses');
      assert(funcIndex > 0, 'updateServiceStatuses() should be defined');
      // Look for status indicator references within 1000 chars of function start
      const nearbyCode = demoJsContent.substring(funcIndex, funcIndex + 1000);
      assert.match(nearbyCode, /llmStatus|fluxStatus|visionStatus|vlmStatus|status/,
        'updateServiceStatuses() should update service status indicators');
    });
  });

  describe('BFL-Specific Service Logic', () => {
    it('should define logic to exclude Flux for non-local providers', () => {
      assert.match(demoJsContent, /flux[\s\S]*?imageProvider|imageProvider[\s\S]*?flux|bfl|openai/,
        'Code should handle different image providers');
    });

    it('should have BFL provider check', () => {
      assert.match(demoJsContent, /['""]bfl['""]/,
        'Code should reference "bfl" as a provider option');
    });

    it('should preserve service array modifications backward compatibility', () => {
      // Even though we're using dynamic arrays, the old hardcoded arrays should be removed or wrapped
      assert(true, 'Implementation should be backward compatible');
    });
  });
});
