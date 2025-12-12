/**
 * @file App Component
 * Main application component integrating BeamSearchForm and WebSocket
 */

import { useState, useEffect, useCallback } from 'react';
import BeamSearchForm from './components/BeamSearchForm';
import ImageGallery from './components/ImageGallery';
import ProgressVisualization from './components/ProgressVisualization';
import ErrorDisplay from './components/ErrorDisplay';
import JobSelector from './components/JobSelector';
import useWebSocket from './hooks/useWebSocket';
import { generateCandidateId } from './utils/candidateId';
import './App.css';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000'

function App() {
  const [currentJobId, setCurrentJobId] = useState(null);
  const [jobStartTime, setJobStartTime] = useState(null);
  const [currentStatus, setCurrentStatus] = useState(null);
  const [images, setImages] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [lastFormData, setLastFormData] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [tokenUsage, setTokenUsage] = useState(null);
  const [estimatedCost, setEstimatedCost] = useState(null);
  const [showJobSelector, setShowJobSelector] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const { isConnected, error, subscribe, getMessagesByType } = useWebSocket(WS_URL);

  const handleFormSubmit = useCallback(async (formData) => {
    try {
      // Clear previous errors
      setApiError(null);
      setRetrying(false);

      // Reset state for new job
      setImages([]);
      setMetadata(null);
      setTokenUsage(null);
      setEstimatedCost(null);
      setCurrentStatus('starting');
      setJobStartTime(Date.now());
      setLastFormData(formData); // Save for retry

      // Call the beam search API
      const response = await fetch('http://localhost:3000/api/beam-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText || 'Failed to start beam search'}`);
      }

      const data = await response.json();
      setCurrentJobId(data.jobId);
      setCurrentStatus('running');

      // Subscribe to WebSocket updates for this job
      subscribe(data.jobId);
    } catch (err) {
      console.error('Error starting beam search:', err);
      setCurrentStatus('error');
      setApiError({
        message: err.message || 'Failed to start beam search',
        type: err.name === 'TypeError' ? 'network' : 'api',
        details: err.stack
      });
    } finally {
      setRetrying(false);
    }
  }, [subscribe]);

  // Retry functionality
  const handleRetry = useCallback(() => {
    if (lastFormData) {
      setRetrying(true);
      handleFormSubmit(lastFormData);
    }
  }, [lastFormData, handleFormSubmit]);

  // Cancel job functionality
  const handleCancel = useCallback(async () => {
    if (!currentJobId) return;

    setCancelling(true);
    try {
      const response = await fetch(`http://localhost:3000/api/jobs/${currentJobId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        setCurrentStatus('cancelled');
        setCurrentJobId(null);
      } else {
        console.error('Failed to cancel job:', response.statusText);
      }
    } catch (err) {
      console.error('Error cancelling job:', err);
    } finally {
      setCancelling(false);
    }
  }, [currentJobId]);

  // Handle selecting a previous job
  const handleSelectJob = useCallback(async (jobData) => {
    const { sessionId } = jobData;

    try {
      // Fetch the full metadata for this session
      const response = await fetch(`http://localhost:3000/api/jobs/${sessionId}`);

      if (!response.ok) {
        console.error('Failed to fetch session metadata:', response.statusText);
        setApiError({
          message: 'Failed to load session metadata',
          type: 'api'
        });
        return;
      }

      await response.json();
      setSelectedSessionId(sessionId);
      setCurrentStatus('completed');
      setShowJobSelector(false);

      // Clear current job state
      setCurrentJobId(null);
      setImages([]);
      setLastFormData(null);
    } catch (err) {
      console.error('Error loading session:', err);
      setApiError({
        message: 'Failed to load session: ' + err.message,
        type: 'api'
      });
    }
  }, []);

  // Get messages by type
  const iterationMessages = getMessagesByType('iteration');
  const candidateMessages = getMessagesByType('candidate');
  const rankedMessages = getMessagesByType('ranked');
  const operationMessages = getMessagesByType('operation');
  const completeMessages = getMessagesByType('complete');
  const errorMessages = getMessagesByType('error');
  const cancelledMessages = getMessagesByType('cancelled');

  // Calculate progress data from messages
  const latestIteration = iterationMessages[iterationMessages.length - 1];
  const currentIteration = latestIteration?.iteration || 0;
  const totalIterations = latestIteration?.totalIterations || 0;
  const bestScore = latestIteration?.bestScore || 0;
  const currentOperation = operationMessages[operationMessages.length - 1];


  // Calculate elapsed time
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (currentStatus === 'running' && jobStartTime) {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - jobStartTime);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [currentStatus, jobStartTime]);



  // Handle candidate messages - add images as they come in
  useEffect(() => {
    if (candidateMessages.length > images.length && currentStatus === 'running') {
      const newCandidates = candidateMessages.slice(images.length);
      const newImages = newCandidates
        .filter((candidate) => candidate.imageUrl)
        .map((candidate) => ({
          id: generateCandidateId(candidate.iteration, candidate.candidateId),
          url: candidate.imageUrl,
          score: candidate.score,        // Keep for sorting/legacy
          ranking: candidate.ranking,    // Add ranking data
          whatPrompt: candidate.whatPrompt,
          howPrompt: candidate.howPrompt,
          combined: candidate.combined   // FIX: Extract combined prompt
        }));

      if (newImages.length > 0) {
        setImages((prevImages) => [...prevImages, ...newImages]);
      }
    }
  }, [candidateMessages, images.length, currentStatus]);

  // Handle ranked messages - update images with ranking data
  // Ranked messages provide ranking info for candidates after ranking phase completes
  useEffect(() => {
    if (rankedMessages.length > 0) {
      setImages((prevImages) =>
        prevImages.map((image) => {
          // Find matching ranked message for this image
          const rankedMsg = rankedMessages.find(
            (msg) => generateCandidateId(msg.iteration, msg.candidateId) === image.id
          );

          if (rankedMsg) {
            return {
              ...image,
              ranking: {
                rank: rankedMsg.rank,
                reason: rankedMsg.reason,
                strengths: rankedMsg.strengths,
                weaknesses: rankedMsg.weaknesses
              }
            };
          }
          return image;
        })
      );
    }
  }, [rankedMessages]);

  // Handle completion messages
  useEffect(() => {
    if (completeMessages.length > 0) {
      const latestComplete = completeMessages[completeMessages.length - 1];
      setCurrentStatus('completed');

      if (latestComplete.result && latestComplete.result.bestCandidate) {
        const { bestCandidate } = latestComplete.result;
        // Only add best-candidate if we haven't already added candidates from iterations
        if (images.length === 0) {
          setImages([{
            id: 'best-candidate',
            url: bestCandidate.imageUrl,
            score: bestCandidate.totalScore
          }]);
        }
      }

    }
  }, [completeMessages, currentJobId, images.length]);

  // Get the latest error message from WebSocket backend
  const latestErrorMessage = errorMessages.length > 0 ? errorMessages[errorMessages.length - 1]?.message : null;

  // Handle error messages
  useEffect(() => {
    if (errorMessages.length > 0) {
      setCurrentStatus('error');
    }
  }, [errorMessages]);

  // Handle cancelled messages
  useEffect(() => {
    if (cancelledMessages.length > 0) {
      setCurrentStatus('cancelled');
    }
  }, [cancelledMessages]);

  // Update token usage and cost from iteration messages
  useEffect(() => {
    if (latestIteration) {
      if (latestIteration.tokenUsage) {
        setTokenUsage(latestIteration.tokenUsage);
      }
      if (latestIteration.estimatedCost) {
        setEstimatedCost(latestIteration.estimatedCost);
      }
    }
  }, [latestIteration]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Beam Search Image Generator</h1>
        <div className="header-controls">
          <div className="connection-status">
            WebSocket: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
          <button
            className="btn-previous-jobs"
            onClick={() => setShowJobSelector(!showJobSelector)}
            title="View previous jobs and results"
          >
            📋 Previous Jobs
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* Job Selector Modal */}
        {showJobSelector && (
          <div className="modal-overlay">
            <div className="modal-content">
              <button
                className="modal-close"
                onClick={() => setShowJobSelector(false)}
                aria-label="Close job selector"
              >
                ✕
              </button>
              <JobSelector
                onSelectJob={handleSelectJob}
                isLoading={false}
              />
            </div>
          </div>
        )}

        {/* WebSocket connection error */}
        {error && (
          <ErrorDisplay
            error={error}
            type="websocket"
            critical={!isConnected}
            onDismiss={() => {}} // WebSocket errors auto-clear when reconnected
          />
        )}

        {/* API/Job error */}
        {apiError && (
          <ErrorDisplay
            error={apiError.message}
            type={apiError.type}
            details={apiError.details}
            onRetry={lastFormData ? handleRetry : undefined}
            retrying={retrying}
            onDismiss={() => setApiError(null)}
          />
        )}

        {/* Job execution errors from backend */}
        {errorMessages.length > 0 && (
          <ErrorDisplay
            error={errorMessages[errorMessages.length - 1].error || 'Job execution failed'}
            type="api"
            details={errorMessages[errorMessages.length - 1].details}
            onRetry={lastFormData ? handleRetry : undefined}
            retrying={retrying}
            onDismiss={() => setCurrentStatus(null)}
          />
        )}

        <section className="form-section">
          <BeamSearchForm onSubmit={handleFormSubmit} />
        </section>

        {currentJobId && (
          <section className="status-section">
            <ProgressVisualization
              jobId={currentJobId}
              status={currentStatus}
              currentIteration={currentIteration}
              totalIterations={totalIterations}
              bestScore={bestScore}
              elapsedTime={elapsedTime}
              error={latestErrorMessage}
              currentOperation={currentOperation}
              tokenUsage={tokenUsage}
              estimatedCost={estimatedCost}
              operationMessages={operationMessages}
              onCancel={handleCancel}
              cancelling={cancelling}
            />
          </section>
        )}

        {/* Gallery view - shown after completion or as backup */}
        <section className="gallery-section">
          <ImageGallery
            images={images}
            loading={currentStatus === 'running'}
            expectedCount={lastFormData?.n || 4}
          />
        </section>

        {/* Show back button when viewing a previous job */}
        {selectedSessionId && (
          <section className="back-section">
            <button
              className="btn-back"
              onClick={() => {
                setSelectedSessionId(null);
                setCurrentStatus(null);
              }}
            >
              ← Back to New Job
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
