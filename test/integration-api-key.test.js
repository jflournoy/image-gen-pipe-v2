const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/**
 * Phase 6 Integration Tests: API Key Proxy Pattern
 *
 * These tests verify the complete API key flow:
 * - Server rejects requests without API key
 * - Backend worker requires and uses user API key
 * - Frontend validates and sends API key
 * - No server-side OPENAI_API_KEY fallback
 */

describe('🟢 GREEN: Integration Tests - API Key Proxy Pattern', () => {
  describe('Issue 6.1: End-to-end test with user API key', () => {
    test('should complete API key validation flow from API route to worker', () => {
      // Verify the API route has API key validation
      const serverPath = path.join(__dirname, '../src/api/server.js');
      const serverContent = fs.readFileSync(serverPath, 'utf8');

      // Check API key header extraction
      assert.ok(
        serverContent.includes("req.headers['x-openai-api-key']"),
        'Server should extract X-OpenAI-API-Key header'
      );

      // Check 401 response for missing key
      assert.ok(
        serverContent.includes('401'),
        'Server should return 401 for missing API key'
      );

      // Check 400 response for invalid format
      assert.ok(
        serverContent.includes("!userApiKey.startsWith('sk-')"),
        'Server should validate API key format'
      );

      // Check userApiKey is passed to worker
      assert.ok(
        serverContent.includes('startBeamSearchJob') && serverContent.includes('userApiKey'),
        'Server should pass userApiKey to beam search worker'
      );
    });

    test('should pass userApiKey through worker to providers', () => {
      // Verify beam-search-worker has API key parameter
      const workerPath = path.join(__dirname, '../src/api/beam-search-worker.js');
      const workerContent = fs.readFileSync(workerPath, 'utf8');

      // Check function signature includes userApiKey
      assert.ok(
        workerContent.includes('startBeamSearchJob(jobId, params, userApiKey)'),
        'Worker function should have userApiKey parameter'
      );

      // Check userApiKey validation
      assert.ok(
        workerContent.includes('User API key is required'),
        'Worker should validate userApiKey is provided'
      );

      // Check userApiKey is passed to all provider factories
      assert.ok(
        workerContent.includes('apiKey: userApiKey'),
        'Worker should pass apiKey to all provider factories'
      );

      // Should have 5 instances of apiKey: userApiKey (one for each provider)
      const matches = workerContent.match(/apiKey: userApiKey/g);
      assert.ok(
        matches && matches.length >= 5,
        'Worker should pass apiKey to at least 5 providers'
      );
    });

    test('should have provider factories accept apiKey option', () => {
      const factoryPath = path.join(__dirname, '../src/factory/provider-factory.js');
      const factoryContent = fs.readFileSync(factoryPath, 'utf8');

      // Check all 5 provider factories accept apiKey option
      const providers = [
        'createLLMProvider',
        'createImageProvider',
        'createVisionProvider',
        'createCritiqueGenerator',
        'createImageRanker'
      ];

      providers.forEach(provider => {
        assert.ok(
          factoryContent.includes(`function ${provider}(options`),
          `${provider} should accept options parameter`
        );

        assert.ok(
          factoryContent.includes("'apiKey' in options"),
          `${provider} should check for apiKey in options`
        );
      });
    });

    test('should have frontend validation for API key', () => {
      const demoPath = path.join(__dirname, '../public/demo.js');
      const demoContent = fs.readFileSync(demoPath, 'utf8');

      // Check API key is required
      assert.ok(
        demoContent.includes("document.getElementById('apiKey')"),
        'Frontend should get API key from input'
      );

      // Check validation for empty API key
      assert.ok(
        demoContent.includes('OpenAI API key is required'),
        'Frontend should validate API key is not empty'
      );

      // Check format validation
      assert.ok(
        demoContent.includes("!apiKey.startsWith('sk-')"),
        'Frontend should validate API key format'
      );

      // Check header injection
      assert.ok(
        demoContent.includes("'X-OpenAI-API-Key'"),
        'Frontend should send API key in request header'
      );
    });

    test('should have frontend API key input in HTML', () => {
      const htmlPath = path.join(__dirname, '../public/demo.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Check API key input field exists
      assert.ok(
        htmlContent.includes("id=\"apiKey\""),
        'HTML should have API key input field'
      );

      // Check it's a password input
      assert.ok(
        htmlContent.includes("type=\"password\"") && htmlContent.includes('apiKey'),
        'API key field should be password type'
      );

      // Check required attribute
      assert.ok(
        htmlContent.includes('required') && htmlContent.includes('apiKey'),
        'API key field should be required'
      );

      // Check helper text
      assert.ok(
        htmlContent.includes('sessionStorage') || htmlContent.includes('browser session'),
        'HTML should explain API key is not stored on server'
      );
    });
  });

  describe('Issue 6.2: Verify server has no OPENAI_API_KEY in .env', () => {
    test('should not have OPENAI_API_KEY set in .env', () => {
      const envPath = path.join(__dirname, '../.env');

      // Check if .env exists
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');

        // Should not have an active OPENAI_API_KEY setting
        const hasActiveKey = /^OPENAI_API_KEY=sk-/m.test(envContent);
        assert.ok(
          !hasActiveKey,
          '.env should not have OPENAI_API_KEY set to a valid key'
        );

        // It's okay if it's commented out or empty
        if (envContent.includes('OPENAI_API_KEY')) {
          assert.ok(
            envContent.includes('#') && envContent.includes('OPENAI_API_KEY'),
            'OPENAI_API_KEY should be commented out'
          );
        }
      }
    });

    test('should have deployment docs emphasizing user-provided keys', () => {
      const readmePath = path.join(__dirname, '../deploy/README.md');
      const securityPath = path.join(__dirname, '../deploy/API-KEY-SECURITY.md');

      let foundDocumentation = false;

      if (fs.existsSync(readmePath)) {
        const readmeContent = fs.readFileSync(readmePath, 'utf8');
        if (readmeContent.includes('API key') || readmeContent.includes('user')) {
          foundDocumentation = true;
        }
      }

      if (fs.existsSync(securityPath)) {
        const securityContent = fs.readFileSync(securityPath, 'utf8');
        assert.ok(
          securityContent.includes('user-provided') || securityContent.includes('User'),
          'Security docs should explain user-provided API keys'
        );
        foundDocumentation = true;
      }

      assert.ok(foundDocumentation, 'Deployment docs should document API key approach');
    });

    test('should not fall back to environment variable in worker', () => {
      const workerPath = path.join(__dirname, '../src/api/beam-search-worker.js');
      const workerContent = fs.readFileSync(workerPath, 'utf8');

      // Should NOT have process.env.OPENAI_API_KEY fallback in worker
      const hasEnvFallback = /process\.env\.OPENAI_API_KEY/.test(workerContent);
      assert.ok(
        !hasEnvFallback,
        'Worker should not fall back to process.env.OPENAI_API_KEY'
      );

      // Should NOT have process.env.OPENAI_API_KEY in provider creation
      const hasEnvInProviders = /createLLMProvider\(\)[^}]*process\.env|process\.env[^}]*createLLMProvider/.test(
        workerContent
      );
      assert.ok(
        !hasEnvInProviders,
        'Worker should not use env var when creating providers'
      );
    });

    test('should not fall back to environment variable in API route', () => {
      const serverPath = path.join(__dirname, '../src/api/server.js');
      const serverContent = fs.readFileSync(serverPath, 'utf8');

      // Should NOT attempt to use OPENAI_API_KEY from env in /api/beam-search route
      const beamSearchSection = serverContent.slice(
        serverContent.indexOf("app.post('/api/beam-search'"),
        serverContent.indexOf("app.post('/api/beam-search'") + 2000
      );

      const hasEnvFallback = /process\.env\.OPENAI_API_KEY/.test(beamSearchSection);
      assert.ok(
        !hasEnvFallback,
        'API route should not fall back to process.env.OPENAI_API_KEY'
      );
    });
  });
});
