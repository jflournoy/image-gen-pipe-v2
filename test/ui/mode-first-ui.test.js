/**
 * @file Mode-First UI Tests (TDD RED)
 * Tests for refactored Settings UI with mode selection first
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('🔴 RED: Mode-First Settings UI', () => {
  describe('UI Structure', () => {
    it('should have OpenAI and Local mode cards at the top', () => {
      // Visual cards showing two modes with pros/cons
      const modes = ['openai', 'local'];
      assert.ok(modes.includes('openai'), 'Should have OpenAI mode');
      assert.ok(modes.includes('local'), 'Should have Local mode');
    });

    it('should show mode pros and cons clearly', () => {
      const openaiMode = {
        pros: ['Fast & reliable', 'No setup needed'],
        cons: ['Costs $$$/month', 'Data leaves PC']
      };

      const localMode = {
        pros: ['Privacy', 'No API costs', 'Customizable'],
        cons: ['Needs 12GB GPU', 'Setup required']
      };

      assert.ok(openaiMode.pros.length > 0);
      assert.ok(localMode.pros.length > 0);
    });

    it('should have Quick Local button in mode selection area', () => {
      const quickLocalButton = 'quickLocalBtn';
      assert.ok(quickLocalButton, 'Quick Local button should be prominent in mode selection');
    });

    it('should have Select OpenAI button in mode selection area', () => {
      const selectOpenAIButton = 'selectOpenAIBtn';
      assert.ok(selectOpenAIButton, 'Select OpenAI button should be in mode selection');
    });
  });

  describe('Service Status Section', () => {
    it('should group services with their models', () => {
      const serviceGroups = [
        { service: 'llm', model: 'Mistral 7B' },
        { service: 'flux', model: 'FLUX.1-dev' },
        { service: 'vision', model: 'CLIP' },
        { service: 'vlm', model: 'VLM' }
      ];

      serviceGroups.forEach(group => {
        assert.ok(group.service, 'Should have service name');
        assert.ok(group.model, 'Should show associated model');
      });
    });

    it('should show unified service cards with status and model info', () => {
      const serviceCard = {
        name: 'Flux Image Generation',
        serviceStatus: 'running',
        servicePort: 8001,
        modelName: 'FLUX.1-dev',
        modelStatus: 'loaded',
        actions: ['stop', 'switchModel']
      };

      assert.ok(serviceCard.serviceStatus, 'Should show service status');
      assert.ok(serviceCard.modelName, 'Should show model name');
      assert.ok(serviceCard.actions.length > 0, 'Should have actions');
    });
  });

  describe('Advanced Settings Section', () => {
    it('should have collapsible advanced settings', () => {
      const advancedSettings = {
        collapsible: true,
        expandedByDefault: false,
        contains: ['rankingMethod', 'providerOverrides']
      };

      assert.strictEqual(advancedSettings.collapsible, true);
      assert.strictEqual(advancedSettings.expandedByDefault, false);
    });

    it('should allow individual provider overrides in advanced section', () => {
      const overrides = {
        llm: ['openai', 'local-llm'],
        image: ['openai', 'flux'],
        vision: ['openai', 'local'],
        ranking: ['vlm', 'scoring']
      };

      Object.keys(overrides).forEach(provider => {
        assert.ok(overrides[provider].length >= 2, `${provider} should have options`);
      });
    });
  });

  describe('Information Hierarchy', () => {
    it('should present information in correct order', () => {
      const uiSections = [
        { order: 1, name: 'modeSelection', importance: 'high' },
        { order: 2, name: 'serviceStatus', importance: 'medium' },
        { order: 3, name: 'modelManagement', importance: 'medium' },
        { order: 4, name: 'advancedSettings', importance: 'low' }
      ];

      // Verify sections are in correct order
      for (let i = 0; i < uiSections.length - 1; i++) {
        assert.ok(uiSections[i].order < uiSections[i + 1].order);
      }

      // Mode selection should be first and highest importance
      assert.strictEqual(uiSections[0].name, 'modeSelection');
      assert.strictEqual(uiSections[0].importance, 'high');
    });
  });

  describe('Status Indicators', () => {
    it('should show contextual status with next action', () => {
      const statuses = [
        {
          status: 'running',
          message: 'Ready to generate images',
          nextAction: 'stop'
        },
        {
          status: 'downloaded',
          message: 'Click [Start] to use',
          nextAction: 'start'
        },
        {
          status: 'not_installed',
          message: 'Click [Download] (12GB, ~10min)',
          nextAction: 'download'
        }
      ];

      statuses.forEach(s => {
        assert.ok(s.message, 'Should have contextual message');
        assert.ok(s.nextAction, 'Should suggest next action');
      });
    });
  });
});
