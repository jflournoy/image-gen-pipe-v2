/**
 * @file BeamSearchForm Component
 * Form for submitting beam search parameters with Flux generation settings
 */

import { useState } from 'react'
import GuidanceSettings from './GuidanceSettings'
import StepsSettings from './StepsSettings'
import './BeamSearchForm.css'

export default function BeamSearchForm({ onSubmit }) {
  const [prompt, setPrompt] = useState('')
  const [n, setN] = useState(4)
  const [m, setM] = useState(2)
  const [iterations, setIterations] = useState(3)
  const [alpha, setAlpha] = useState(0.7)
  const [error, setError] = useState('')

  // Advanced settings (Flux generation options)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [steps, setSteps] = useState(25)
  const [guidance, setGuidance] = useState(3.5)
  const [seed, setSeed] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()

    // Validate prompt
    if (!prompt.trim()) {
      setError('Prompt is required')
      return
    }

    // Clear error and submit
    setError('')

    // Build submit data
    const data = {
      prompt,
      n,
      m,
      iterations,
      alpha
    }

    // Include fluxOptions if any advanced settings were modified
    const fluxOptions = {}
    if (steps !== 25) fluxOptions.steps = steps
    if (guidance !== 3.5) fluxOptions.guidance = guidance
    if (seed !== '') fluxOptions.seed = Number(seed)

    // Always include fluxOptions if advanced settings have been opened and modified
    if (Object.keys(fluxOptions).length > 0 || showAdvanced) {
      data.fluxOptions = {
        steps,
        guidance,
        ...(seed !== '' && { seed: Number(seed) })
      }
    }

    onSubmit(data)
  }

  return (
    <form className="beam-search-form" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="prompt">Prompt</label>
        <input
          id="prompt"
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your image prompt..."
        />
        {error && <div role="alert">{error}</div>}
      </div>

      <div>
        <label htmlFor="n">Initial Candidates (N)</label>
        <input
          id="n"
          type="number"
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          min="1"
        />
      </div>

      <div>
        <label htmlFor="m">Keep Top (M)</label>
        <input
          id="m"
          type="number"
          value={m}
          onChange={(e) => setM(Number(e.target.value))}
          min="1"
        />
      </div>

      <div>
        <label htmlFor="iterations">Iterations</label>
        <input
          id="iterations"
          type="number"
          value={iterations}
          onChange={(e) => setIterations(Number(e.target.value))}
          min="1"
        />
      </div>

      <div>
        <label htmlFor="alpha">Alpha</label>
        <input
          id="alpha"
          type="number"
          value={alpha}
          onChange={(e) => setAlpha(Number(e.target.value))}
          step="0.1"
          min="0"
          max="1"
        />
      </div>

      {/* Collapsible Advanced Settings Section */}
      <div className="advanced-settings">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
        >
          Advanced Settings {showAdvanced ? '▼' : '▶'}
        </button>

        {showAdvanced && (
          <div className="advanced-settings-content">
            <StepsSettings value={steps} onChange={setSteps} helpLevel="detailed" />

            <GuidanceSettings value={guidance} onChange={setGuidance} helpLevel="detailed" />

            <div className="seed-settings">
              <label htmlFor="seed">Seed (optional)</label>
              <input
                id="seed"
                type="number"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="Leave empty for random"
              />
              <p className="help-text">
                Leave empty for random results, or enter a number for reproducible generation.
              </p>
            </div>
          </div>
        )}
      </div>

      <button type="submit">Start Beam Search</button>
    </form>
  )
}
