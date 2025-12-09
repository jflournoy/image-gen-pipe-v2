/**
 * 🟢 TDD GREEN Phase: Output Path Manager
 *
 * Centralized utility for managing output directory structure.
 * Single source of truth for all output path construction.
 *
 * This ensures that changes to output directory structure only need
 * to be made in one place.
 */

const path = require('path');
const { getDateString } = require('./timezone.js');

/**
 * Default output directory (relative to current working directory)
 * @type {string}
 */
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'output');

/**
 * Get the current date in YYYY-MM-DD format (local timezone)
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getCurrentDate() {
  return getDateString();
}

/**
 * Build session directory path with date-based structure
 * Format: {outputDir}/YYYY-MM-DD/{sessionId}/
 *
 * @param {string} outputDir - Base output directory
 * @param {string} sessionId - Session identifier (e.g., "ses-123456")
 * @returns {string} Full path to session directory
 */
function buildSessionPath(outputDir, sessionId) {
  const date = getCurrentDate();
  return path.join(outputDir, date, sessionId);
}

/**
 * Build metadata.json file path within session directory
 * Format: {outputDir}/YYYY-MM-DD/{sessionId}/metadata.json
 *
 * @param {string} outputDir - Base output directory
 * @param {string} sessionId - Session identifier (e.g., "ses-123456")
 * @returns {string} Full path to metadata.json file
 */
function buildMetadataPath(outputDir, sessionId) {
  const sessionPath = buildSessionPath(outputDir, sessionId);
  return path.join(sessionPath, 'metadata.json');
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  getCurrentDate,
  buildSessionPath,
  buildMetadataPath
};
