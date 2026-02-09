/**
 * @file Service Controls Integration Tests (TDD RED)
 * Tests for fixing broken service control buttons
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');

describe.skip('🔴 RED: Service Controls Integration', () => {
  describe('Start All Services Button', () => {
    it('should call new service API endpoints, not direct localhost URLs', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // quickStartLocalServices should use /api/services endpoints
      const funcStart = jsContent.indexOf('function quickStartLocalServices');
      if (funcStart === -1) {
        assert.fail('quickStartLocalServices function not found');
      }

      const funcChunk = jsContent.substring(funcStart, funcStart + 3000);

      // Should use the new API, not direct localhost:8001, 8002 calls
      assert.ok(
        funcChunk.includes('/api/services'),
        'quickStartLocalServices should use /api/services endpoints'
      );

      // Should NOT use direct localhost:port calls
      assert.ok(
        !funcChunk.includes('localhost:8001') &&
        !funcChunk.includes('localhost:8002') &&
        !funcChunk.includes('localhost:8003') &&
        !funcChunk.includes('localhost:8004'),
        'Should not use direct localhost:port URLs'
      );
    });

    it('should not reference non-existent button IDs', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');
      const htmlContent = fs.readFileSync(demoHtmlPath, 'utf8');

      // If JavaScript references quickStartBtn or quickStartBtnText
      if (jsContent.includes('quickStartBtn')) {
        // HTML should have that ID
        assert.ok(
          htmlContent.includes('id="quickStartBtn"'),
          'If JS references quickStartBtn, HTML should have that ID'
        );
      }

      if (jsContent.includes('quickStartBtnText')) {
        assert.ok(
          htmlContent.includes('id="quickStartBtnText"'),
          'If JS references quickStartBtnText, HTML should have that ID'
        );
      }
    });

    it('should work without assuming button structure', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // quickStartLocalServices should handle missing button gracefully
      const funcStart = jsContent.indexOf('function quickStartLocalServices');
      if (funcStart === -1) {
        assert.fail('quickStartLocalServices function not found');
      }

      const funcChunk = jsContent.substring(funcStart, funcStart + 3000);

      // Should check if elements exist before accessing
      const checksExistence =
        funcChunk.includes('?.') || funcChunk.includes('if (');

      assert.ok(
        checksExistence,
        'Should check if elements exist before accessing them'
      );
    });
  });

  describe('Individual Service Controls', () => {
    it('should use service manager API consistently', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // startService function should use /api/services/:name/start
      const startFuncStart = jsContent.indexOf('async function startService');
      if (startFuncStart === -1) {
        assert.fail('startService function not found');
      }

      const startFuncChunk = jsContent.substring(startFuncStart, startFuncStart + 1500);

      assert.ok(
        startFuncChunk.includes('/api/services/') && startFuncChunk.includes('/start'),
        'startService should use /api/services/:name/start endpoint'
      );
    });

    it('should handle service start failures gracefully', () => {
      const jsContent = fs.readFileSync(demoJsPath, 'utf8');

      // startService should have error handling
      const startFuncStart = jsContent.indexOf('async function startService');
      const startFuncChunk = jsContent.substring(startFuncStart, startFuncStart + 1500);

      assert.ok(
        startFuncChunk.includes('try') && startFuncChunk.includes('catch'),
        'startService should have try-catch error handling'
      );

      assert.ok(
        startFuncChunk.includes('error') || startFuncChunk.includes('Error'),
        'Should handle errors'
      );
    });
  });

  describe('OpenAI Section Content', () => {
    it('should have relevant content for OpenAI mode', () => {
      const htmlContent = fs.readFileSync(demoHtmlPath, 'utf8');

      // Find the OpenAI mode card
      const openaiCardStart = htmlContent.indexOf('id="openaiModeCard"');
      if (openaiCardStart === -1) {
        assert.fail('OpenAI mode card not found');
      }

      const openaiSection = htmlContent.substring(openaiCardStart, openaiCardStart + 1000);

      // Should mention relevant OpenAI features
      const hasRelevantContent =
        openaiSection.includes('Fast') ||
        openaiSection.includes('Reliable') ||
        openaiSection.includes('API');

      assert.ok(
        hasRelevantContent,
        'OpenAI section should have relevant content about cloud services'
      );
    });

    it('should not have confusing local service information in OpenAI section', () => {
      const htmlContent = fs.readFileSync(demoHtmlPath, 'utf8');

      // Find the OpenAI mode card content
      const openaiCardStart = htmlContent.indexOf('id="openaiModeCard"');
      const nextCardStart = htmlContent.indexOf('id="localModeCard"', openaiCardStart);

      const openaiSection = htmlContent.substring(openaiCardStart, nextCardStart);

      // Should NOT mention local services, GPUs, or installation
      assert.ok(
        !openaiSection.toLowerCase().includes('local service') &&
        !openaiSection.toLowerCase().includes('gpu') &&
        !openaiSection.toLowerCase().includes('download model'),
        'OpenAI section should not mention local service concepts'
      );
    });
  });
});
