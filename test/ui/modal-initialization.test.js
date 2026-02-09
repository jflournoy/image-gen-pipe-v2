/**
 * @file Modal Initialization Tests (TDD RED)
 * Tests for proper modal state on first open
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');

describe('🔴 RED: Modal Initialization', () => {
  describe('Default Modal State', () => {
    it('should initialize modal with mode cards visible', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // initializeModeCardHighlighting should be called on modal open
      const hasInitialization =
        jsContent.includes('initializeModeCardHighlighting') &&
        (jsContent.includes('showProviderSettings') || jsContent.includes('openProviderModal'));

      assert.ok(
        hasInitialization,
        'Should call initializeModeCardHighlighting when modal opens'
      );
    });

    it('should show appropriate config section based on current providers', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Find initializeModeCardHighlighting function
      const funcStart = jsContent.indexOf('function initializeModeCardHighlighting()');
      if (funcStart === -1) {
        assert.fail('initializeModeCardHighlighting function not found');
      }

      const funcChunk = jsContent.substring(funcStart, funcStart + 3000);

      // Should handle OpenAI mode
      assert.ok(
        funcChunk.includes('isOpenAIMode') || funcChunk.includes('=== \'openai\''),
        'Should detect OpenAI mode'
      );

      // Should handle Local mode
      assert.ok(
        funcChunk.includes('isLocalMode') || funcChunk.includes('=== \'flux\''),
        'Should detect Local mode'
      );

      // Should show/hide config sections appropriately
      assert.ok(
        funcChunk.includes('configSection') && funcChunk.includes('.style.display'),
        'Should control config section visibility'
      );
    });

    it('should hide advanced dropdowns when in OpenAI or Local mode', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      const funcStart = jsContent.indexOf('function initializeModeCardHighlighting()');
      const funcChunk = jsContent.substring(funcStart, funcStart + 3000);

      // Should hide config section in OpenAI mode
      const hidesInOpenAI = funcChunk.includes('configSection.style.display = \'none\'');

      // Should hide advanced config in Local mode
      const hidesAdvancedInLocal = funcChunk.includes('advancedConfigSection.style.display = \'none\'');

      assert.ok(
        hidesInOpenAI || hidesAdvancedInLocal,
        'Should hide config sections in pure modes'
      );
    });

    it('should only show advanced config in mixed mode', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      const funcStart = jsContent.indexOf('function initializeModeCardHighlighting()');
      const funcChunk = jsContent.substring(funcStart, funcStart + 3000);

      // Should have an else branch for mixed mode
      const hasMixedMode = funcChunk.includes('else {') || funcChunk.includes('} else');

      assert.ok(
        hasMixedMode,
        'Should have logic for mixed mode (neither pure OpenAI nor pure Local)'
      );
    });
  });

  describe('Modal Open Handler', () => {
    it('should call initialization when modal opens', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Find function that opens the modal
      const hasModalOpen =
        jsContent.includes('function openProviderModal') ||
        jsContent.includes('function showProviderModal') ||
        jsContent.includes('getElementById(\'providerModal\')') &&
        jsContent.includes('.style.display = \'flex\'');

      assert.ok(
        hasModalOpen,
        'Should have function to open provider modal'
      );

      // Should call initializeModeCardHighlighting
      if (jsContent.includes('function openProviderModal')) {
        const funcStart = jsContent.indexOf('function openProviderModal');
        const funcChunk = jsContent.substring(funcStart, funcStart + 1000);

        assert.ok(
          funcChunk.includes('initializeModeCardHighlighting'),
          'openProviderModal should call initializeModeCardHighlighting'
        );
      }
    });
  });

  describe('Provider Settings Sidebar', () => {
    it('should have provider sections in sidebar', () => {
      const htmlContent = fs.readFileSync(demoHtmlPath, 'utf8');

      // New sidebar structure has provider sections always visible
      assert.ok(
        htmlContent.includes('id="llmProviderSection"') &&
        htmlContent.includes('id="imageProviderSection"') &&
        htmlContent.includes('id="visionProviderSection"'),
        'Should have provider sections in sidebar'
      );
    });

    it('should have provider settings visibility controlled by JavaScript', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Provider-specific settings are toggled by updateImageProviderSettings, etc.
      const hasSettingsControl =
        jsContent.includes('updateImageProviderSettings') &&
        jsContent.includes('updateLLMProviderSettings') &&
        jsContent.includes('.style.display');

      assert.ok(
        hasSettingsControl,
        'Provider settings visibility should be controlled by JS'
      );
    });
  });
});
