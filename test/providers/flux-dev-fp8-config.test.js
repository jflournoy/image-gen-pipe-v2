/**
 * @file Flux.1-dev-fp8 Configuration Tests (TDD RED)
 * Tests to ensure Flux service is properly configured for dev-fp8 model
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('🔴 RED: FLUX.1-dev Configuration', () => {
  const fluxServicePath = path.join(__dirname, '../../services/flux_service.py');

  it('should use FLUX.1-dev as the model', () => {
    const content = fs.readFileSync(fluxServicePath, 'utf8');

    // Check that default model is FLUX.1-dev (fp8 quantization is automatic)
    assert.match(
      content,
      /black-forest-labs\/FLUX\.1-dev['"\s]/,
      'Model should be black-forest-labs/FLUX.1-dev'
    );

    // Should NOT have incorrect fp8 suffix in model name
    assert.doesNotMatch(
      content,
      /FLUX\.1-dev-fp8/,
      'Should not use FLUX.1-dev-fp8 as repository name'
    );
  });

  it('should set default steps appropriate for dev model (20-30)', () => {
    const content = fs.readFileSync(fluxServicePath, 'utf8');

    // Dev model needs 20-30 steps, not 4
    assert.match(
      content,
      /steps:\s*int\s*=\s*2[0-9]/,
      'Default steps should be 20-30 for dev model'
    );

    // Should NOT have 4 steps (schnell default)
    assert.doesNotMatch(
      content,
      /steps:\s*int\s*=\s*4\s+#.*schnell/,
      'Should not use schnell 4-step default'
    );
  });

  it('should set default guidance scale for dev model (3.5)', () => {
    const content = fs.readFileSync(fluxServicePath, 'utf8');

    // Dev model uses guidance scale, schnell does not
    assert.match(
      content,
      /guidance:\s*float\s*=\s*3\.5/,
      'Default guidance should be 3.5 for dev model'
    );

    // Should NOT have 0.0 guidance (schnell default)
    assert.doesNotMatch(
      content,
      /guidance:\s*float\s*=\s*0\.0\s+#.*schnell/,
      'Should not use schnell 0.0 guidance default'
    );
  });

  it('should set MAX_SEQUENCE_LENGTH to 512 for dev model', () => {
    const content = fs.readFileSync(fluxServicePath, 'utf8');

    // Dev supports 512 tokens, schnell only 256
    assert.match(
      content,
      /MAX_SEQUENCE_LENGTH\s*=\s*512/,
      'MAX_SEQUENCE_LENGTH should be 512 for dev model'
    );

    // Should NOT have 256 (schnell limit)
    assert.doesNotMatch(
      content,
      /MAX_SEQUENCE_LENGTH\s*=\s*256\s+#.*schnell/,
      'Should not use schnell 256 token limit'
    );
  });

  it('should have comments indicating dev-fp8 configuration', () => {
    const content = fs.readFileSync(fluxServicePath, 'utf8');

    // Should have dev-specific comments
    assert.match(
      content,
      /dev|fp8/i,
      'Should have dev or fp8 mentioned in comments'
    );

    // Should NOT prominently reference schnell
    const schnellMatches = content.match(/schnell/gi) || [];
    assert.ok(
      schnellMatches.length <= 2,
      'Should not have multiple schnell references (indicates schnell config)'
    );
  });

  it('should update README to reference dev-fp8 model', () => {
    const readmePath = path.join(__dirname, '../../services/README.md');
    const content = fs.readFileSync(readmePath, 'utf8');

    // README should mention dev-fp8
    assert.match(
      content,
      /FLUX\.1-dev(-fp8)?/i,
      'README should reference FLUX.1-dev or dev-fp8'
    );
  });
});
