/**
 * @file BeamSearchForm Component Tests (TDD RED → GREEN)
 * Tests for the beam search parameter input form
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BeamSearchForm from './BeamSearchForm'

describe('🔴 RED: BeamSearchForm Component', () => {
  it('should render all required input fields', () => {
    render(<BeamSearchForm />)

    // Assert: Check for all required fields
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/initial candidates.*n/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/keep top.*m/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/iterations/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/alpha/i)).toBeInTheDocument()
  })

  it('should have a submit button', () => {
    render(<BeamSearchForm />)

    const submitButton = screen.getByRole('button', { name: /start beam search/i })
    expect(submitButton).toBeInTheDocument()
  })

  it('should have default values for parameters', () => {
    render(<BeamSearchForm />)

    expect(screen.getByLabelText(/initial candidates.*n/i)).toHaveValue(4)
    expect(screen.getByLabelText(/keep top.*m/i)).toHaveValue(2)
    expect(screen.getByLabelText(/iterations/i)).toHaveValue(3)
    expect(screen.getByLabelText(/alpha/i)).toHaveValue(0.7)
  })

  it('should call onSubmit with form data when submitted', async () => {
    const handleSubmit = vi.fn()
    const user = userEvent.setup()

    render(<BeamSearchForm onSubmit={handleSubmit} />)

    // Fill in the prompt
    const promptInput = screen.getByLabelText(/prompt/i)
    await user.type(promptInput, 'a serene mountain landscape')

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /start beam search/i })
    await user.click(submitButton)

    // Assert: onSubmit called with correct data
    expect(handleSubmit).toHaveBeenCalledWith({
      prompt: 'a serene mountain landscape',
      n: 4,
      m: 2,
      iterations: 3,
      alpha: 0.7
    })
  })

  it('should validate that prompt is required', async () => {
    const handleSubmit = vi.fn()
    const user = userEvent.setup()

    render(<BeamSearchForm onSubmit={handleSubmit} />)

    // Try to submit without entering a prompt
    const submitButton = screen.getByRole('button', { name: /start beam search/i })
    await user.click(submitButton)

    // Assert: onSubmit should not be called
    expect(handleSubmit).not.toHaveBeenCalled()

    // Assert: Error message should be displayed
    expect(screen.getByText(/prompt is required/i)).toBeInTheDocument()
  })

  it('should allow updating parameter values', async () => {
    const handleSubmit = vi.fn()
    const user = userEvent.setup()

    render(<BeamSearchForm onSubmit={handleSubmit} />)

    // Update N value
    const nInput = screen.getByLabelText(/initial candidates.*n/i)
    await user.clear(nInput)
    await user.type(nInput, '8')

    // Update M value
    const mInput = screen.getByLabelText(/keep top.*m/i)
    await user.clear(mInput)
    await user.type(mInput, '4')

    // Fill prompt and submit
    await user.type(screen.getByLabelText(/prompt/i), 'test prompt')
    await user.click(screen.getByRole('button', { name: /start beam search/i }))

    // Assert: Updated values are submitted
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        n: 8,
        m: 4
      })
    )
  })
})

describe('🔴 RED: BeamSearchForm - Flux Generation Settings', () => {
  it('should have a collapsible Advanced Settings section', () => {
    render(<BeamSearchForm />)

    // Should have an expandable section for advanced settings
    const advancedToggle = screen.getByRole('button', { name: /advanced settings/i })
    expect(advancedToggle).toBeInTheDocument()
  })

  it('should render Flux settings inputs when expanded', async () => {
    const user = userEvent.setup()
    render(<BeamSearchForm />)

    // Expand advanced settings
    const advancedToggle = screen.getByRole('button', { name: /advanced settings/i })
    await user.click(advancedToggle)

    // Should have Flux-specific inputs
    expect(screen.getByLabelText(/steps/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/guidance/i)).toBeInTheDocument()
  })

  it('should have default values for Flux settings', async () => {
    const user = userEvent.setup()
    render(<BeamSearchForm />)

    // Expand advanced settings
    await user.click(screen.getByRole('button', { name: /advanced settings/i }))

    // Default values should match Flux service defaults
    expect(screen.getByLabelText(/steps/i)).toHaveValue(25)
    expect(screen.getByLabelText(/guidance/i)).toHaveValue(3.5)
  })

  it('should include fluxOptions in submit data when modified', async () => {
    const handleSubmit = vi.fn()
    const user = userEvent.setup()

    render(<BeamSearchForm onSubmit={handleSubmit} />)

    // Fill prompt
    await user.type(screen.getByLabelText(/prompt/i), 'test prompt')

    // Expand advanced settings and modify Flux options
    await user.click(screen.getByRole('button', { name: /advanced settings/i }))

    const stepsInput = screen.getByLabelText(/steps/i)
    await user.clear(stepsInput)
    await user.type(stepsInput, '35')

    const guidanceInput = screen.getByLabelText(/guidance/i)
    await user.clear(guidanceInput)
    await user.type(guidanceInput, '4.5')

    // Submit form
    await user.click(screen.getByRole('button', { name: /start beam search/i }))

    // Assert: fluxOptions should be included in submit data
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'test prompt',
        fluxOptions: expect.objectContaining({
          steps: 35,
          guidance: 4.5
        })
      })
    )
  })

  it('should have optional seed input for reproducibility', async () => {
    const handleSubmit = vi.fn()
    const user = userEvent.setup()

    render(<BeamSearchForm onSubmit={handleSubmit} />)

    // Fill prompt
    await user.type(screen.getByLabelText(/prompt/i), 'test prompt')

    // Expand advanced settings
    await user.click(screen.getByRole('button', { name: /advanced settings/i }))

    // Should have seed input (optional, empty by default)
    const seedInput = screen.getByLabelText(/seed/i)
    expect(seedInput).toBeInTheDocument()
    expect(seedInput).toHaveValue(null) // Empty number input

    // Set a seed value
    await user.type(seedInput, '42')

    // Submit form
    await user.click(screen.getByRole('button', { name: /start beam search/i }))

    // Assert: seed should be included in fluxOptions
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        fluxOptions: expect.objectContaining({
          seed: 42
        })
      })
    )
  })

  it('should validate steps is within range (15-50)', async () => {
    const user = userEvent.setup()
    render(<BeamSearchForm />)

    // Expand advanced settings
    await user.click(screen.getByRole('button', { name: /advanced settings/i }))

    const stepsInput = screen.getByLabelText(/steps/i)

    // Check min/max attributes
    expect(stepsInput).toHaveAttribute('min', '15')
    expect(stepsInput).toHaveAttribute('max', '50')
  })

  it('should validate guidance is within range (1.0-20.0)', async () => {
    const user = userEvent.setup()
    render(<BeamSearchForm />)

    // Expand advanced settings
    await user.click(screen.getByRole('button', { name: /advanced settings/i }))

    const guidanceInput = screen.getByLabelText(/guidance/i)

    // Check min/max attributes
    expect(guidanceInput).toHaveAttribute('min', '1')
    expect(guidanceInput).toHaveAttribute('max', '20')
    expect(guidanceInput).toHaveAttribute('step', '0.5')
  })
})
