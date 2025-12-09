/**
 * 🔴 TDD RED Phase: Output Path Manager Tests
 *
 * Centralized utility for managing output directory paths.
 * Ensures single point of change for output directory structure.
 *
 * Related: TDD audit for centralized output structure
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { getDateString } = require('../../src/utils/timezone.js');

describe('OutputPathManager', () => {
  describe('getCurrentDate', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const date = OutputPathManager.getCurrentDate();

      // Should match YYYY-MM-DD format
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date), `Date ${date} should match YYYY-MM-DD format`);
    });

    it('should return current date in local timezone', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const date = OutputPathManager.getCurrentDate();
      const today = getDateString(); // Use local timezone

      assert.strictEqual(date, today);
    });
  });

  describe('buildSessionPath', () => {
    it('should build path with date and session ID', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const sessionPath = OutputPathManager.buildSessionPath('output', 'ses-123456');

      // Should be in format: output/YYYY-MM-DD/ses-123456
      const parts = sessionPath.split(path.sep);
      assert.strictEqual(parts[0], 'output');
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(parts[1]), 'Second part should be date');
      assert.strictEqual(parts[2], 'ses-123456');
    });

    it('should use current date in path (local timezone)', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const sessionPath = OutputPathManager.buildSessionPath('output', 'ses-123456');
      const today = getDateString(); // Use local timezone

      assert.ok(sessionPath.includes(today), `Path should include today's date: ${today}`);
    });

    it('should handle different output base directories', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const sessionPath1 = OutputPathManager.buildSessionPath('output', 'ses-123456');
      const sessionPath2 = OutputPathManager.buildSessionPath('/tmp/output', 'ses-123456');

      assert.ok(sessionPath1.startsWith('output'));
      assert.ok(sessionPath2.startsWith(path.join('/tmp', 'output')));
    });
  });

  describe('DEFAULT_OUTPUT_DIR', () => {
    it('should export default output directory constant', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      assert.ok(OutputPathManager.DEFAULT_OUTPUT_DIR);
      assert.strictEqual(typeof OutputPathManager.DEFAULT_OUTPUT_DIR, 'string');
    });

    it('should default to output directory in current working directory', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const expected = path.join(process.cwd(), 'output');
      assert.strictEqual(OutputPathManager.DEFAULT_OUTPUT_DIR, expected);
    });
  });

  describe('buildMetadataPath', () => {
    it('should build metadata.json path within session directory', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const metadataPath = OutputPathManager.buildMetadataPath('output', 'ses-123456');

      // Should be in format: output/YYYY-MM-DD/ses-123456/metadata.json
      assert.ok(metadataPath.endsWith('metadata.json'));
      assert.ok(metadataPath.includes('ses-123456'));
    });

    it('should use buildSessionPath for base path', () => {
      const OutputPathManager = require('../../src/utils/output-path-manager.js');

      const sessionPath = OutputPathManager.buildSessionPath('output', 'ses-123456');
      const metadataPath = OutputPathManager.buildMetadataPath('output', 'ses-123456');

      const expectedPath = path.join(sessionPath, 'metadata.json');
      assert.strictEqual(metadataPath, expectedPath);
    });
  });
});
