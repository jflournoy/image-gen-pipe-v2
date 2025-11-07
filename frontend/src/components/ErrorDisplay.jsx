/**
 * @file ErrorDisplay Component (TDD GREEN)
 * Enhanced error display with retry functionality and helpful messaging
 */

import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './ErrorDisplay.css';

export default function ErrorDisplay({
  error,
  errors,
  type = 'generic',
  onRetry,
  retrying = false,
  onDismiss,
  details,
  helpText,
  critical = false,
  autoDismissAfter
}) {
  const [showDetails, setShowDetails] = useState(false);

  // Handle auto-dismiss
  useEffect(() => {
    if (autoDismissAfter && onDismiss) {
      const timer = setTimeout(() => {
        onDismiss();
      }, autoDismissAfter);

      return () => clearTimeout(timer);
    }
  }, [autoDismissAfter, onDismiss]);

  // Don't render if no error
  if (!error && (!errors || errors.length === 0)) {
    return null;
  }

  // Get icon based on error type
  const getErrorIcon = () => {
    switch (type) {
      case 'network':
        return '🌐';
      case 'api':
        return '⚠️';
      case 'websocket':
        return '🔌';
      default:
        return '❌';
    }
  };

  // Get default help text based on error type
  const getDefaultHelpText = () => {
    switch (type) {
      case 'network':
        return 'Please check your internet connection and try again.';
      case 'api':
        return 'Please try again later or contact support if the problem persists.';
      case 'websocket':
        return 'Connection lost. The page will automatically reconnect.';
      default:
        return null;
    }
  };

  const displayHelpText = helpText || getDefaultHelpText();

  // Handle multiple errors
  const errorList = errors || (error ? [error] : []);
  const hasMultipleErrors = errorList.length > 1;

  return (
    <div
      className="error-display"
      role="alert"
      aria-live={critical ? 'assertive' : 'polite'}
    >
      <div className="error-header">
        <span className="error-icon">{getErrorIcon()}</span>
        <div className="error-content">
          {hasMultipleErrors ? (
            <>
              <div className="error-count">{errorList.length} errors occurred</div>
              <ul className="error-list">
                {errorList.map((err, index) => (
                  <li key={index} className="error-item">
                    {err}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="error-message">{error || errorList[0]}</div>
          )}

          {displayHelpText && (
            <div className="error-help">{displayHelpText}</div>
          )}

          {details && (
            <div className="error-details-section">
              <button
                className="details-toggle"
                onClick={() => setShowDetails(!showDetails)}
                aria-expanded={showDetails}
              >
                {showDetails ? '▼' : '▶'} Details
              </button>
              {showDetails && (
                <div className="error-details">{details}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="error-actions">
        {onRetry && (
          <button
            className="retry-button"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? '⏳ Retrying...' : '🔄 Retry'}
          </button>
        )}

        {onDismiss && (
          <button
            className="dismiss-button"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            ✕ Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

ErrorDisplay.propTypes = {
  error: PropTypes.string,
  errors: PropTypes.arrayOf(PropTypes.string),
  type: PropTypes.oneOf(['generic', 'network', 'api', 'websocket']),
  onRetry: PropTypes.func,
  retrying: PropTypes.bool,
  onDismiss: PropTypes.func,
  details: PropTypes.string,
  helpText: PropTypes.string,
  critical: PropTypes.bool,
  autoDismissAfter: PropTypes.number
};
