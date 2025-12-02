/**
 * 🔴 RED: Tests for demo-beam-search.js rate limiting demonstration
 *
 * These tests verify that the demo properly demonstrates rate limiting
 * functionality to users.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Beam Search Demo - Rate Limiting Display', () => {
  test('should display rate limiting configuration in demo output', () => {
    // Read the demo file
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should mention rate limits in the configuration output
    assert(
      demoContent.includes('rate') || demoContent.includes('Rate') || demoContent.includes('limit'),
      'Demo should mention rate limiting in user-facing output'
    );
  });

  test('should show default rate limit values from config', () => {
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should import or reference rate limit config
    const hasRateLimitImport =
      demoContent.includes('rate-limits') ||
      demoContent.includes('rateLimitConfig') ||
      demoContent.includes('rateLimitConcurrency');

    assert(
      hasRateLimitImport,
      'Demo should reference rate limit configuration to show users the defaults'
    );
  });

  test('should document rate limit environment variables', () => {
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should document the rate limit env vars in comments or output
    const documentsEnvVars =
      demoContent.includes('BEAM_SEARCH_RATE_LIMIT') ||
      demoContent.includes('rate limit environment');

    assert(
      documentsEnvVars,
      'Demo should document rate limit environment variables for user configuration'
    );
  });

  test('should pass rate limit config to beam search', () => {
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Find the config object passed to beamSearch
    const configMatch = demoContent.match(/const config = \{[\s\S]*?\};/);
    assert(configMatch, 'Demo should have a config object');

    // Config should include rateLimitConcurrency or reference to rate limits
    const configText = configMatch[0];
    const hasRateLimitConfig =
      configText.includes('rateLimit') ||
      configText.includes('concurrency');

    // OR it uses defaults from the rate-limits.js module
    const usesDefaults = demoContent.includes('rate-limits.js');

    assert(
      hasRateLimitConfig || usesDefaults,
      'Demo config should either specify rate limits or use defaults from rate-limits.js'
    );
  });
});
