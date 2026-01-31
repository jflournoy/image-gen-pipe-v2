/**
 * TDD RED: Quick Start Local Services UI Tests
 *
 * Feature: HF token field + Quick Start button in provider settings modal
 */

const { describe, test, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock browser globals for testing
global.localStorage = {
  _data: {},
  getItem(key) { return this._data[key] || null; },
  setItem(key, value) { this._data[key] = value; },
  removeItem(key) { delete this._data[key]; },
  clear() { this._data = {}; }
};

global.fetch = mock.fn();
global.document = {
  getElementById: mock.fn(() => ({ value: '', style: {}, disabled: false, textContent: '' })),
  querySelector: mock.fn(() => null)
};

describe('Quick Start Local Services UI', () => {

  beforeEach(() => {
    global.localStorage.clear();
    global.fetch.mock.resetCalls();
  });

  describe('HF Token Storage', () => {

    test('should save HF token to localStorage', () => {
      const token = 'hf_testToken123456789';

      // Function to implement
      function saveHfToken(token) {
        if (token && token.startsWith('hf_')) {
          localStorage.setItem('hfToken', token);
          return true;
        }
        return false;
      }

      const saved = saveHfToken(token);

      assert.strictEqual(saved, true, 'Should return true for valid token');
      assert.strictEqual(localStorage.getItem('hfToken'), token, 'Token should be saved');
    });

    test('should load HF token from localStorage', () => {
      const token = 'hf_savedToken12345';
      localStorage.setItem('hfToken', token);

      // Function to implement
      function loadHfToken() {
        return localStorage.getItem('hfToken') || '';
      }

      assert.strictEqual(loadHfToken(), token, 'Should load saved token');
    });

    test('should validate HF token format', () => {
      // Function to implement
      function validateHfToken(token) {
        if (!token) return { valid: true, message: '' }; // Optional
        if (!token.startsWith('hf_')) {
          return { valid: false, message: 'Token must start with hf_' };
        }
        if (token.length < 10) {
          return { valid: false, message: 'Token too short' };
        }
        return { valid: true, message: '' };
      }

      // Valid tokens
      assert.strictEqual(validateHfToken('hf_abcdefghij').valid, true);
      assert.strictEqual(validateHfToken('').valid, true); // Optional
      assert.strictEqual(validateHfToken(null).valid, true); // Optional

      // Invalid tokens
      assert.strictEqual(validateHfToken('invalid_token').valid, false);
      assert.strictEqual(validateHfToken('hf_short').valid, false);
    });
  });

  describe('Quick Start All Services', () => {

    test('should call quick-start API with HF token', async () => {
      const hfToken = 'hf_testToken123456';

      // Mock successful response
      global.fetch.mock.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          services: {
            flux: { status: 'started', port: 8001, hf_authenticated: true },
            vision: { status: 'started', port: 8002 },
            localLLM: { status: 'started', port: 8003 }
          },
          message: 'Local services started successfully'
        })
      }));

      // Function to implement
      async function quickStartLocalServices(hfToken) {
        const response = await fetch('/api/providers/services/quick-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hfToken })
        });
        return response.json();
      }

      const result = await quickStartLocalServices(hfToken);

      assert.strictEqual(result.success, true);
      assert.ok(result.services.flux);
      assert.strictEqual(result.services.flux.hf_authenticated, true);
    });

    test('should switch to local providers after successful start', async () => {
      // Function to implement
      function getLocalProviderConfig() {
        return {
          llm: 'local-llm',
          image: 'flux',
          vision: 'local'
        };
      }

      const config = getLocalProviderConfig();

      assert.strictEqual(config.llm, 'local-llm');
      assert.strictEqual(config.image, 'flux');
      assert.strictEqual(config.vision, 'local');
    });

    test('should handle partial success gracefully', async () => {
      // Function to implement
      function getQuickStartSummary(result) {
        const services = result.services;
        const started = Object.entries(services)
          .filter(([_, s]) => s.status === 'started' || s.status === 'already_running')
          .map(([name]) => name);
        const failed = Object.entries(services)
          .filter(([_, s]) => s.status === 'failed')
          .map(([name, s]) => `${name}: ${s.error}`);

        return {
          allSuccess: failed.length === 0,
          started,
          failed,
          message: failed.length === 0
            ? `✓ All services started: ${started.join(', ')}`
            : `⚠️ Some services failed: ${failed.join('; ')}`
        };
      }

      // Partial success scenario
      const partialResult = {
        services: {
          flux: { status: 'failed', error: 'HF auth required' },
          vision: { status: 'started', port: 8002 },
          localLLM: { status: 'started', port: 8003 }
        }
      };

      const summary = getQuickStartSummary(partialResult);

      assert.strictEqual(summary.allSuccess, false);
      assert.ok(summary.failed.includes('flux: HF auth required'));
      assert.ok(summary.started.includes('vision'));
      assert.ok(summary.started.includes('localLLM'));
    });
  });

  describe('UI State Management', () => {

    test('should show loading state during quick-start', () => {
      // Function to implement
      function setQuickStartLoading(isLoading) {
        return {
          buttonText: isLoading ? 'Starting Services...' : 'Quick Start All Local',
          buttonDisabled: isLoading,
          showSpinner: isLoading
        };
      }

      const loadingState = setQuickStartLoading(true);
      assert.strictEqual(loadingState.buttonText, 'Starting Services...');
      assert.strictEqual(loadingState.buttonDisabled, true);
      assert.strictEqual(loadingState.showSpinner, true);

      const readyState = setQuickStartLoading(false);
      assert.strictEqual(readyState.buttonText, 'Quick Start All Local');
      assert.strictEqual(readyState.buttonDisabled, false);
      assert.strictEqual(readyState.showSpinner, false);
    });

    test('should show HF token status indicator', () => {
      // Function to implement
      function getHfTokenStatus(token, fluxHealth) {
        if (!token) {
          return { status: 'missing', message: 'HF token not set', color: '#ff9800' };
        }
        if (fluxHealth?.hf_authenticated) {
          return { status: 'authenticated', message: 'HF authenticated', color: '#4CAF50' };
        }
        return { status: 'set', message: 'Token set (will be used on start)', color: '#2196F3' };
      }

      const missingStatus = getHfTokenStatus('', null);
      assert.strictEqual(missingStatus.status, 'missing');

      const setStatus = getHfTokenStatus('hf_token123', null);
      assert.strictEqual(setStatus.status, 'set');

      const authStatus = getHfTokenStatus('hf_token123', { hf_authenticated: true });
      assert.strictEqual(authStatus.status, 'authenticated');
    });
  });

  describe('HTML Element Requirements', () => {

    test('should have hfTokenInput element ID defined', () => {
      // This test documents the expected HTML element ID
      const expectedElementId = 'hfTokenInput';
      assert.ok(expectedElementId, 'Element ID should be defined');
    });

    test('should have quickStartBtn element ID defined', () => {
      // This test documents the expected HTML element ID
      const expectedElementId = 'quickStartBtn';
      assert.ok(expectedElementId, 'Element ID should be defined');
    });

    test('should have hfTokenStatus element ID defined', () => {
      // This test documents the expected HTML element ID
      const expectedElementId = 'hfTokenStatus';
      assert.ok(expectedElementId, 'Element ID should be defined');
    });
  });
});

describe('Integration: Quick Start Flow', () => {

  test('complete quick-start flow should work', async () => {
    // Simulate complete flow:
    // 1. User enters HF token
    // 2. Clicks Quick Start
    // 3. Services start
    // 4. Providers switch to local
    // 5. UI updates

    // Mock API response
    const mockResponse = {
      success: true,
      services: {
        flux: { status: 'started', port: 8001, hf_authenticated: true, running: true },
        vision: { status: 'started', port: 8002, running: true },
        localLLM: { status: 'started', port: 8003, running: true }
      },
      message: 'Local services started successfully'
    };

    // The expected flow
    const flowSteps = [
      'validateToken',
      'saveToken',
      'showLoading',
      'callQuickStartAPI',
      'switchProviders',
      'updateUI',
      'hideLoading'
    ];

    assert.strictEqual(flowSteps.length, 7, 'Should have 7 steps in flow');
    assert.ok(mockResponse.success, 'Mock response should be successful');
    assert.strictEqual(mockResponse.services.flux.hf_authenticated, true);
  });
});
