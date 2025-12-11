/**
 * JobSelector Component
 *
 * Displays a list of available job sessions and allows users to select one
 * to reconnect to or view results.
 */

import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './JobSelector.css';

export default function JobSelector({ onSelectJob, isLoading: externalIsLoading }) {
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  // Fetch available jobs on mount
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch('/api/jobs');

        if (!response.ok) {
          throw new Error(`Failed to fetch jobs: ${response.statusText}`);
        }

        const data = await response.json();
        setJobs(data.sessions || []);

        if (data.sessions && data.sessions.length === 0) {
          setError('No previous jobs found. Start a new beam search to begin.');
        }
      } catch (err) {
        console.error('[JobSelector] Error fetching jobs:', err);
        setError(err.message || 'Failed to load jobs');
      } finally {
        setIsLoading(false);
      }
    };

    fetchJobs();
  }, []);

  const handleSelectJob = (job) => {
    setSelectedSessionId(job.sessionId);
  };

  const handleReconnect = async () => {
    if (!selectedSessionId) return;

    const selectedJob = jobs.find(j => j.sessionId === selectedSessionId);
    if (!selectedJob) return;

    // Notify parent component to switch to this job
    if (onSelectJob) {
      onSelectJob({
        sessionId: selectedSessionId,
        job: selectedJob
      });
    }
  };

  if (externalIsLoading || isLoading) {
    return (
      <div className="job-selector loading">
        <div className="spinner"></div>
        <p>Loading available jobs...</p>
      </div>
    );
  }

  if (error && jobs.length === 0) {
    return (
      <div className="job-selector empty">
        <div className="empty-state">
          <p className="empty-message">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="job-selector">
      <div className="job-selector-header">
        <h2>Available Jobs</h2>
        <p className="job-count">{jobs.length} session{jobs.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="job-list">
        {jobs.map((job) => (
          <div
            key={job.sessionId}
            className={`job-item ${selectedSessionId === job.sessionId ? 'selected' : ''}`}
            onClick={() => handleSelectJob(job)}
          >
            <div className="job-header">
              <h3 className="job-session-id">{job.sessionId}</h3>
              <span className="job-date">{new Date(job.timestamp).toLocaleString()}</span>
            </div>

            <div className="job-details">
              <p className="job-prompt">
                <strong>Prompt:</strong> {job.userPrompt}
              </p>

              {job.config && (
                <div className="job-config">
                  <strong>Config:</strong>
                  <ul className="config-list">
                    <li>Beam Width (N): {job.config.beamWidth}</li>
                    <li>Keep Top (M): {job.config.keepTop}</li>
                    <li>Max Iterations: {job.config.maxIterations}</li>
                  </ul>
                </div>
              )}

              <p className="job-iterations">
                Completed Iterations: {job.iterationCount}
              </p>

              {job.finalWinner && (
                <p className="job-winner">
                  <strong>Final Winner:</strong> {job.finalWinner}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedSessionId && (
        <div className="job-selector-actions">
          <button
            className="btn-reconnect"
            onClick={handleReconnect}
            disabled={!selectedSessionId}
          >
            View Results
          </button>
        </div>
      )}
    </div>
  );
}

JobSelector.propTypes = {
  onSelectJob: PropTypes.func.isRequired,
  isLoading: PropTypes.bool
};

JobSelector.defaultProps = {
  isLoading: false
};
