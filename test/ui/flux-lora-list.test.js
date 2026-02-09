/**
 * 🔴 TDD RED: Flux LoRA List UI Component Tests
 *
 * Tests for multiple LoRA selection UI in demo.html
 * These tests define the expected behavior before implementation.
 *
 * Requirements:
 * - Multiple LoRA support (up to 4)
 * - Each LoRA has path selector + scale slider
 * - Discovery API integration to populate available LoRAs
 * - localStorage persistence as JSON array
 * - loras array sent in beam search request
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

describe('🔴 RED: Flux Multiple LoRA List UI Component', () => {
  describe('LoRA List Container', () => {
    it('should have fluxLoraList container element', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']fluxLoraList["']/,
        'fluxLoraList container should exist in demo.html');
    });

    it('should be inside fluxSettings section', () => {
      // fluxLoraList should appear after fluxSettings id
      const fluxSettingsMatch = demoHtmlContent.match(/id\s*=\s*["']fluxSettings["']/);
      const fluxLoraListMatch = demoHtmlContent.match(/id\s*=\s*["']fluxLoraList["']/);

      assert(fluxSettingsMatch, 'fluxSettings should exist');
      assert(fluxLoraListMatch, 'fluxLoraList should exist');
      assert(fluxSettingsMatch.index < fluxLoraListMatch.index,
        'fluxLoraList should be inside or after fluxSettings');
    });
  });

  describe('Add LoRA Button', () => {
    it('should have addFluxLora button', () => {
      assert.match(demoHtmlContent, /id\s*=\s*["']addFluxLora["']/,
        'addFluxLora button should exist');
    });

    it('should call addFluxLora function on click', () => {
      assert.match(demoHtmlContent, /addFluxLora\s*\(/,
        'addFluxLora should be called (onclick or event)');
    });

    it('should have addFluxLora function defined', () => {
      assert.match(demoJsContent, /function\s+addFluxLora\s*\(/,
        'addFluxLora() function should be defined');
    });

    it('should limit to MAX_LORAS (4)', () => {
      assert.match(demoJsContent, /MAX_LORAS|maxLoras|\.length\s*>=?\s*4/i,
        'Should enforce max 4 LoRAs');
    });
  });

  describe('LoRA Entry Structure', () => {
    it('should render LoRA entries with path selector', () => {
      assert.match(demoJsContent, /lora.*path|loraPath/i,
        'LoRA entry should have path selector');
    });

    it('should render LoRA entries with scale slider', () => {
      assert.match(demoJsContent, /lora.*scale|loraScale/i,
        'LoRA entry should have scale slider');
    });

    it('should have remove button for each LoRA entry', () => {
      assert.match(demoJsContent, /removeFluxLora|removeLora/i,
        'Each LoRA entry should have remove button');
    });

    it('should have removeFluxLora function defined', () => {
      assert.match(demoJsContent, /function\s+removeFluxLora\s*\(/,
        'removeFluxLora() function should be defined');
    });
  });

  describe('LoRA Path Dropdown', () => {
    it('should use discovery API to populate LoRA paths', () => {
      assert.match(demoJsContent, /discovery\.loras|availableLoras/i,
        'Should use discovery API for LoRA paths');
    });

    it('should render path options from discovered files', () => {
      // Looking for pattern that creates <option> elements from loras array
      assert.match(demoJsContent, /loras.*map|loras.*forEach/i,
        'Should iterate over discovered loras to create options');
    });
  });

  describe('LoRA Scale Slider', () => {
    it('should have scale range 0.0 to 2.0', () => {
      assert.match(demoJsContent, /min\s*[:=]\s*["']?0|max\s*[:=]\s*["']?2/,
        'Scale slider should have min 0 and max 2');
    });

    it('should have default scale of 1.0', () => {
      assert.match(demoJsContent, /scale.*1\.0|scale.*1(?!\d)|default.*scale/i,
        'Scale should default to 1.0');
    });

    it('should display current scale value', () => {
      assert.match(demoJsContent, /loraScale.*Value|scaleValue/i,
        'Should display current scale value');
    });
  });

  describe('LoRA List Rendering', () => {
    it('should have renderFluxLoraList function', () => {
      assert.match(demoJsContent, /function\s+renderFluxLoraList\s*\(/,
        'renderFluxLoraList() function should be defined');
    });

    it('should clear and rebuild list on render', () => {
      assert.match(demoJsContent, /fluxLoraList.*innerHTML|innerHTML.*fluxLoraList/,
        'Should update fluxLoraList innerHTML');
    });

    it('should render empty state when no LoRAs', () => {
      assert.match(demoJsContent, /no.*lora|empty.*lora/i,
        'Should show empty state when no LoRAs configured');
    });
  });

  describe('LoRA State Management', () => {
    it('should track LoRAs as array', () => {
      assert.match(demoJsContent, /fluxLoras\s*=\s*\[|let\s+fluxLoras|const\s+fluxLoras/,
        'Should have fluxLoras array');
    });

    it('should store LoRA objects with path and scale', () => {
      assert.match(demoJsContent, /\{\s*path.*scale|\{\s*scale.*path/,
        'LoRA objects should have path and scale properties');
    });
  });

  describe('localStorage Persistence', () => {
    it('should save LoRAs to localStorage as JSON', () => {
      assert.match(demoJsContent, /localStorage\.setItem.*fluxLoras|setItem.*["']fluxLoras["']/,
        'Should save fluxLoras to localStorage');
    });

    it('should use JSON.stringify for LoRA array', () => {
      assert.match(demoJsContent, /JSON\.stringify.*loras|stringify.*fluxLoras/i,
        'Should JSON.stringify the loras array');
    });

    it('should load LoRAs from localStorage on init', () => {
      assert.match(demoJsContent, /localStorage\.getItem.*fluxLoras|getItem.*["']fluxLoras["']/,
        'Should load fluxLoras from localStorage');
    });

    it('should use JSON.parse for loading LoRAs', () => {
      assert.match(demoJsContent, /JSON\.parse.*fluxLoras/i,
        'Should JSON.parse the stored loras');
    });

    it('should update localStorage when LoRA added', () => {
      const addFunc = demoJsContent.match(/function\s+addFluxLora[\s\S]*?(?=\n\s*function|\n\s*const|\Z)/);
      assert(addFunc, 'addFluxLora function should exist');
      assert.match(addFunc[0], /save|localStorage/i,
        'addFluxLora should save to localStorage');
    });

    it('should update localStorage when LoRA removed', () => {
      const removeFunc = demoJsContent.match(/function\s+removeFluxLora[\s\S]*?(?=\n\s*function|\n\s*const|\Z)/);
      assert(removeFunc, 'removeFluxLora function should exist');
      assert.match(removeFunc[0], /save|localStorage/i,
        'removeFluxLora should save to localStorage');
    });
  });

  describe('Beam Search Request Integration', () => {
    it('should include loras in fluxOptions request building', () => {
      assert.match(demoJsContent, /fluxOptions[\s\S]*?loras|loras[\s\S]*?fluxOptions/,
        'fluxOptions should include loras');
    });

    it('should get loras from fluxLoras state', () => {
      assert.match(demoJsContent, /fluxLoras|getFluxLoras/,
        'Should reference fluxLoras in request building');
    });

    it('should only include non-empty loras array', () => {
      assert.match(demoJsContent, /loras.*length|if\s*\(\s*loras/i,
        'Should check loras array before including');
    });

    it('should pass loras to beam search API', () => {
      // Look for loras in request body building
      assert.match(demoJsContent, /body.*loras|loras.*options|providerOptions.*loras/i,
        'Loras should be passed to beam search API');
    });
  });

  describe('Discovery API Integration', () => {
    it('should fetch available LoRAs from discovery API', () => {
      assert.match(demoJsContent, /\/api\/providers\/flux\/discovery|discovery.*loras/i,
        'Should fetch from flux discovery API');
    });

    it('should store discovered LoRAs for dropdown population', () => {
      assert.match(demoJsContent, /availableLoras|discoveredLoras|discovery\.loras/i,
        'Should store discovered LoRAs');
    });

    it('should handle discovery API errors gracefully', () => {
      assert.match(demoJsContent, /catch.*lora|error.*lora|lora.*error/i,
        'Should handle discovery errors');
    });
  });

  describe('saveFluxSettings Integration', () => {
    it('should save LoRAs in saveFluxSettings', () => {
      // Match saveFluxSettings function body until closing brace
      const saveFunc = demoJsContent.match(/function\s+saveFluxSettings\s*\(\s*\)[\s\S]*?^\}/m);
      assert(saveFunc, 'saveFluxSettings function should exist');
      assert.match(saveFunc[0], /saveFluxLoras|fluxLoras/i,
        'saveFluxSettings should call saveFluxLoras');
    });
  });

  describe('loadFluxSettings Integration', () => {
    it('should load LoRAs in loadFluxSettings', () => {
      // Match loadFluxSettings function body until closing brace
      const loadFunc = demoJsContent.match(/function\s+loadFluxSettings\s*\(\s*\)[\s\S]*?^\}/m);
      assert(loadFunc, 'loadFluxSettings function should exist');
      assert.match(loadFunc[0], /loadFluxLoras|fluxLoras/i,
        'loadFluxSettings should call loadFluxLoras');
    });
  });

  describe('UI Labels and Help Text', () => {
    it('should have LoRAs section label', () => {
      assert.match(demoHtmlContent, /LoRA|lora/i,
        'Should have LoRA label in HTML');
    });

    it('should show max LoRAs hint', () => {
      assert.match(demoHtmlContent, /max.*4|up to 4|4.*max/i,
        'Should indicate max 4 LoRAs');
    });
  });
});

describe('🔴 RED: Flux LoRA List Contract Tests', () => {
  /**
   * These tests define the data contract for LoRA configuration
   */

  it('should define LoRA entry format: { path: string, scale: number }', () => {
    // The JS should handle this format
    const hasLoraFormat =
      demoJsContent.includes('path') &&
      demoJsContent.includes('scale') &&
      (demoJsContent.includes('fluxLoras') || demoJsContent.includes('loraList'));

    assert.ok(hasLoraFormat, 'Should handle LoRA format with path and scale');
  });

  it('should validate scale is within 0.0-2.0 range', () => {
    assert.match(demoJsContent, /scale.*[<>=].*[02]|Math\.min|Math\.max|clamp/i,
      'Should validate or clamp scale values');
  });

  it('should require path to be non-empty', () => {
    assert.match(demoJsContent, /path.*required|path.*\.length|!.*path/i,
      'Should require non-empty path');
  });
});
