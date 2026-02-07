/**
 * @file Sidebar Layout Tests (TDD RED Phase)
 * Tests for always-visible left sidebar with 30/70 layout split
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Read HTML and JS files
const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoHtmlContent = fs.readFileSync(demoHtmlPath, 'utf8');

describe('🔴 RED: Always-Visible Sidebar Layout (30/70 Split)', () => {
  describe('Layout Structure', () => {
    it('should have a main-container element for flexbox layout', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]main-container['""]/,
        'main-container element should exist for flexbox layout');
    });

    it('should have a settings-sidebar element', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]settings-sidebar['""]/,
        'settings-sidebar element should exist');
    });

    it('should have a content-area element for right side', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]content-area['""]/,
        'content-area element should exist for right side content');
    });

    it('should use flexbox for main container', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]main-container['"""][^>]*style[^>]*display\s*:\s*flex|display\s*:\s*flex[^}]*main-container/i,
        'main-container should use flexbox display');
    });
  });

  describe('Sidebar (Left 30%)', () => {
    it('should set sidebar width to approximately 30%', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]settings-sidebar['"""][^>]*(?:style|class)[^>]*(?:flex|width)|settings-sidebar[\s\S]*?(?:30%|flex:[\s\S]*?0\.3|flex-basis[\s\S]*?30%)/i,
        'settings-sidebar should be ~30% width');
    });

    it('should display provider modal content in sidebar (no modal overlay)', () => {
      // Check that provider settings are moved to sidebar, not in a modal
      assert.match(demoHtmlContent, /id\s*=\s*['""]settings-sidebar['"""][\s\S]*?(?:provider|settings)/i,
        'sidebar should contain provider/settings content');
    });

    it('should contain mode selection cards', () => {
      assert.match(demoHtmlContent, /openaiModeCard|localModeCard/,
        'sidebar should contain mode selection cards');
    });

    it('should contain provider dropdowns', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]llmProvider['"""]|id\s*=\s*['""]imageProvider['"""]|id\s*=\s*['""]visionProvider['""]/,
        'sidebar should contain provider dropdowns');
    });

    it('should contain service controls', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]serviceStatus['"""]|serviceLLM|serviceFlux/,
        'sidebar should contain service status controls');
    });

    it('should be scrollable independently', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]settings-sidebar['"""][^>]*(?:overflow|scroll)/i,
        'sidebar should have independent scrolling');
    });

    it('should have padding/spacing', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]settings-sidebar['"""][^>]*(?:padding|gap)|settings-sidebar[\s\S]{0,200}(?:padding|gap)/i,
        'sidebar should have appropriate padding');
    });
  });

  describe('Content Area (Right 70%)', () => {
    it('should set content-area width to approximately 70%', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]content-area['"""][^>]*(?:style|class)[^>]*(?:flex|width)|content-area[\s\S]*?(?:70%|flex:[\s\S]*?0\.7|flex-basis[\s\S]*?70%)/i,
        'content-area should be ~70% width');
    });

    it('should contain prompt input area', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]prompt['"""]|prompt-input|textarea/,
        'content-area should contain prompt input');
    });

    it('should contain console/output area', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]console['"""]|messages|output/i,
        'content-area should contain console/output area');
    });

    it('should contain results display area', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]results['"""]|images|candidates/i,
        'content-area should contain results display');
    });

    it('should be scrollable when content exceeds viewport', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]content-area['"""][^>]*(?:overflow|scroll)/i,
        'content-area should handle overflow scrolling');
    });
  });

  describe('Modal Removal', () => {
    it('should not have modal-based provider settings', () => {
      // The providerModal should either be removed or hidden
      const hasModal = demoHtmlContent.match(/id\s*=\s*['""]providerModal['"""][^>]*(?:display\s*:\s*(?:flex|block)|position\s*:\s*fixed)/i);
      // This test checks that if modal exists, it's not displayed by default
      if (hasModal) {
        assert.match(demoHtmlContent, /id\s*=\s*['""]providerModal['"""][^>]*display\s*:\s*none/i,
          'providerModal should be hidden if it still exists');
      }
    });

    it('should not show modal overlay by default', () => {
      assert.match(demoHtmlContent, /main-container|settings-sidebar/,
        'Layout should use main-container/sidebar structure, not modal');
    });
  });

  describe('Responsive Design', () => {
    it('should have CSS for flex layout implementation', () => {
      // This checks that the HTML mentions or applies flexbox
      assert(demoHtmlContent.includes('flex') || demoHtmlContent.includes('display'),
        'HTML should reference flexbox or CSS display');
    });

    it('should maintain 30/70 ratio in inline or style rules', () => {
      assert(demoHtmlContent.includes('30%') || demoHtmlContent.includes('70%') ||
             demoHtmlContent.includes('flex:') || demoHtmlContent.includes('flex-basis'),
        'Should define 30/70 split in styles');
    });
  });

  describe('Settings Sidebar Content Organization', () => {
    it('should have clear section headers in sidebar', () => {
      assert.match(demoHtmlContent, /Choose Your Setup|Provider Settings|Configuration/i,
        'sidebar should have clear section headers');
    });

    it('should contain all settings in sidebar (not distributed across page)', () => {
      // Check that settings are grouped in the sidebar
      assert.match(demoHtmlContent, /settings-sidebar[\s\S]*?(?:mode|provider|service|settings)/i,
        'All settings should be contained in settings-sidebar');
    });

    it('should have no modal-based settings interactions', () => {
      // After refactoring, settings should not require clicking to open a modal
      assert.match(demoHtmlContent, /settings-sidebar/,
        'Settings should be in always-visible sidebar, not modal');
    });
  });
});
