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
