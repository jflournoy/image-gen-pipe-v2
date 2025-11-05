/**
 * @file useWebSocket Hook Tests (TDD RED → GREEN)
 * Tests for the WebSocket client hook
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useWebSocket from './useWebSocket'

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null

    // Simulate connection after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onopen) this.onopen({ type: 'open' })
    }, 10)
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    // Store sent messages for testing
    this.lastSent = data
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) this.onclose({ type: 'close' })
  }

  // Simulate receiving a message
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }
}

MockWebSocket.CONNECTING = 0
MockWebSocket.OPEN = 1
MockWebSocket.CLOSING = 2
MockWebSocket.CLOSED = 3

describe('🔴 RED: useWebSocket Hook', () => {
  let originalWebSocket

  beforeEach(() => {
    originalWebSocket = global.WebSocket
    global.WebSocket = MockWebSocket
  })

  afterEach(() => {
    global.WebSocket = originalWebSocket
  })

  it('should connect to WebSocket server', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3000'))

    // Initially connecting
    expect(result.current.isConnected).toBe(false)

    // Wait for connection
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })
  })

  it('should subscribe to a job ID', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3000'))

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })

    // Subscribe to a job
    act(() => {
      result.current.subscribe('job-123')
    })

    // Check that subscription message was sent
    await waitFor(() => {
      const ws = result.current.ws
      expect(ws.lastSent).toBeDefined()
      const message = JSON.parse(ws.lastSent)
      expect(message).toEqual({
        type: 'subscribe',
        jobId: 'job-123'
      })
    })
  })

  it('should receive and store progress updates', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3000'))

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })

    // Subscribe to a job
    act(() => {
      result.current.subscribe('job-123')
    })

    // Simulate receiving a progress update
    const progressUpdate = {
      type: 'progress',
      iteration: 1,
      progress: 50
    }

    act(() => {
      result.current.ws.simulateMessage(progressUpdate)
    })

    // Check that the update was received
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0]).toEqual(progressUpdate)
    })
  })

  it('should filter messages by type', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3000'))

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })

    act(() => {
      result.current.subscribe('job-123')
    })

    // Send multiple message types
    act(() => {
      result.current.ws.simulateMessage({ type: 'subscribed', jobId: 'job-123' })
      result.current.ws.simulateMessage({ type: 'progress', iteration: 1 })
      result.current.ws.simulateMessage({ type: 'progress', iteration: 2 })
      result.current.ws.simulateMessage({ type: 'complete', result: {} })
    })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(4)
    })

    // Get only progress messages
    const progressMessages = result.current.getMessagesByType('progress')
    expect(progressMessages).toHaveLength(2)
    expect(progressMessages[0].iteration).toBe(1)
    expect(progressMessages[1].iteration).toBe(2)
  })

  it('should handle connection errors', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3000'))

    // Simulate an error
    act(() => {
      if (result.current.ws && result.current.ws.onerror) {
        result.current.ws.onerror({ type: 'error', message: 'Connection failed' })
      }
    })

    await waitFor(() => {
      expect(result.current.error).toBeDefined()
    })
  })

  it('should cleanup on unmount', async () => {
    const { result, unmount } = renderHook(() => useWebSocket('ws://localhost:3000'))

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })

    const closeSpy = vi.spyOn(result.current.ws, 'close')

    unmount()

    expect(closeSpy).toHaveBeenCalled()
  })

  it('should clear messages when requested', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3000'))

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })

    // Add some messages
    act(() => {
      result.current.ws.simulateMessage({ type: 'progress', iteration: 1 })
      result.current.ws.simulateMessage({ type: 'progress', iteration: 2 })
    })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    // Clear messages
    act(() => {
      result.current.clearMessages()
    })

    expect(result.current.messages).toHaveLength(0)
  })
})
