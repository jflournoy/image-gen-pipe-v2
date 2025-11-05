/**
 * @file App Component
 * Main application component integrating BeamSearchForm and WebSocket
 */

import { useState } from 'react'
import BeamSearchForm from './components/BeamSearchForm'
import ImageGallery from './components/ImageGallery'
import useWebSocket from './hooks/useWebSocket'
import './App.css'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000'

function App() {
  const [currentJobId, setCurrentJobId] = useState(null)
  const [images, setImages] = useState([])
  const { isConnected, messages, error, subscribe, getMessagesByType } = useWebSocket(WS_URL)

  const handleFormSubmit = async (formData) => {
    try {
      // Reset images for new job
      setImages([])

      // Call the beam search API
      const response = await fetch('http://localhost:3000/api/beam-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        throw new Error('Failed to start beam search')
      }

      const data = await response.json()
      setCurrentJobId(data.jobId)

      // Subscribe to WebSocket updates for this job
      subscribe(data.jobId)
    } catch (err) {
      console.error('Error starting beam search:', err)
    }
  }

  const progressMessages = getMessagesByType('progress')
  const completeMessages = getMessagesByType('complete')

  // Extract images from complete messages
  if (completeMessages.length > 0 && images.length === 0) {
    const latestComplete = completeMessages[completeMessages.length - 1]
    if (latestComplete.results && Array.isArray(latestComplete.results)) {
      setImages(latestComplete.results.map((result, index) => ({
        id: result.imageId || `image-${index}`,
        url: `http://localhost:3000/api/images/${result.imageId || `image-${index}`}`,
        score: result.score || 0
      })))
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Beam Search Image Generator</h1>
        <div className="connection-status">
          WebSocket: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-message" role="alert">
            ❌ {error}
          </div>
        )}

        <section className="form-section">
          <BeamSearchForm onSubmit={handleFormSubmit} />
        </section>

        {currentJobId && (
          <section className="status-section">
            <h2>Job started: {currentJobId}</h2>

            {progressMessages.length > 0 && (
              <div className="progress-updates">
                <h3>Progress Updates:</h3>
                {progressMessages.map((msg, index) => (
                  <div key={index} className="progress-item">
                    Iteration {msg.iteration}: {msg.progress}%
                  </div>
                ))}
              </div>
            )}
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
