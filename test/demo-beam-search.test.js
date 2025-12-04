/**
 * 🔴 RED: Tests for demo-beam-search.js
 *
 * These tests verify:
 * 1. Rate limiting demonstration
 * 2. API consistency with OutputPathManager
 * 3. Correct session ID format
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

describe('Beam Search Demo - API Consistency', () => {
  test('🔴 should use OutputPathManager for path construction', () => {
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should import OutputPathManager
    assert(
      demoContent.includes('output-path-manager'),
      'Demo should import OutputPathManager utility'
    );

    // Demo should use buildSessionPath or buildMetadataPath
    const usesPathBuilder =
      demoContent.includes('buildSessionPath') ||
      demoContent.includes('buildMetadataPath');

    assert(
      usesPathBuilder,
      'Demo should use OutputPathManager.buildSessionPath() or buildMetadataPath()'
    );
  });

  test('🔴 should use ses-HHMMSS session ID format', () => {
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should create session ID in ses-HHMMSS format
    // NOT in YYYY-MM-DD-HHMMSS format
    const hasCorrectFormat = demoContent.includes('ses-');

    assert(
      hasCorrectFormat,
      'Demo should use ses-HHMMSS session ID format (e.g., "ses-123456")'
    );

    // Should NOT concatenate date into session ID
    const hasBadFormat = /sessionId\s*=\s*`\$\{dateStr\}-\$\{/.test(demoContent);

    assert(
      !hasBadFormat,
      'Demo should NOT include date in session ID (date goes in directory path, not session ID)'
    );
  });

  test('🔴 should NOT hardcode output/sessions/ path', () => {
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should NOT use hardcoded "output/sessions/" path
    const hasHardcodedPath = demoContent.includes('output/sessions/');

    assert(
      !hasHardcodedPath,
      'Demo should NOT hardcode "output/sessions/" - should use OutputPathManager which creates "output/YYYY-MM-DD/" structure'
    );
  });

  test('🔴 should use correct output path structure (YYYY-MM-DD/ses-HHMMSS)', () => {
    const demoPath = path.join(__dirname, '..', 'demo-beam-search.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should document the correct path structure in comments
    // Format should be: output/YYYY-MM-DD/ses-HHMMSS/
    const documentationMatch = demoContent.match(/output\/.*ses-/);

    assert(
      documentationMatch,
      'Demo should document path structure as output/YYYY-MM-DD/ses-HHMMSS/'
    );
  });
});
