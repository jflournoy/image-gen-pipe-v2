/**
 * @file OpenAI Model Selection Placement Tests (TDD REFACTOR)
 * Tests that OpenAI model selection options are located within their respective
 * provider settings sections in the sidebar, not in a separate main content section.
 *
 * Goal: Move OpenAI model dropdowns from main content into provider sections:
 * - llmModel → inside openaiLLMSettings
 * - imageModel (optional, for DALL-E ranking) → inside dalleSettings
 * - visionModel → inside openaiVisionSettings
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');

describe('🔄 REFACTOR: OpenAI Model Selection Placement', () => {
  describe('LLM Model Selection in OpenAI LLM Settings', () => {
    it('should have llmModel select inside openaiLLMSettings section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Find openaiLLMSettings section
      const openaiLLMStart = content.indexOf('id="openaiLLMSettings"');
      assert.ok(openaiLLMStart > 0, 'Should have openaiLLMSettings section');

      // Find the end of this section (next closing </div> that matches)
      // Look for llmModel select within a reasonable distance after openaiLLMSettings
      const sectionContent = content.substring(openaiLLMStart, openaiLLMStart + 2000);

      const hasLlmModelSelect =
        sectionContent.includes('id="llmModel"') ||
        sectionContent.includes("id='llmModel'");

      assert.ok(
        hasLlmModelSelect,
        'llmModel select should be inside openaiLLMSettings section'
      );
    });

    it('should show LLM model options (gpt-5-nano, gpt-5-mini, gpt-5)', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Find llmModel select and verify it has OpenAI model options
      const llmModelIndex = content.indexOf('id="llmModel"');
      assert.ok(llmModelIndex > 0, 'Should have llmModel select');

      // Check for OpenAI model options nearby
      const nearbyContent = content.substring(llmModelIndex, llmModelIndex + 1000);

      assert.ok(
        nearbyContent.includes('gpt-5') || nearbyContent.includes('GPT-5'),
        'Should have GPT-5 model options'
      );
    });

    it('should have cost hint text for LLM models', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      const openaiLLMStart = content.indexOf('id="openaiLLMSettings"');
      const sectionContent = content.substring(openaiLLMStart, openaiLLMStart + 2500);

      // Should have pricing info
      const hasPricing =
        sectionContent.includes('$0.') ||
        sectionContent.includes('cost') ||
        sectionContent.includes('/1M');

      assert.ok(
        hasPricing,
        'Should have cost information for LLM models'
      );
    });
  });

  describe('Vision Model Selection in OpenAI Vision Settings', () => {
    it('should have visionModel select inside openaiVisionSettings section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      const openaiVisionStart = content.indexOf('id="openaiVisionSettings"');
      assert.ok(openaiVisionStart > 0, 'Should have openaiVisionSettings section');

      const sectionContent = content.substring(openaiVisionStart, openaiVisionStart + 2000);

      const hasVisionModelSelect =
        sectionContent.includes('id="visionModel"') ||
        sectionContent.includes("id='visionModel'");

      assert.ok(
        hasVisionModelSelect,
        'visionModel select should be inside openaiVisionSettings section'
      );
    });

    it('should show Vision model options for image analysis', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      const visionModelIndex = content.indexOf('id="visionModel"');
      assert.ok(visionModelIndex > 0, 'Should have visionModel select');

      // Check for vision model options
      const nearbyContent = content.substring(visionModelIndex, visionModelIndex + 1000);

      assert.ok(
        nearbyContent.includes('vision') ||
        nearbyContent.includes('gpt-5') ||
        nearbyContent.includes('nano'),
        'Should have vision model options'
      );
    });
  });

  describe('Image Ranking Model Selection in DALL-E Settings', () => {
    it('should have imageModel select inside dalleSettings section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      const dalleStart = content.indexOf('id="dalleSettings"');
      assert.ok(dalleStart > 0, 'Should have dalleSettings section');

      const sectionContent = content.substring(dalleStart, dalleStart + 2500);

      const hasImageModelSelect =
        sectionContent.includes('id="imageModel"') ||
        sectionContent.includes("id='imageModel'");

      assert.ok(
        hasImageModelSelect,
        'imageModel select (for ranking) should be inside dalleSettings section'
      );
    });

    it('should show image comparison model options (gpt-image-1-mini, gpt-image-1)', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      const imageModelIndex = content.indexOf('id="imageModel"');
      assert.ok(imageModelIndex > 0, 'Should have imageModel select');

      const nearbyContent = content.substring(imageModelIndex, imageModelIndex + 1000);

      assert.ok(
        nearbyContent.includes('gpt-image') ||
        nearbyContent.includes('image-1') ||
        nearbyContent.includes('ranking'),
        'Should have image comparison model options'
      );
    });
  });

  describe('No Separate Model Selection Section in Main Content', () => {
    it('should NOT have separate "Model Selection (Optional - OpenAI Only)" section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Old section should be removed
      const hasOldSection = content.includes('Model Selection (Optional - OpenAI Only)');

      assert.ok(
        !hasOldSection,
        'Should not have separate "Model Selection (Optional - OpenAI Only)" section - models should be in provider settings'
      );
    });

    it('should NOT have modelSelectionSection div', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      const hasModelSelectionSection = content.includes('id="modelSelectionSection"');

      assert.ok(
        !hasModelSelectionSection,
        'Should not have modelSelectionSection div - model selects moved to provider sections'
      );
    });
  });

  describe('Cost Estimate Still Works', () => {
    it('should still have updateCostEstimate function', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      assert.ok(
        jsContent.includes('updateCostEstimate'),
        'Should still have updateCostEstimate function'
      );
    });

    it('should have cost summary display', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Cost summary can be in sidebar or elsewhere, just needs to exist
      assert.ok(
        content.includes('costSummary') || content.includes('cost-summary'),
        'Should have cost summary display element'
      );
    });

    it('should trigger cost update when model selection changes', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');
      const htmlContent = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have event listener for llmModel changes in JS or inline onchange in HTML
      const hasJsListener = jsContent.includes("llmModel") && jsContent.includes('updateCostEstimate');
      const hasInlineListener = htmlContent.includes('id="llmModel"') && htmlContent.includes('onchange="updateCostEstimate');

      assert.ok(
        hasJsListener || hasInlineListener,
        'Should update cost estimate when LLM model changes (via JS listener or inline onchange)'
      );
    });
  });

  describe('Provider Settings Show/Hide Logic', () => {
    it('should have updateLLMProviderSettings function that shows/hides openaiLLMSettings', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      assert.ok(
        jsContent.includes('updateLLMProviderSettings'),
        'Should have updateLLMProviderSettings function'
      );

      assert.ok(
        jsContent.includes('openaiLLMSettings'),
        'Function should reference openaiLLMSettings'
      );
    });

    it('should have updateVisionProviderSettings function that shows/hides openaiVisionSettings', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      assert.ok(
        jsContent.includes('updateVisionProviderSettings'),
        'Should have updateVisionProviderSettings function'
      );

      assert.ok(
        jsContent.includes('openaiVisionSettings'),
        'Function should reference openaiVisionSettings'
      );
    });

    it('should have updateImageProviderSettings function that shows/hides dalleSettings', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      assert.ok(
        jsContent.includes('updateImageProviderSettings'),
        'Should have updateImageProviderSettings function'
      );

      assert.ok(
        jsContent.includes('dalleSettings'),
        'Function should reference dalleSettings'
      );
    });
  });
});
