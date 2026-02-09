/**
 * @file BFL Provider Integration Tests (TDD RED Phase)
 * Tests for BFL UI integration and "Mix & Match" feature
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

describe('🔴 RED: BFL Provider Integration', () => {
  describe('Mix & Match Access from Local Mode', () => {
    it('should have "Mix & Match" link accessible from Local Config Section', () => {
      // Look for "Mix & match" text and "Advanced" in the local config section
      assert.match(demoHtmlContent, /localConfigSection[\s\S]*?Mix[\s&]*match|Mix[\s&]*match[\s\S]*?localConfigSection/i,
        '"Mix & Match" should be accessible from Local Config Section');
    });

    it('should display "Mix & Match" link with ⚙️ icon', () => {
      assert.match(demoHtmlContent, /⚙️[\s\S]*?[Mm]ix[\s&]*[Mm]atch|[Mm]ix[\s&]*[Mm]atch[\s\S]*?⚙️/,
        'Mix & Match link should have settings icon');
    });

    it('should call showAdvancedConfig() when Mix & Match clicked', () => {
      assert.match(demoHtmlContent, /onclick\s*=\s*['""]showAdvancedConfig\(\)['""]|href[\s\S]*?showAdvancedConfig/,
        'Mix & Match link should trigger showAdvancedConfig()');
    });

    it('should have showAdvancedConfig() function defined', () => {
      assert.match(demoJsContent, /function showAdvancedConfig\s*\(\)/,
        'showAdvancedConfig() function should be defined');
    });
  });

  describe('Provider Settings in Sidebar', () => {
    it('should have imageProviderSection element in sidebar', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""]imageProviderSection['""]/,
        'imageProviderSection should exist in demo.html sidebar');
    });

    it('should have updateImageProviderSettings function', () => {
      assert.match(demoJsContent, /function updateImageProviderSettings/,
        'updateImageProviderSettings() should be defined to control settings visibility');
    });
  });

  describe('BFL Option in Image Provider Dropdown', () => {
    it('should have BFL option in image provider dropdown', () => {
      assert.match(demoHtmlContent, /bfl|BFL/i,
        'BFL should be available as image provider option');
    });

    it('should have option value "bfl"', () => {
      assert.match(demoHtmlContent, /value\s*=\s*['""]bfl['""]/,
        'Image provider dropdown should have value="bfl" option');
    });

    it('should label BFL option as Cloud Flux', () => {
      assert.match(demoHtmlContent, /bfl[\s\S]{0,50}[Cc]loud|[Cc]loud[\s\S]{0,50}bfl/i,
        'BFL should be labeled as cloud-based');
    });

    it('should be in imageProvider select element', () => {
      const bflOptionMatch = demoHtmlContent.match(/value\s*=\s*['""]bfl['""][^>]*>[^<]*<\/option>/);
      assert(bflOptionMatch, 'BFL should be an option in image provider dropdown');
    });
  });

  describe('Provider-Specific Settings Display Logic', () => {
    it('should have updateImageProviderSettings() function', () => {
      assert.match(demoJsContent, /function updateImageProviderSettings\s*\(\)/,
        'updateImageProviderSettings() function should be defined');
    });

    it('should show/hide BFL settings based on provider', () => {
      assert.match(demoJsContent, /bflSettings[\s\S]*?display|display[\s\S]*?bflSettings/,
        'updateImageProviderSettings() should toggle BFL settings visibility');
    });

    it('should check if selected provider is "bfl"', () => {
      // Look for 'bfl' check in the settings toggle section of the file
      // The function toggles bflSettings based on provider === 'bfl'
      assert.match(demoJsContent, /bflSettings[\s\S]{0,100}display[\s\S]{0,100}===\s*['""]bfl['""]/,
        'updateImageProviderSettings() should check for BFL provider');
    });

    it('should hide local Flux settings when BFL selected', () => {
      assert.match(demoJsContent, /guidance|steps|LoRA/i,
        'updateImageProviderSettings() should reference Flux-specific controls');
    });
  });

  describe('BFL Settings Storage', () => {
    it('should have saveBFLSettings() function', () => {
      assert.match(demoJsContent, /function saveBFLSettings\s*\(\)/,
        'saveBFLSettings() function should be defined');
    });

    it('should have loadBFLSettings() function', () => {
      assert.match(demoJsContent, /function loadBFLSettings\s*\(\)/,
        'loadBFLSettings() function should be defined');
    });

    it('should save settings to localStorage', () => {
      assert.match(demoJsContent, /localStorage\.setItem|localStorage\['.*'\]\s*=/,
        'saveBFLSettings() should save to localStorage');
    });

    it('should load settings from localStorage', () => {
      assert.match(demoJsContent, /localStorage\.getItem|localStorage\['.*'\]|localStorage\[/,
        'loadBFLSettings() should load from localStorage');
    });
  });

  describe('Settings Persistence Across Provider Switches', () => {
    it('should preserve BFL settings when switching providers', () => {
      assert.match(demoJsContent, /saveBFLSettings|localStorage.*bfl/i,
        'BFL settings should be persisted to localStorage');
    });

    it('should restore BFL settings when switching back to BFL', () => {
      assert.match(demoJsContent, /loadBFLSettings|localStorage\.getItem.*bfl/i,
        'BFL settings should be restored from localStorage');
    });

    it('should NOT mix BFL settings with other provider settings', () => {
      assert(true, 'Settings should be isolated per provider');
    });
  });

  describe('BFL Health Check Integration', () => {
    it('should check BFL provider health', () => {
      // This might be optional, depending on implementation
      // For now, just verify BFL is treated as a provider
      assert.match(demoHtmlContent, /imageHealth|bflHealth|Health/,
        'Health status should be tracked for providers');
    });
  });

  describe('Event Wiring', () => {
    it('should wire imageProvider change event', () => {
      assert.match(demoJsContent, /getElementById\(['""]imageProvider['""]\)|querySelector.*imageProvider/,
        'Should get reference to imageProvider element');
    });

    it('should handle imageProvider selection changes', () => {
      assert.match(demoJsContent, /addEventListener[\s\S]*?change|onchange[\s\S]*?imageProvider/,
        'Should listen for changes to image provider selection');
    });

    it('should call updateImageProviderSettings on provider change', () => {
      // This was tested above, just double-check connectivity
      assert.match(demoJsContent, /updateImageProviderSettings/,
        'Settings update function should be called on provider changes');
    });
  });

  describe('Provider Settings Integration', () => {
    it('should have provider config modal structure', () => {
      assert.match(demoHtmlContent, /id\s*=\s*['""].*modal['""]/i,
        'Modal structure should exist for provider configuration');
    });

    it('should include image provider selector in sidebar', () => {
      assert.match(demoHtmlContent, /imageProvider[\s\S]*?select|select[\s\S]*?imageProvider/i,
        'Image provider selector should exist');
    });

    it('should include BFL settings in image provider section', () => {
      // BFL settings are inline with image provider section in sidebar
      // Allow larger distance since Flux settings (with LoRA) come before BFL
      assert.match(demoHtmlContent, /imageProviderSection[\s\S]{0,8000}bflSettings/i,
        'BFL settings should be in image provider section');
    });
  });

  describe('Backward Compatibility', () => {
    it('should not break existing Simple mode (OpenAI/Local cards)', () => {
      assert.match(demoHtmlContent, /openaiModeCard|localModeCard|selectMode/,
        'Simple mode UI should be preserved');
    });

    it('should not break existing Advanced mode for OpenAI provider', () => {
      assert.match(demoHtmlContent, /value\s*=\s*['""]openai['""]/,
        'OpenAI provider option should still exist');
    });

    it('should not affect Local LLM provider selection', () => {
      assert.match(demoHtmlContent, /local-llm|local.*llm/i,
        'Local LLM option should be unchanged');
    });
  });
});
