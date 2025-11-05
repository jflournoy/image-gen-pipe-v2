/**
 * @file App Component Tests (TDD RED → GREEN)
 * Integration tests for the main App component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

// Mock the useWebSocket hook
vi.mock('./hooks/useWebSocket', () => ({
  default: vi.fn(() => ({
    isConnected: false,
    messages: [],
    error: null,
    subscribe: vi.fn(),
    getMessagesByType: vi.fn(() => []),
    clearMessages: vi.fn(),
    ws: null
  }))
}))

// Mock fetch globally
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ jobId: 'test-job-123', status: 'started' })
  })
)

describe('🔴 RED: App Component Integration', () => {
  it('should render the BeamSearchForm', () => {
    render(<App />)

    // Check that the form is rendered
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start beam search/i })).toBeInTheDocument()
  })

  it('should display WebSocket connection status', () => {
    render(<App />)

    // Check for connection status indicator
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument()
  })

  it('should connect to WebSocket on mount', async () => {
    const mockUseWebSocket = await import('./hooks/useWebSocket')

    // Update mock to show connected state
    mockUseWebSocket.default.mockReturnValue({
      isConnected: true,
      messages: [],
      error: null,
      subscribe: vi.fn(),
      getMessagesByType: vi.fn(() => []),
      clearMessages: vi.fn(),
      ws: {}
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument()
    })
  })

  it('should call subscribe when form is submitted', async () => {
    const mockSubscribe = vi.fn()
    const mockUseWebSocket = await import('./hooks/useWebSocket')

    mockUseWebSocket.default.mockReturnValue({
      isConnected: true,
      messages: [],
      error: null,
      subscribe: mockSubscribe,
      getMessagesByType: vi.fn(() => []),
      clearMessages: vi.fn(),
      ws: {}
    })

    const user = userEvent.setup()
    render(<App />)

    // Fill in the form
    const promptInput = screen.getByLabelText(/prompt/i)
    await user.type(promptInput, 'a beautiful sunset')

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /start beam search/i })
    await user.click(submitButton)

    // Should subscribe to job updates
    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled()
    })
  })

  it('should show "Job started" message after form submission', async () => {
    const mockUseWebSocket = await import('./hooks/useWebSocket')

    mockUseWebSocket.default.mockReturnValue({
      isConnected: true,
      messages: [],
      error: null,
      subscribe: vi.fn(),
      getMessagesByType: vi.fn(() => []),
      clearMessages: vi.fn(),
      ws: {}
    })

    const user = userEvent.setup()
    render(<App />)

    // Fill and submit form
    await user.type(screen.getByLabelText(/prompt/i), 'test prompt')
    await user.click(screen.getByRole('button', { name: /start beam search/i }))

    // Should show job started message
    await waitFor(() => {
      expect(screen.getByText(/job started/i)).toBeInTheDocument()
    })
  })

  it('should display progress messages', async () => {
    const mockUseWebSocket = await import('./hooks/useWebSocket')

    const progressMessages = [
      { type: 'progress', iteration: 1, progress: 33 },
      { type: 'progress', iteration: 2, progress: 66 }
    ]

    mockUseWebSocket.default.mockReturnValue({
      isConnected: true,
      messages: progressMessages,
      error: null,
      subscribe: vi.fn(),
      getMessagesByType: vi.fn((type) =>
        type === 'progress' ? progressMessages : []
      ),
      clearMessages: vi.fn(),
      ws: {}
    })

    const user = userEvent.setup()
    render(<App />)

    // Submit form to create a job
    await user.type(screen.getByLabelText(/prompt/i), 'test prompt')
    await user.click(screen.getByRole('button', { name: /start beam search/i }))

    // Should display progress updates
    await waitFor(() => {
      expect(screen.getByText(/iteration 1/i)).toBeInTheDocument()
      expect(screen.getByText(/iteration 2/i)).toBeInTheDocument()
    })
  })

  it('should show error message when WebSocket has error', async () => {
    const mockUseWebSocket = await import('./hooks/useWebSocket')

    mockUseWebSocket.default.mockReturnValue({
      isConnected: false,
      messages: [],
      error: 'Connection failed',
      subscribe: vi.fn(),
      getMessagesByType: vi.fn(() => []),
      clearMessages: vi.fn(),
      ws: null
    })

    render(<App />)

    expect(screen.getByText(/connection failed/i)).toBeInTheDocument()
  })
})
