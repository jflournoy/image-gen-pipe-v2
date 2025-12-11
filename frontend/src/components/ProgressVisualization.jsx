/**
 * @file ProgressVisualization Component (TDD GREEN)
 * Displays progress information for beam search jobs
 */

import PropTypes from 'prop-types';
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
  currentOperation
}) {
  // Don't render if no job is active
  if (!jobId && !status) {
    return null;
  }

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

      {error && (
        <div className="error-message" role="alert">
          {error}
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
  })
};
