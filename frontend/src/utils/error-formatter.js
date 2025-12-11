/**
 * Error formatter for API errors
 * Provides user-friendly error messages while hiding technical details
 */

/**
 * Parse and format API errors
 * @param {string} errorMessage - Raw error message from API
 * @returns {Object} Formatted error object with friendly message and technical details
 */
export function formatAPIError(errorMessage) {
  if (!errorMessage) {
    return {
      message: 'An unknown error occurred',
      type: 'generic',
      details: null,
      suggestion: null,
      isSafety: false,
      isRateLimit: false
    };
  }

  const lowerError = errorMessage.toLowerCase();

  // Safety violations (sexual, violence, hate, etc.)
  if (lowerError.includes('safety') || lowerError.includes('safety_violations')) {
    const violationMatch = errorMessage.match(/safety_violations=\[([^\]]+)\]/);
    const violations = violationMatch ? violationMatch[1] : 'safety policy';

    return {
      message: 'Your request was rejected due to content policy',
      type: 'safety',
      details: errorMessage,
      suggestion: `This prompt may contain content that violates our safety policy (${violations}). Please try rephrasing your request.`,
      isSafety: true,
      isRateLimit: false
    };
  }

  // Rate limits
  if (lowerError.includes('rate_limit') || lowerError.includes('429') || lowerError.includes('quota')) {
    return {
      message: 'Rate limit reached - please try again in a moment',
      type: 'rate-limit',
      details: errorMessage,
      suggestion: 'The API is temporarily busy. Wait a few moments and try again.',
      isSafety: false,
      isRateLimit: true
    };
  }

  // Invalid API key
  if (lowerError.includes('invalid_api_key') || lowerError.includes('unauthorized') || lowerError.includes('401')) {
    return {
      message: 'Authentication failed',
      type: 'auth',
      details: errorMessage,
      suggestion: 'Please check that your API key is valid.',
      isSafety: false,
      isRateLimit: false
    };
  }

  // Model not found
  if (lowerError.includes('model_not_found') || lowerError.includes('404')) {
    return {
      message: 'Model not available',
      type: 'model',
      details: errorMessage,
      suggestion: 'The requested model is not available. Please check the configuration.',
      isSafety: false,
      isRateLimit: false
    };
  }

  // Server errors
  if (lowerError.includes('500') || lowerError.includes('server_error')) {
    return {
      message: 'Server error - please try again later',
      type: 'server',
      details: errorMessage,
      suggestion: 'The service is temporarily unavailable. Please try again later.',
      isSafety: false,
      isRateLimit: false
    };
  }

  // Timeout
  if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
    return {
      message: 'Request timed out',
      type: 'timeout',
      details: errorMessage,
      suggestion: 'The request took too long. Try again with a simpler prompt.',
      isSafety: false,
      isRateLimit: false
    };
  }

  // Network error
  if (lowerError.includes('network') || lowerError.includes('econnrefused') || lowerError.includes('enotfound')) {
    return {
      message: 'Network connection error',
      type: 'network',
      details: errorMessage,
      suggestion: 'Check your internet connection and try again.',
      isSafety: false,
      isRateLimit: false
    };
  }

  // Default: generic API error
  return {
    message: 'An API error occurred',
    type: 'api',
    details: errorMessage,
    suggestion: 'Please try again. If the problem persists, check the details below.',
    isSafety: false,
    isRateLimit: false
  };
}

/**
 * Extract just the user-friendly message and suggestion from an error
 * Hides technical details by default
 * @param {string} errorMessage - Raw error message
 * @returns {Object} { message, suggestion, showDetails }
 */
export function getErrorSummary(errorMessage) {
  const formatted = formatAPIError(errorMessage);
  return {
    message: formatted.message,
    suggestion: formatted.suggestion,
    hasDetails: !!formatted.details,
    details: formatted.details,
    isSafety: formatted.isSafety
  };
}
