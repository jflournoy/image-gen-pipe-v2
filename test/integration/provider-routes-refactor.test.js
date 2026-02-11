/**
 * 🔴 TDD RED Phase: Verify provider-routes uses requirements module
 *
 * These tests will FAIL until we refactor provider-routes.js
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('🔴 RED: provider-routes should use requirements module', () => {
  const providerRoutesPath = path.join(__dirname, '../../src/api/provider-routes.js');
  const providerRoutesContent = fs.readFileSync(providerRoutesPath, 'utf8');

  test('🔴 should import requirements module', () => {
    const hasRequirementsImport =
      providerRoutesContent.includes("require('../config/requirements") ||
      providerRoutesContent.includes("require('../../config/requirements") ||
      providerRoutesContent.includes("from '../config/requirements") ||
      providerRoutesContent.includes("from '../../config/requirements");

    assert.ok(
      hasRequirementsImport,
      '❌ EXPECTED TO FAIL: provider-routes.js should import requirements module (will pass after GREEN phase)'
    );
  });

  test('🔴 should use getServicesToStart() function', () => {
    const usesGetServicesToStart = providerRoutesContent.includes('getServicesToStart(');

    assert.ok(
      usesGetServicesToStart,
      '❌ EXPECTED TO FAIL: Should call getServicesToStart() from requirements module (will pass after GREEN phase)'
    );
  });

  test('🔴 should NOT have hardcoded services list in quick-start', () => {
    // Check for the old hardcoded default: ['flux', 'vision', 'local-llm', 'vlm']
    const hasHardcodedList =
      providerRoutesContent.includes("['flux', 'vision', 'local-llm', 'vlm']") ||
      providerRoutesContent.includes("['flux','vision','local-llm','vlm']");

    assert.ok(
      !hasHardcodedList,
      '❌ EXPECTED TO FAIL: Should not have hardcoded services list (will pass after GREEN phase)'
    );
  });
});
