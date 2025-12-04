/**
 * 🔴 RED: Tests for demo-single-iteration.js
 *
 * These tests verify that the demo uses the current API correctly:
 * - Passes sessionId to OpenAIImageProvider
 * - Uses correct provider initialization patterns
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Single Iteration Demo - API Consistency', () => {
  test('🔴 should pass sessionId to OpenAIImageProvider', () => {
    const demoPath = path.join(__dirname, '..', 'demo-single-iteration.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Find the OpenAIImageProvider initialization
    const imageProviderMatch = demoContent.match(/new OpenAIImageProvider\([^)]+\)/);
    assert(imageProviderMatch, 'Demo should initialize OpenAIImageProvider');

    const initialization = imageProviderMatch[0];

    // Should pass sessionId as second parameter (options object)
    const hasSessionId = initialization.includes('sessionId');

    assert(
      hasSessionId,
      'Demo should pass sessionId to OpenAIImageProvider constructor for proper session tracking'
    );
  });

  test('🔴 should generate session ID in ses-HHMMSS format', () => {
    const demoPath = path.join(__dirname, '..', 'demo-single-iteration.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should create a session ID
    const hasSessionIdVar = /sessionId\s*=/.test(demoContent);

    assert(
      hasSessionIdVar,
      'Demo should create a sessionId variable for tracking'
    );

    // Should use ses-HHMMSS format
    const hasCorrectFormat = demoContent.includes('ses-');

    assert(
      hasCorrectFormat,
      'Demo should use ses-HHMMSS session ID format (e.g., "ses-123456")'
    );
  });

  test('🔴 should document that it demonstrates complete iteration', () => {
    const demoPath = path.join(__dirname, '..', 'demo-single-iteration.js');
    const demoContent = fs.readFileSync(demoPath, 'utf-8');

    // Demo should document its purpose in header comments
    const hasIterationDoc = demoContent.includes('iteration') || demoContent.includes('Iteration');

    assert(
      hasIterationDoc,
      'Demo should document that it shows a complete single iteration'
    );
  });
});
