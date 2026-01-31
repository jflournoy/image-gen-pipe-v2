/**
 * @file Settings UI Cleanup Tests (TDD RED)
 * Tests for removing redundancy and fixing status display
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');

describe('🔴 RED: Settings UI Cleanup', () => {
  describe('Remove Redundant Buttons', () => {
    it('should have only ONE "Start All Services" button', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Count button elements with quickStartLocalServices onclick
      const buttonMatches = content.match(/<button[^>]*onclick="quickStartLocalServices\(\)"/g) || [];

      // Should only have one Start All Services button
      assert.strictEqual(
        buttonMatches.length,
        1,
        `Should have only ONE Start All Services button, found ${buttonMatches.length}`
      );
    });

    it('should not have duplicate service control sections', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // Look for sections with service status divs
      const serviceStatusMatches = content.match(/id="serviceStatus"/g) || [];

      assert.ok(
        serviceStatusMatches.length === 1,
        `Should have only ONE serviceStatus div, found ${serviceStatusMatches.length}`
      );
    });

    it('should not have old "Local Service Status" section', () => {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');

      // The old duplicate section should be removed
      // It was causing crashes when stopping services
      const hasOldSection = content.includes('Local Service Status') &&
                          content.includes('id="serviceHealth"');

      assert.ok(
        !hasOldSection,
        'Should not have the old duplicate "Local Service Status" section'
      );
    });
  });

  describe('Accurate Status Display', () => {
    it('should update status from API endpoint, not hardcoded', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // updateServiceStatuses should fetch from /api/services/status
      assert.ok(
        jsContent.includes('/api/services/status'),
        'Should fetch status from /api/services/status endpoint'
      );

      // Should update all service status indicators
      const hasLLMUpdate = jsContent.includes('llmStatus') && jsContent.includes('.textContent');
      const hasFluxUpdate = jsContent.includes('fluxStatus') && jsContent.includes('.textContent');
      const hasVisionUpdate = jsContent.includes('visionStatus') && jsContent.includes('.textContent');
      const hasVLMUpdate = jsContent.includes('vlmStatus') && jsContent.includes('.textContent');

      assert.ok(
        hasLLMUpdate,
        'Should update llmStatus indicator'
      );
      assert.ok(
        hasFluxUpdate,
        'Should update fluxStatus indicator'
      );
      assert.ok(
        hasVisionUpdate,
        'Should update visionStatus indicator'
      );
      assert.ok(
        hasVLMUpdate,
        'Should update vlmStatus indicator'
      );
    });

    it('should use status from backend, not provider health', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Find the updateServiceStatuses function
      const funcStart = jsContent.indexOf('async function updateServiceStatuses()');
      if (funcStart === -1) {
        assert.fail('updateServiceStatuses function not found');
      }

      // Get a reasonable chunk of the function (next 1000 chars should be enough)
      const funcChunk = jsContent.substring(funcStart, funcStart + 1000);

      // Should fetch from services endpoint
      assert.ok(
        funcChunk.includes('/api/services/status'),
        'updateServiceStatuses should use /api/services/status'
      );

      // Should NOT use providers/health for service status
      assert.ok(
        !funcChunk.includes('/api/providers/health'),
        'Should not use /api/providers/health for service status updates'
      );
    });

    it('should show green (🟢) when service is running', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Status indicators should use 🟢 for running services
      assert.ok(
        jsContent.includes('🟢'),
        'Should use 🟢 emoji for running services'
      );
    });

    it('should show white/gray (⚪) when service is stopped', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Status indicators should use ⚪ for stopped services
      assert.ok(
        jsContent.includes('⚪'),
        'Should use ⚪ emoji for stopped services'
      );
    });

    it('should update status after starting a service', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // After starting a service, should update status display
      // Look for startService function that calls updateServiceStatuses
      const hasStartServiceWithUpdate =
        jsContent.includes('async function startService') &&
        jsContent.includes('updateServiceStatuses');

      assert.ok(
        hasStartServiceWithUpdate,
        'startService should call updateServiceStatuses to refresh status'
      );
    });

    it('should update status after stopping a service', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // After stopping a service, should update status display
      // Look for stopService function that calls updateServiceStatuses
      const hasStopServiceWithUpdate =
        jsContent.includes('async function stopService') &&
        jsContent.includes('updateServiceStatuses');

      assert.ok(
        hasStopServiceWithUpdate,
        'stopService should call updateServiceStatuses to refresh status'
      );
    });

    it('should poll status regularly to detect external changes', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Should have some mechanism to periodically update status
      // This catches services started/stopped outside the UI
      const hasInterval = jsContent.includes('setInterval') &&
                         jsContent.includes('updateServiceStatuses');

      const hasPolling = jsContent.includes('poll') ||
                        jsContent.includes('refresh') ||
                        hasInterval;

      assert.ok(
        hasPolling,
        'Should have mechanism to periodically update service status'
      );
    });
  });

  describe('Status Display Integration', () => {
    it('should initialize status on modal open', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // When opening settings modal, should update service statuses
      // Check if modal open handler calls updateServiceStatuses
      const hasInitialization =
        jsContent.includes('initializeModeCardHighlighting') &&
        jsContent.includes('updateServiceStatuses');

      assert.ok(
        hasInitialization,
        'Should update service statuses when settings modal opens'
      );
    });

    it('should handle API errors gracefully', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // Find the updateServiceStatuses function
      const funcStart = jsContent.indexOf('async function updateServiceStatuses()');
      if (funcStart === -1) {
        assert.fail('updateServiceStatuses function not found');
      }

      // Get a reasonable chunk of the function (2000 chars for template literals)
      const funcChunk = jsContent.substring(funcStart, funcStart + 2000);

      assert.ok(
        funcChunk.includes('try') && funcChunk.includes('catch'),
        'updateServiceStatuses should have try-catch error handling'
      );
    });

    it('should use consistent status indicator IDs', () => {
      const htmlContent = fs.readFileSync(demoHtmlPath, 'utf8');
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // HTML should have status span elements
      assert.ok(
        htmlContent.includes('id="llmStatus"'),
        'HTML should have llmStatus element'
      );
      assert.ok(
        htmlContent.includes('id="fluxStatus"'),
        'HTML should have fluxStatus element'
      );
      assert.ok(
        htmlContent.includes('id="visionStatus"'),
        'HTML should have visionStatus element'
      );
      assert.ok(
        htmlContent.includes('id="vlmStatus"'),
        'HTML should have vlmStatus element'
      );

      // JavaScript should reference these IDs
      assert.ok(
        jsContent.includes('llmStatus'),
        'JavaScript should reference llmStatus'
      );
      assert.ok(
        jsContent.includes('fluxStatus'),
        'JavaScript should reference fluxStatus'
      );
    });
  });
});
