/**
 * @file ProgressVisualization Component
 * Simple progress display for beam search jobs
 */

import PropTypes from 'prop-types';
import './ProgressVisualization.css';

export default function ProgressVisualization({
  jobId,
  status,
  currentIteration = 0,
  totalIterations = 0,
  bestScore,
  elapsedTime,
  error,
  tokenUsage,
  estimatedCost,
  onCancel,
  cancelling = false
}) {
  if (!jobId && !status) {
    return null;
  }

  const progressPercent = totalIterations > 0
    ? Math.min(100, (currentIteration / totalIterations) * 100)
    : 0;

  const formatElapsedTime = (ms) => {
    if (!ms) return null;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatTokens = (tokens) => {
    if (tokens === undefined || tokens === null) return '0';
    return tokens.toLocaleString();
  };

  const formatCost = (cost) => {
    if (cost === undefined || cost === null) return '$0.00';
    return `$${cost.toFixed(4)}`;
  };

  return (
    <div className="progress-visualization" role="status" aria-live="polite">
      <div className="progress-header">
        <span className="job-id">Job: {jobId}</span>
        <span className="status-badge">Status: {status}</span>
      </div>

      <div className="progress-content">
        {totalIterations > 0 && (
          <>
            <div className="progress-info">
              <div>Iteration {currentIteration} of {totalIterations}</div>
              <div className="progress-percent">{Math.round(progressPercent)}%</div>
            </div>

            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${progressPercent}%` }}
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin="0"
                aria-valuemax="100"
              />
            </div>
          </>
        )}

        <div className="progress-stats">
          {formatElapsedTime(elapsedTime) && (
            <span className="stat">Elapsed: {formatElapsedTime(elapsedTime)}</span>
          )}
          {bestScore !== undefined && (
            <span className="stat">Best Score: {bestScore.toFixed(2)}</span>
          )}
          {estimatedCost?.total !== undefined && (
            <span className="stat">Cost: {formatCost(estimatedCost.total)}</span>
          )}
        </div>

        {(tokenUsage?.total !== undefined || estimatedCost?.total !== undefined) && (
          <div className="tokens-info">
            {tokenUsage?.total !== undefined && (
              <span>Tokens: {formatTokens(tokenUsage.total)}</span>
            )}
          </div>
        )}
      </div>

      {status === 'running' && onCancel && (
        <button
          className="cancel-button"
          onClick={onCancel}
          disabled={cancelling}
          title="Cancel this beam search job"
        >
          {cancelling ? 'Cancelling...' : 'Cancel'}
        </button>
      )}

      {error && (
        <div className="error-message" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
}

ProgressVisualization.propTypes = {
  jobId: PropTypes.string,
  status: PropTypes.oneOf(['running', 'completed', 'error', 'cancelled']),
  currentIteration: PropTypes.number,
  totalIterations: PropTypes.number,
  bestScore: PropTypes.number,
  elapsedTime: PropTypes.number,
  error: PropTypes.string,
  tokenUsage: PropTypes.shape({
    total: PropTypes.number
  }),
  estimatedCost: PropTypes.shape({
    total: PropTypes.number
  }),
  onCancel: PropTypes.func,
  cancelling: PropTypes.bool
};
