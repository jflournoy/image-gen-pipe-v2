/**
 * @file Flux Custom Model Support Tests (TDD RED)
 * Tests for pointing to locally downloaded CivitAI Flux models
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('🔴 RED: Flux Custom Model Support', () => {
  describe('Flux Service - Custom Model Loading', () => {
    it('should support FLUX_MODEL_PATH environment variable for local models', () => {
      const fluxServicePath = path.join(__dirname, '../../services/flux_service.py');
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // Should check for FLUX_MODEL_PATH env var for local model files
      assert.match(
        content,
        /FLUX_MODEL_PATH.*os\.getenv/,
        'Should support FLUX_MODEL_PATH environment variable'
      );
    });

    it('should prefer local model path over HuggingFace model name', () => {
      const fluxServicePath = path.join(__dirname, '../../services/flux_service.py');
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // If FLUX_MODEL_PATH is set, it should take precedence
      assert.ok(
        content.includes('FLUX_MODEL_PATH') || content.includes('model_path'),
        'Should have logic to prefer local model path'
      );
    });

    it('should validate that local model path exists before loading', () => {
      const fluxServicePath = path.join(__dirname, '../../services/flux_service.py');
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // Should check if path exists
      const hasPathValidation =
        content.includes('os.path.exists') ||
        content.includes('Path(') ||
        content.includes('.exists()');

      assert.ok(hasPathValidation, 'Should validate model path exists');
    });

    it('should expose current model source in health endpoint', () => {
      const fluxServicePath = path.join(__dirname, '../../services/flux_service.py');
      const content = fs.readFileSync(fluxServicePath, 'utf8');

      // Health endpoint should indicate if using HF model or local path
      assert.ok(
        content.includes('/health') && (
          content.includes('model_source') ||
          content.includes('model_type') ||
          content.includes('is_local')
        ),
        'Health endpoint should expose model source type'
      );
    });
  });

  describe('API Routes - Custom Model Configuration', () => {
    it('should expose endpoint to set custom Flux model path', () => {
      const routesPath = path.join(__dirname, '../../src/api/provider-routes.js');
      const content = fs.readFileSync(routesPath, 'utf8');

      // Should have POST endpoint to configure custom model path
      assert.match(
        content,
        /router\.post.*flux.*model|router\.post.*model.*path/i,
        'Should have endpoint to configure custom Flux model path'
      );
    });

    it('should validate custom model path before accepting', () => {
      const routesPath = path.join(__dirname, '../../src/api/provider-routes.js');
      const content = fs.readFileSync(routesPath, 'utf8');

      // Should validate path exists and is accessible
      assert.ok(
        content.includes('fs.existsSync') || content.includes('fs.accessSync'),
        'Should validate custom model path'
      );
    });

    it('should return current model configuration in status endpoint', () => {
      const routesPath = path.join(__dirname, '../../src/api/provider-routes.js');
      const content = fs.readFileSync(routesPath, 'utf8');

      // Status endpoint should include model path info
      assert.ok(
        content.includes('/providers/status') || content.includes('/providers/models/status'),
        'Should have status endpoint'
      );
    });
  });

  describe('UI - Custom Model Path Input', () => {
    it('should have input field for custom Flux model path in settings', () => {
      const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have input field for custom model path
      const hasModelPathInput =
        content.includes('id="fluxModelPath"') ||
        content.includes('id="customFluxModel"') ||
        content.includes('fluxCustomPath');

      assert.ok(hasModelPathInput, 'Should have input field for custom Flux model path');
    });

    it('should show file browser button for selecting local model', () => {
      const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have button to browse for local model file
      const hasBrowseButton =
        content.includes('Browse') ||
        content.includes('Select Model') ||
        content.includes('Choose File');

      assert.ok(
        hasBrowseButton,
        'Should have button to browse for local model'
      );
    });

    it('should explain where to find CivitAI models', () => {
      const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have helper text mentioning CivitAI
      assert.match(
        content,
        /CivitAI|civitai\.com|custom.*model|local.*model/i,
        'Should mention CivitAI or custom models in help text'
      );
    });

    it('should have toggle between HuggingFace and Local model modes', () => {
      const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have radio buttons or select for model source
      const hasModelSourceToggle =
        content.includes('modelSource') ||
        content.includes('model-source') ||
        (content.includes('HuggingFace') && content.includes('Local'));

      assert.ok(
        hasModelSourceToggle,
        'Should have toggle for HuggingFace vs Local model source'
      );
    });
  });

  describe('JavaScript - Custom Model Management', () => {
    it('should have function to set custom Flux model path', () => {
      const demoJsPath = path.join(__dirname, '../../public/demo.js');
      const content = fs.readFileSync(demoJsPath, 'utf8');

      // Should have function to configure custom model
      const hasConfigFunction =
        content.includes('setFluxModelPath') ||
        content.includes('configureFluxModel') ||
        content.includes('setCustomModel');

      assert.ok(hasConfigFunction, 'Should have function to set custom Flux model path');
    });

    it('should validate model path before sending to server', () => {
      const demoJsPath = path.join(__dirname, '../../public/demo.js');
      const content = fs.readFileSync(demoJsPath, 'utf8');

      // Should validate path format (absolute path, exists, etc.)
      const hasValidation =
        content.includes('validatePath') ||
        content.includes('path') && content.includes('startsWith');

      assert.ok(hasValidation, 'Should validate model path on client side');
    });

    it('should display current model source in UI', () => {
      const demoJsPath = path.join(__dirname, '../../public/demo.js');
      const content = fs.readFileSync(demoJsPath, 'utf8');

      // Should update UI to show which model is in use
      const hasDisplayFunction =
        content.includes('displayModelSource') ||
        content.includes('updateModelStatus') ||
        content.includes('modelSource');

      assert.ok(hasDisplayFunction, 'Should display current model source');
    });
  });

  describe('Integration - End-to-End Custom Model Flow', () => {
    it('should document custom model setup in README', () => {
      const readmePath = path.join(__dirname, '../../services/README.md');
      const content = fs.readFileSync(readmePath, 'utf8');

      // README should explain how to use custom models
      assert.match(
        content,
        /custom.*model|CivitAI|local.*model|FLUX_MODEL_PATH/i,
        'README should document custom model setup'
      );
    });

    it('should provide example of setting custom model path', () => {
      const readmePath = path.join(__dirname, '../../services/README.md');
      const content = fs.readFileSync(readmePath, 'utf8');

      // Should have example showing path format
      const hasExample =
        content.includes('/path/to/model') ||
        content.includes('export FLUX_MODEL_PATH') ||
        content.includes('.safetensors');

      assert.ok(hasExample, 'Should provide example of custom model path');
    });
  });
});
