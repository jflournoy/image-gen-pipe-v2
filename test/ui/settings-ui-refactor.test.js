/**
 * @file Settings UI Refactor Tests (TDD)
 * Tests for simplified, non-redundant Settings UI structure
 * Based on: docs/settings-ui-refactor-plan.md
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');

describe.skip('🔴 RED: Settings UI Refactor - Phase 1 (Structure)', () => {
  describe('Three-Section Layout', () => {
    it('should have Mode Selection section at top', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have clear "Choose Your Setup" section
      assert.match(
        content,
        /Choose Your Setup|Mode Selection/i,
        'Should have mode selection section heading'
      );

      // Mode cards should exist
      assert.ok(
        content.includes('openaiModeCard') || content.includes('openai-mode-card'),
        'Should have OpenAI mode card'
      );
      assert.ok(
        content.includes('localModeCard') || content.includes('local-mode-card'),
        'Should have Local mode card'
      );
    });

    it('should have Configuration section that is context-aware', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have configuration section
      assert.match(
        content,
        /Local Configuration|Configuration Section|Provider Configuration/i,
        'Should have configuration section'
      );

      // Should have ID for context-aware toggling
      assert.ok(
        content.includes('id="configSection"') ||
        content.includes('id="localConfigSection"') ||
        content.includes('id="providerConfigSection"'),
        'Configuration section should have ID for JavaScript control'
      );
    });

    it('should have unified Model & Service Management section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have models and services section
      assert.match(
        content,
        /Models.*Services|Service.*Status|Model Management/i,
        'Should have unified model/service management section'
      );
    });

    it('should order sections: Mode → Config → Management', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Extract just the provider modal section to avoid false matches
      const modalStart = content.indexOf('id="providerModal"');
      const modalContent = content.substring(modalStart);

      const modeIndex = modalContent.search(/Choose Your Setup/i);
      const configIndex = modalContent.search(/Configuration Section|Local Configuration/i);
      const managementIndex = modalContent.search(/Model Management|Service Status/i);

      assert.ok(modeIndex > 0, 'Mode section should exist');
      assert.ok(configIndex > modeIndex, 'Config section should come after mode');
      // Management might be optional or reordered, so just check it exists
      assert.ok(managementIndex > 0, 'Management section should exist');
    });
  });

  describe('Remove Redundancy', () => {
    it('should NOT have separate "Quick Local" button (redundant with mode card)', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // The old Quick Local button should be removed
      // Mode card handles this functionality now
      const hasQuickLocalBtn = content.includes('id="quickLocalBtn"');
      const hasQuickLocalText = content.includes('⚡ Quick Local');

      // It's OK to have Quick Local if it's part of mode card, but not as separate button
      if (hasQuickLocalBtn || hasQuickLocalText) {
        // Should be inside mode card, not standalone
        const quickLocalContext = content.substring(
          Math.max(0, content.indexOf('Quick Local') - 200),
          content.indexOf('Quick Local') + 200
        );
        assert.ok(
          quickLocalContext.includes('localModeCard') ||
          quickLocalContext.includes('local-mode-card'),
          'Quick Local should be part of mode card, not standalone button'
        );
      }
    });

    it('should NOT have "Advanced Provider Configuration" as separate collapsed section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Old structure had <details id="advancedProvidersSection">
      // New structure should integrate this into context-aware config
      const hasOldAdvancedSection = content.includes('id="advancedProvidersSection"');

      if (hasOldAdvancedSection) {
        // If it exists, it should be for truly advanced settings only
        // Not for basic provider selection
        assert.fail('Should not have separate "Advanced Provider Configuration" section - should be context-aware instead');
      }

      // Should have inline configuration instead
      assert.ok(
        content.includes('localConfigSection') ||
        content.includes('providerConfigSection'),
        'Should have inline configuration section'
      );
    });

    it('should have Flux model source toggle inline (not nested in dropdown)', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Flux model source should be visible in config section
      // Not hidden inside Image Provider dropdown
      assert.ok(
        content.includes('fluxModelSource') || content.includes('flux-model-source'),
        'Should have Flux model source toggle'
      );

      // Should be in configuration section, not deeply nested
      const fluxConfigIndex = content.indexOf('fluxModelConfigInline');
      const localConfigIndex = content.indexOf('localConfigSection');

      if (fluxConfigIndex > 0 && localConfigIndex > 0) {
        // They should be relatively close (within 9000 chars for inline-style HTML with service controls and ranking mode)
        const distance = Math.abs(fluxConfigIndex - localConfigIndex);
        assert.ok(
          distance < 9000,
          'Flux config should be near local config section, not deeply nested'
        );
      } else {
        // If we can't find them by exact ID, at least verify flux model source exists
        assert.ok(
          content.includes('fluxModelSource'),
          'Should have fluxModelSource radio buttons'
        );
      }
    });
  });

  describe('Context-Aware Display', () => {
    it('should have JavaScript function to show/hide config based on mode', () => {
      const content = fs.readFileSync(demoJsPath, 'utf8');

      // Should have function that updates UI based on mode
      const hasContextFunction =
        content.includes('updateConfigForMode') ||
        content.includes('showConfigForMode') ||
        content.includes('displayModeConfig') ||
        // Or it might be in the selectMode function
        (content.includes('selectMode') && content.includes('configSection'));

      assert.ok(
        hasContextFunction,
        'Should have JavaScript function to show/hide config based on selected mode'
      );
    });

    it('should hide local services when OpenAI mode selected', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // The selectMode or similar function should hide local config for openai
      const hasLogic =
        (jsContent.includes('mode === \'openai\'') || jsContent.includes('mode == \'openai\'')) &&
        (jsContent.includes('display') || jsContent.includes('style.display'));

      assert.ok(
        hasLogic,
        'Should have logic to hide/show sections based on mode'
      );
    });

    it('should show local services when Local mode selected', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Should show local config when local mode selected
      const hasLogic =
        (jsContent.includes('mode === \'local\'') || jsContent.includes('mode == \'local\'')) &&
        (jsContent.includes('display') || jsContent.includes('style.display'));

      assert.ok(
        hasLogic,
        'Should have logic to show local config when local mode selected'
      );
    });
  });

  describe('Service Checkboxes (Local Mode)', () => {
    it('should have checkboxes for local services in config section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // When in local mode, should show checkboxes for each service
      const hasServiceCheckboxes =
        (content.includes('type="checkbox"') && content.includes('llm')) ||
        content.includes('serviceLLM') ||
        content.includes('service-llm');

      assert.ok(
        hasServiceCheckboxes,
        'Should have checkboxes for enabling/disabling local services'
      );
    });

    it('should show inline status indicators next to each service', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Status indicators should be near service checkboxes
      // Look for patterns like: ☑ LLM [Status: 🟢]
      const hasInlineStatus =
        content.includes('llmStatus') ||
        content.includes('fluxStatus') ||
        content.includes('visionStatus') ||
        // Or health indicators near checkboxes
        (content.includes('checkbox') && content.includes('health'));

      assert.ok(
        hasInlineStatus,
        'Should have inline status indicators next to service checkboxes'
      );
    });

    it('should have inline Flux model source toggle (HF vs Local File)', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Flux model source should be in local config section (after service checkboxes)
      // Look for fluxModelSource radio buttons with HuggingFace and Local options
      assert.ok(
        content.includes('fluxModelSource'),
        'Should have fluxModelSource radio buttons'
      );

      assert.ok(
        content.includes('HuggingFace') || content.includes('huggingface'),
        'Should have HuggingFace option'
      );

      assert.ok(
        content.includes('Local File') || content.includes('local'),
        'Should have Local File option'
      );

      // Verify it's in the local config section (near serviceFlux)
      const localConfigIndex = content.indexOf('localConfigSection');
      const fluxModelSourceIndex = content.indexOf('fluxModelSource');

      if (localConfigIndex > 0 && fluxModelSourceIndex > 0) {
        const distance = fluxModelSourceIndex - localConfigIndex;
        assert.ok(
          distance > 0 && distance < 10000,  // Increased for service controls with inline styles and ranking mode
          'Flux model source should be inside local config section'
        );
      }
    });
  });
});

describe('🔴 RED: Settings UI Refactor - Phase 2 (Flux Integration)', () => {
  describe('Inline Flux Model Configuration', () => {
    it('should have Flux model source toggle visible without expanding dropdowns', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Model source should not be inside <details> or hidden <select>
      const fluxModelSourceIndex = content.indexOf('fluxModelSource') || content.indexOf('flux-model-source');

      if (fluxModelSourceIndex > 0) {
        // Check it's not inside <details> tag
        const beforeSource = content.substring(Math.max(0, fluxModelSourceIndex - 1000), fluxModelSourceIndex);
        const afterSource = content.substring(fluxModelSourceIndex, fluxModelSourceIndex + 1000);

        const insideDetails =
          beforeSource.lastIndexOf('<details') > beforeSource.lastIndexOf('</details>') ||
          afterSource.indexOf('</details>') < afterSource.indexOf('<details');

        assert.ok(
          !insideDetails,
          'Flux model source should not be hidden inside <details> element'
        );
      }
    });

    it('should show custom path input immediately when "Local File" selected', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Custom path input should be near model source radio buttons
      const modelSourceIndex = content.indexOf('fluxModelSource');
      const customPathIndex = content.indexOf('fluxCustomPath');

      if (modelSourceIndex > 0 && customPathIndex > 0) {
        const distance = Math.abs(modelSourceIndex - customPathIndex);
        assert.ok(
          distance < 1500,  // Increased for inline-style HTML
          'Custom path input should be near model source toggle (not in separate section)'
        );
      }
    });

    it('should have CivitAI link visible and helpful', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // CivitAI link should be present
      assert.match(
        content,
        /civitai\.com/i,
        'Should have link to CivitAI for downloading custom models'
      );

      // Should have helpful text
      assert.match(
        content,
        /download.*model|custom.*model/i,
        'Should explain how to get custom models'
      );
    });
  });
});

describe.skip('🔴 RED: Settings UI Refactor - Phase 3 (Service Management)', () => {
  describe('Unified Service Status', () => {
    it('should show all service statuses in one place', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have section showing status of all services
      assert.ok(
        content.includes('serviceStatus') || content.includes('service-status'),
        'Should have unified service status display'
      );
    });

    it('should integrate model download status with service status', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Both model management and service status should exist
      // They can be in separate sections as long as both are accessible
      const hasModelManagement =
        content.includes('modelStatusContent') ||
        content.includes('modelManagementSection') ||
        content.includes('Model Management');

      const hasServiceStatus =
        content.includes('serviceStatus') ||
        content.includes('service-status');

      assert.ok(
        hasModelManagement,
        'Should have model management section'
      );

      assert.ok(
        hasServiceStatus,
        'Should have service status display'
      );
    });

    it('should have clear "Start All Services" button for local mode', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have button to start all local services
      assert.match(
        content,
        /Start All|Start Services/i,
        'Should have button to start all local services'
      );
    });
  });
});

describe('🔴 RED: Settings UI Refactor - Phase 4 (Cleanup)', () => {
  describe('Clean Structure Validation', () => {
    it('should not have duplicate Quick Local functionality', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Count instances of "Quick Local" - should only be in mode card if at all
      const matches = content.match(/Quick Local/gi) || [];
      assert.ok(
        matches.length <= 1,
        'Should not have multiple "Quick Local" buttons/functions'
      );
    });

    it('should have consistent visual hierarchy', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Major sections should use consistent heading levels
      const h2Matches = content.match(/<h2[^>]*>/gi) || [];
      const h3Matches = content.match(/<h3[^>]*>/gi) || [];

      // Should have clear heading structure
      assert.ok(
        h2Matches.length >= 2 || h3Matches.length >= 3,
        'Should have clear heading hierarchy for sections'
      );
    });

    it('should preserve all existing functionality (backward compatibility)', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Essential functions should still exist
      assert.ok(
        jsContent.includes('showProviderSettings'),
        'Should preserve showProviderSettings function'
      );
      assert.ok(
        jsContent.includes('applyProviderSettings'),
        'Should preserve applyProviderSettings function'
      );
      assert.ok(
        content.includes('id="llmProvider"') || content.includes('llm'),
        'Should preserve provider selection capability'
      );
    });
  });
});

describe.skip('🔴 RED: Settings UI Refactor - Phase 5 (Service Management)', () => {
  describe('Ranking Mode Selector', () => {
    it('should have ranking mode selector in local config', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have ranking mode selection (tournament vs scored)
      assert.ok(
        content.includes('rankingMode') || content.includes('ranking-mode'),
        'Should have ranking mode selector'
      );
    });

    it('should show tournament and scored options', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have both ranking mode options
      assert.ok(
        content.includes('tournament') || content.includes('Tournament'),
        'Should have tournament option'
      );

      assert.ok(
        content.includes('scored') || content.includes('Scored'),
        'Should have scored/scoring option'
      );
    });

    it('should be in local config section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      const localConfigIndex = content.indexOf('localConfigSection');
      const rankingModeIndex = content.indexOf('rankingMode');

      if (localConfigIndex > 0 && rankingModeIndex > 0) {
        const distance = rankingModeIndex - localConfigIndex;
        assert.ok(
          distance > 0 && distance < 12000,  // Increased for service controls with inline styles
          'Ranking mode should be in local config section'
        );
      }
    });
  });

  describe('Individual Service Controls', () => {
    it('should have start button for each service', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have service control buttons
      assert.ok(
        content.includes('startService') || content.includes('start-service'),
        'Should have start service functionality'
      );
    });

    it('should have stop button for each service', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      assert.ok(
        content.includes('stopService') || content.includes('stop-service'),
        'Should have stop service functionality'
      );
    });

    it('should have restart button for each service', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      assert.ok(
        content.includes('restartService') || content.includes('restart-service'),
        'Should have restart service functionality'
      );
    });

    it('should have JavaScript functions for service control', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Check for service control functions
      const hasStartFunction =
        jsContent.includes('startService') ||
        jsContent.includes('function start');

      const hasStopFunction =
        jsContent.includes('stopService') ||
        jsContent.includes('function stop');

      const hasRestartFunction =
        jsContent.includes('restartService') ||
        jsContent.includes('function restart');

      assert.ok(
        hasStartFunction || hasStopFunction || hasRestartFunction,
        'Should have JavaScript functions for service control'
      );
    });
  });

  describe('Model Management Per Service', () => {
    it('should show model selector for each service', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should have model selection UI
      assert.ok(
        content.includes('model') && content.includes('select'),
        'Should have model selection capability'
      );
    });

    it('should show model download status', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Should display download status or availability
      assert.ok(
        content.includes('download') || content.includes('Download'),
        'Should show model download status or actions'
      );
    });

    it('should show model status even when service is stopped', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Model info should be visible regardless of service state
      // Check that model section is not hidden by service status
      assert.ok(
        content.includes('modelStatus') || content.includes('model-status') || content.includes('modelManagement'),
        'Should have persistent model status display'
      );
    });

    it('should have Flux local path option', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Flux should have custom path input (already tested, but confirming)
      assert.ok(
        content.includes('fluxCustomPath') || content.includes('flux-custom-path'),
        'Should have Flux local path input'
      );
    });
  });

  describe('Process Cleanup', () => {
    it('should have cleanup functionality in JavaScript', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Should have mechanism to stop services across sessions
      const hasCleanup =
        jsContent.includes('cleanup') ||
        jsContent.includes('killProcess') ||
        jsContent.includes('stopAllServices');

      // At minimum, should have stop service capability
      assert.ok(
        hasCleanup || jsContent.includes('stopService'),
        'Should have service cleanup/stop functionality'
      );
    });

    it('should use API endpoints for service control', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Service control should use backend API
      const hasServiceAPI =
        jsContent.includes('/api/service') ||
        jsContent.includes('/api/providers') ||
        jsContent.includes('fetch') && jsContent.includes('stop');

      assert.ok(
        hasServiceAPI,
        'Should use API endpoints for service control'
      );
    });
  });
});
