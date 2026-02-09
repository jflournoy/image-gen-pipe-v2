/**
 * Timezone Utility
 *
 * Provides timezone-aware date/time formatting for session history and other features.
 * Uses TZ environment variable to determine timezone (defaults to America/Los_Angeles).
 */

// Load .env but don't override CLI environment variables
require('dotenv').config();

/**
 * Get the configured timezone from environment or default to Pacific
 * @returns {string} IANA timezone identifier
 */
function getTimezone() {
  return process.env.TZ || 'America/Los_Angeles';
}

/**
 * Get current date in configured timezone as YYYY-MM-DD
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getDateString() {
  const now = new Date();
  const timezone = getTimezone();

  // Use toLocaleString with timezone to get correct date
  const dateStr = now.toLocaleString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  // Convert from MM/DD/YYYY to YYYY-MM-DD
  const [month, day, year] = dateStr.split('/');
  return `${year}-${month}-${day}`;
}

/**
 * Get current time in configured timezone as HHMMSS
 * @returns {string} Time string in HHMMSS format
 */
function getTimeString() {
  const now = new Date();
  const timezone = getTimezone();

  const timeStr = now.toLocaleString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Remove colons to get HHMMSS
  return timeStr.replace(/:/g, '');
}

/**
 * Get current date and time in configured timezone
 * @returns {Object} Object with date and time strings
 */
function getDateTime() {
  return {
    date: getDateString(),
    time: getTimeString(),
    timezone: getTimezone()
  };
}

/**
 * Format a Date object in configured timezone
 * @param {Date} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
function formatDate(date, options = {}) {
  const timezone = getTimezone();
  const defaultOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  return date.toLocaleString('en-US', { ...defaultOptions, ...options });
}

module.exports = {
  getTimezone,
  getDateString,
  getTimeString,
  getDateTime,
  formatDate
};
