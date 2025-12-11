/**
 * @file ProgressVisualization Component (TDD GREEN)
 * Displays progress information for beam search jobs with token tracking
 */

import { useState } from 'react';
import PropTypes from 'prop-types';
import { getErrorSummary } from '../utils/error-formatter';
import './ProgressVisualization.css';

export default function ProgressVisualization({
  jobId,
  status,
  currentIteration = 0,
  totalIterations = 0,
  candidatesProcessed,
  totalCandidates,
  bestScore,
  elapsedTime,
  error,
  currentOperation,
  tokenUsage,
  estimatedCost,
  operationMessages = []
}) {
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Don't render if no job is active
  if (!jobId && !status) {
    return null;
  }

  // Format error message gracefully
  const getFormattedError = () => {
    if (!error) return null;
    return getErrorSummary(error);
  };

  const formattedError = getFormattedError();

  // Calculate progress percentage
  const calculateProgress = () => {
    if (totalIterations === 0) return 0;
    const progress = (currentIteration / totalIterations) * 100;
    return Math.min(100, Math.max(0, progress)); // Clamp between 0-100
  };

  const progressPercent = calculateProgress();

  // Format elapsed time
  const formatElapsedTime = (ms) => {
    if (!ms) return null;

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formattedElapsedTime = formatElapsedTime(elapsedTime);

  // Format token counts with commas
  const formatTokens = (tokens) => {
    if (tokens === undefined || tokens === null) return '0';
    return tokens.toLocaleString();
  };

  // Format cost as currency
  const formatCost = (cost) => {
    if (cost === undefined || cost === null) return '$0.00';
    return `$${cost.toFixed(4)}`;
  };

  // Get recent progress messages (last 15 for better visibility of micro-progress)
  const recentOperations = operationMessages.slice(-15);

  // Determine CSS classes
  const containerClasses = [
    'progress-visualization',
    status
  ].filter(Boolean).join(' ');

  const progressBarClasses = [
    'progress-bar-fill',
    status === 'running' && 'animated'
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClasses} role="status" aria-live="polite">
      <div className="progress-header">
        <div className="progress-info">
          <span className="job-id">Job: {jobId}</span>
          <span className="status-badge">Status: {status}</span>
        </div>

        {formattedElapsedTime && (
          <div className="elapsed-time">
            Elapsed: {formattedElapsedTime}
          </div>
        )}
      </div>

      {(totalIterations > 0 || currentIteration === 0) && (
        <div className="iteration-info">
          <span>Iteration {currentIteration} of {totalIterations}</span>
          <span className="progress-percent">{Math.round(progressPercent)}%</span>
        </div>
      )}

      {(totalIterations > 0 || currentIteration === 0) && (
        <div className="progress-bar">
          <div
            className={progressBarClasses}
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin="0"
            aria-valuemax="100"
          />
        </div>
      )}

      {currentOperation && (
        <div className="operation-info">
          <span className="operation-label">Processing:</span>
          <span className="operation-message">{currentOperation.message}</span>
        </div>
      )}

      {/* Token Usage and Cost Display */}
      {(tokenUsage || estimatedCost) && (
        <div className="tokens-cost-section">
          <div className="tokens-grid">
            {tokenUsage?.llm !== undefined && (
              <div className="token-item">
                <span className="token-label">LLM Tokens:</span>
                <span className="token-value">{formatTokens(tokenUsage.llm)}</span>
              </div>
            )}
            {tokenUsage?.vision !== undefined && (
              <div className="token-item">
                <span className="token-label">Vision Tokens:</span>
                <span className="token-value">{formatTokens(tokenUsage.vision)}</span>
              </div>
            )}
            {tokenUsage?.imageGen !== undefined && (
              <div className="token-item">
                <span className="token-label">ImageGen Tokens:</span>
                <span className="token-value">{formatTokens(tokenUsage.imageGen)}</span>
              </div>
            )}
            {tokenUsage?.critique !== undefined && (
              <div className="token-item">
                <span className="token-label">Critique Tokens:</span>
                <span className="token-value">{formatTokens(tokenUsage.critique)}</span>
              </div>
            )}
            {tokenUsage?.total !== undefined && (
              <div className="token-item token-total">
                <span className="token-label">Total Tokens:</span>
                <span className="token-value">{formatTokens(tokenUsage.total)}</span>
              </div>
            )}
            {estimatedCost?.total !== undefined && (
              <div className="token-item cost-item">
                <span className="token-label">Estimated Cost:</span>
                <span className="token-value cost-value">{formatCost(estimatedCost.total)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Operation History */}
      {recentOperations.length > 0 && (
        <div className="operation-history">
          <div className="history-label">Recent Steps:</div>
          <div className="history-list">
            {recentOperations.map((op, idx) => (
              <div key={idx} className="history-item">
                <span className="history-time">
                  {op.timestamp ? new Date(op.timestamp).toLocaleTimeString() : ''}
                </span>
                <span className="history-message">{op.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(candidatesProcessed !== undefined && totalCandidates !== undefined) && (
        <div className="candidates-info">
          Candidates: {candidatesProcessed} / {totalCandidates}
        </div>
      )}

      {bestScore !== undefined && (
        <div className="best-score">
          Best score: {bestScore}
        </div>
      )}

      {formattedError && (
        <div className={`error-message ${formattedError.isSafety ? 'safety-error' : ''}`} role="alert">
          <div className="error-main">
            <strong>{formattedError.message}</strong>
          </div>
          {formattedError.suggestion && (
            <div className="error-suggestion">{formattedError.suggestion}</div>
          )}
          {formattedError.hasDetails && (
            <div className="error-details-section">
              <button
                className="details-toggle"
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                aria-expanded={showErrorDetails}
              >
                {showErrorDetails ? '▼' : '▶'} Technical Details
              </button>
              {showErrorDetails && (
                <div className="error-details">{formattedError.details}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

ProgressVisualization.propTypes = {
  jobId: PropTypes.string,
  status: PropTypes.oneOf(['running', 'completed', 'error']),
  currentIteration: PropTypes.number,
  totalIterations: PropTypes.number,
  candidatesProcessed: PropTypes.number,
  totalCandidates: PropTypes.number,
  bestScore: PropTypes.number,
  elapsedTime: PropTypes.number,
  error: PropTypes.string,
  currentOperation: PropTypes.shape({
    message: PropTypes.string,
    operation: PropTypes.string,
    candidateId: PropTypes.string,
    status: PropTypes.string
  }),
  tokenUsage: PropTypes.shape({
    llm: PropTypes.number,
    vision: PropTypes.number,
    imageGen: PropTypes.number,
    critique: PropTypes.number,
    total: PropTypes.number
  }),
  estimatedCost: PropTypes.shape({
    llm: PropTypes.number,
    vision: PropTypes.number,
    imageGen: PropTypes.number,
    critique: PropTypes.number,
    total: PropTypes.number
  }),
  operationMessages: PropTypes.arrayOf(PropTypes.shape({
    message: PropTypes.string,
    timestamp: PropTypes.string
  }))
};
