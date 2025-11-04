/**
 * @file BeamSearchForm Component
 * Form for submitting beam search parameters
 */

import { useState } from 'react'

export default function BeamSearchForm({ onSubmit }) {
  const [prompt, setPrompt] = useState('')
  const [n, setN] = useState(4)
  const [m, setM] = useState(2)
  const [iterations, setIterations] = useState(3)
  const [alpha, setAlpha] = useState(0.7)
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()

    // Validate prompt
    if (!prompt.trim()) {
      setError('Prompt is required')
      return
    }

    // Clear error and submit
    setError('')
    onSubmit({
      prompt,
      n,
      m,
      iterations,
      alpha
    })
  }

  return (
    <form onSubmit={handleSubmit}>
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

      <button type="submit">Start Beam Search</button>
    </form>
  )
}
