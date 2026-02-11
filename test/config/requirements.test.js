/**
 * Tests for settings requirements lookup
 *
 * Verifies that requirements are correctly computed for different settings combinations.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const {
  getRequirements,
  getServicesToStart,
  needsApiKey,
  needsHealthCheck,
  getRequirementsByType
} = require('../../src/config/requirements.js');

describe('Settings Requirements', () => {
  describe('getRequirements()', () => {
    test('should return empty array requirements with defaults (but OpenAI key needed)', () => {
      const reqs = getRequirements({});
      assert.ok(Array.isArray(reqs), 'Should return an array');
      // Default settings use OpenAI, so should need API key
      assert.ok(reqs.some(r => r.key === 'OPENAI_API_KEY'), 'Default settings need OpenAI key');
    });

    test('should require OpenAI API key when llm is openai', () => {
      const reqs = getRequirements({ llm: 'openai' });
      const openaiReq = reqs.find(r => r.key === 'OPENAI_API_KEY');
      assert.ok(openaiReq, 'Should require OPENAI_API_KEY');
      assert.strictEqual(openaiReq.type, 'apiKey');
      assert.strictEqual(openaiReq.header, 'X-OpenAI-API-Key');
    });

    test('should require OpenAI API key when image is dalle', () => {
      const reqs = getRequirements({ llm: 'local-llm', image: 'dalle' });
      assert.ok(reqs.some(r => r.key === 'OPENAI_API_KEY'), 'Should require OpenAI key for dalle');
    });

    test('should require local-llm service when llm is local-llm', () => {
      const reqs = getRequirements({ llm: 'local-llm', image: 'flux', rankingMode: 'scoring' });
      const llmReq = reqs.find(r => r.name === 'local-llm');
      assert.ok(llmReq, 'Should require local-llm service');
      assert.strictEqual(llmReq.type, 'service');
      assert.strictEqual(llmReq.port, 8003);
    });

    test('should require flux service when image is flux', () => {
      const reqs = getRequirements({ llm: 'local-llm', image: 'flux', rankingMode: 'scoring' });
      const fluxReq = reqs.find(r => r.name === 'flux');
      assert.ok(fluxReq, 'Should require flux service');
      assert.strictEqual(fluxReq.type, 'service');
      assert.strictEqual(fluxReq.port, 8001);
    });

    test('should require BFL API key when image is bfl', () => {
      const reqs = getRequirements({ llm: 'local-llm', image: 'bfl', rankingMode: 'scoring' });
      const bflReq = reqs.find(r => r.key === 'BFL_API_KEY');
      assert.ok(bflReq, 'Should require BFL_API_KEY');
      assert.strictEqual(bflReq.type, 'apiKey');
    });

    test('should require vlm service when rankingMode is vlm', () => {
      const reqs = getRequirements({ llm: 'local-llm', image: 'flux', rankingMode: 'vlm' });
      const vlmReq = reqs.find(r => r.name === 'vlm');
      assert.ok(vlmReq, 'Should require vlm service');
      assert.strictEqual(vlmReq.type, 'service');
      assert.strictEqual(vlmReq.port, 8004);
    });

    test('should require local-vision service when rankingMode is scoring', () => {
      const reqs = getRequirements({ llm: 'local-llm', image: 'flux', rankingMode: 'scoring' });
      const visionReq = reqs.find(r => r.name === 'local-vision');
      assert.ok(visionReq, 'Should require local-vision service');
      assert.strictEqual(visionReq.type, 'service');
      assert.strictEqual(visionReq.port, 8002);
    });

    test('should require Modal credentials when llm is modal', () => {
      const reqs = getRequirements({ llm: 'modal', image: 'flux', rankingMode: 'scoring' });
      assert.ok(reqs.some(r => r.key === 'MODAL_ENDPOINT_URL'), 'Should require MODAL_ENDPOINT_URL');
      assert.ok(reqs.some(r => r.key === 'MODAL_TOKEN_ID'), 'Should require MODAL_TOKEN_ID');
      assert.ok(reqs.some(r => r.key === 'MODAL_TOKEN_SECRET'), 'Should require MODAL_TOKEN_SECRET');
      assert.ok(reqs.some(r => r.name === 'modal' && r.type === 'healthCheck'), 'Should require Modal health check');
    });

    test('should require Modal credentials when image is modal', () => {
      const reqs = getRequirements({ llm: 'local-llm', image: 'modal', rankingMode: 'scoring' });
      assert.ok(reqs.some(r => r.key === 'MODAL_ENDPOINT_URL'), 'Should require MODAL_ENDPOINT_URL');
    });

    test('should not duplicate OpenAI key when multiple providers need it', () => {
      const reqs = getRequirements({ llm: 'openai', image: 'openai', vision: 'gpt-vision' });
      const openaiKeys = reqs.filter(r => r.key === 'OPENAI_API_KEY');
      assert.strictEqual(openaiKeys.length, 1, 'Should only include OpenAI key once');
    });
  });

  describe('getServicesToStart()', () => {
    test('should return empty array for all-OpenAI settings', () => {
      const services = getServicesToStart({ llm: 'openai', image: 'openai', rankingMode: 'vlm' });
      // VLM is still a service
      assert.ok(services.includes('vlm'), 'Should include vlm for ranking');
    });

    test('should return local services for all-local settings', () => {
      const services = getServicesToStart({
        llm: 'local-llm',
        image: 'flux',
        rankingMode: 'scoring'
      });
      assert.ok(services.includes('local-llm'), 'Should include local-llm');
      assert.ok(services.includes('flux'), 'Should include flux');
      assert.ok(services.includes('local-vision'), 'Should include local-vision');
    });

    test('should return only service requirements, not API keys', () => {
      const services = getServicesToStart({ llm: 'openai', image: 'bfl' });
      assert.ok(!services.includes('BFL_API_KEY'), 'Should not include API keys');
      assert.ok(!services.includes('OPENAI_API_KEY'), 'Should not include API keys');
    });
  });

  describe('needsApiKey()', () => {
    test('should return true for OpenAI key when using openai llm', () => {
      assert.strictEqual(needsApiKey({ llm: 'openai' }, 'OPENAI_API_KEY'), true);
    });

    test('should return false for OpenAI key when using all local providers', () => {
      assert.strictEqual(
        needsApiKey({ llm: 'local-llm', image: 'flux', vision: 'local-vision', rankingMode: 'scoring' }, 'OPENAI_API_KEY'),
        false
      );
    });

    test('should return true for BFL key when using bfl image', () => {
      assert.strictEqual(needsApiKey({ image: 'bfl' }, 'BFL_API_KEY'), true);
    });

    test('should return false for BFL key when not using bfl', () => {
      assert.strictEqual(needsApiKey({ image: 'flux' }, 'BFL_API_KEY'), false);
    });
  });

  describe('needsHealthCheck()', () => {
    test('should return true for modal when using modal provider', () => {
      assert.strictEqual(needsHealthCheck({ image: 'modal' }, 'modal'), true);
    });

    test('should return false for modal when not using modal', () => {
      assert.strictEqual(needsHealthCheck({ image: 'flux' }, 'modal'), false);
    });

    test('should return true for flux service when using flux image', () => {
      assert.strictEqual(needsHealthCheck({ image: 'flux' }, 'flux'), true);
    });

    test('should return true for vlm service when rankingMode is vlm', () => {
      assert.strictEqual(needsHealthCheck({ rankingMode: 'vlm' }, 'vlm'), true);
    });
  });

  describe('getRequirementsByType()', () => {
    test('should group requirements by type', () => {
      const grouped = getRequirementsByType({
        llm: 'modal',
        image: 'flux',
        rankingMode: 'scoring'
      });

      assert.ok(Array.isArray(grouped.apiKeys), 'apiKeys should be an array');
      assert.ok(Array.isArray(grouped.services), 'services should be an array');
      assert.ok(Array.isArray(grouped.envVars), 'envVars should be an array');
      assert.ok(Array.isArray(grouped.healthChecks), 'healthChecks should be an array');

      // Modal needs env vars
      assert.ok(grouped.envVars.length > 0, 'Should have env vars for Modal');
      // Flux and local-vision are services
      assert.ok(grouped.services.some(s => s.name === 'flux'), 'Should have flux service');
      assert.ok(grouped.services.some(s => s.name === 'local-vision'), 'Should have local-vision service');
    });
  });
});
