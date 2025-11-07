/**
 * @file App Component
 * Main application component integrating BeamSearchForm and WebSocket
 */

import { useState, useEffect, useCallback } from 'react';
import BeamSearchForm from './components/BeamSearchForm';
import ImageGallery from './components/ImageGallery';
import ProgressVisualization from './components/ProgressVisualization';
import ErrorDisplay from './components/ErrorDisplay';
import useWebSocket from './hooks/useWebSocket';
import './App.css';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000'

function App() {
  const [currentJobId, setCurrentJobId] = useState(null);
  const [jobStartTime, setJobStartTime] = useState(null);
  const [currentStatus, setCurrentStatus] = useState(null);
  const [images, setImages] = useState([]);
  const [lastFormData, setLastFormData] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const { isConnected, messages, error, subscribe, getMessagesByType } = useWebSocket(WS_URL);

  const handleFormSubmit = useCallback(async (formData) => {
    try {
      // Clear previous errors
      setApiError(null);
      setRetrying(false);

      // Reset state for new job
      setImages([]);
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

  // Get messages by type
  const startedMessages = getMessagesByType('started');
  const iterationMessages = getMessagesByType('iteration');
  const candidateMessages = getMessagesByType('candidate');
  const completeMessages = getMessagesByType('complete');
  const errorMessages = getMessagesByType('error');

  // Calculate progress data from messages
  const latestIteration = iterationMessages[iterationMessages.length - 1];
  const currentIteration = latestIteration?.iteration || 0;
  const totalIterations = latestIteration?.totalIterations || 0;
  const bestScore = latestIteration?.bestScore || 0;

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

  // Handle completion messages
  useEffect(() => {
    if (completeMessages.length > 0 && images.length === 0) {
      const latestComplete = completeMessages[completeMessages.length - 1];
      setCurrentStatus('completed');

      if (latestComplete.result && latestComplete.result.bestCandidate) {
        const { bestCandidate } = latestComplete.result;
        setImages([{
          id: 'best-candidate',
          url: bestCandidate.imageUrl,
          score: bestCandidate.totalScore
        }]);
      }
    }
  }, [completeMessages, images.length]);

  // Handle error messages
  useEffect(() => {
    if (errorMessages.length > 0) {
      setCurrentStatus('error');
    }
  }, [errorMessages]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Beam Search Image Generator</h1>
        <div className="connection-status">
          WebSocket: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </header>

      <main className="app-main">
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
              error={error}
            />
          </section>
        )}

        <section className="gallery-section">
          <ImageGallery images={images} />
        </section>
      </main>
    </div>
  )
}

export default App
