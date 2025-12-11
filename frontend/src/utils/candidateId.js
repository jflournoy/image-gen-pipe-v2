/**
 * Candidate ID Utility Functions
 *
 * Single source of truth for candidate ID generation and parsing.
 * All IDs follow format: i{iteration}c{candidateId}
 * Example: i0c0, i1c2, i2c5
 */

/**
 * Generate a candidate ID from iteration and candidate number
 * @param {number} iteration - Iteration number
 * @param {number} candidateId - Candidate number within iteration
 * @returns {string} Formatted ID like "i0c0"
 */
export function generateCandidateId(iteration, candidateId) {
  if (typeof iteration !== 'number' || typeof candidateId !== 'number') {
    throw new Error(`Invalid candidate ID parameters: iteration=${iteration}, candidateId=${candidateId}`);
  }
  return `i${iteration}c${candidateId}`;
}

/**
 * Parse a candidate ID to extract iteration and candidate number
 * @param {string} id - Candidate ID like "i0c0"
 * @returns {object} { iteration: number, candidateId: number } or null if invalid
 */
export function parseCandidateId(id) {
  if (typeof id !== 'string') {
    return null;
  }

  const match = id.match(/^i(\d+)c(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    iteration: parseInt(match[1], 10),
    candidateId: parseInt(match[2], 10)
  };
}

/**
 * Validate if a string is a valid candidate ID
 * @param {string} id - String to validate
 * @returns {boolean} True if valid ID format
 */
export function isValidCandidateId(id) {
  return /^i\d+c\d+$/.test(id);
}
