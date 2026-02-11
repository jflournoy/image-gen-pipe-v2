/**
 * 🔴 TDD RED Phase: Verify demo-routes uses requirements module
 *
 * These tests will FAIL until we refactor demo-routes.js
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('🔴 RED: demo-routes should use requirements module', () => {
  const demoRoutesPath = path.join(__dirname, '../../src/api/demo-routes.js');
  const demoRoutesContent = fs.readFileSync(demoRoutesPath, 'utf8');

  test('🔴 should import requirements module', () => {
    const hasRequirementsImport =
      demoRoutesContent.includes("require('../config/requirements") ||
      demoRoutesContent.includes("require('../../config/requirements") ||
      demoRoutesContent.includes("from '../config/requirements") ||
      demoRoutesContent.includes("from '../../config/requirements");

    assert.ok(
      hasRequirementsImport,
      '❌ EXPECTED TO FAIL: demo-routes.js should import requirements module (will pass after GREEN phase)'
    );
  });

  test('🔴 should use needsApiKey() function', () => {
    const usesNeedsApiKey = demoRoutesContent.includes('needsApiKey(');

    assert.ok(
      usesNeedsApiKey,
      '❌ EXPECTED TO FAIL: Should call needsApiKey() from requirements module (will pass after GREEN phase)'
    );
  });

  test('🔴 should NOT have manual needsOpenAI check', () => {
    const hasOldManualCheck =
      demoRoutesContent.includes('const needsOpenAI =') &&
      demoRoutesContent.includes("runtimeProviders.llm === 'openai'");

    assert.ok(
      !hasOldManualCheck,
      '❌ EXPECTED TO FAIL: Should not have old manual OpenAI check (will pass after GREEN phase)'
    );
  });
});
