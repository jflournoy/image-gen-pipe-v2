/**
 * @file useWebSocket Hook
 * React hook for WebSocket connection and message handling
 */

import { useState, useEffect, useRef, useCallback } from 'react'

export default function useWebSocket(url) {
  const [isConnected, setIsConnected] = useState(false)
  const [messages, setMessages] = useState([])
  const [error, setError] = useState(null)
  const wsRef = useRef(null)

  useEffect(() => {
    // Create WebSocket connection
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setError(null)
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        setMessages((prev) => [...prev, message])
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }

    ws.onerror = (event) => {
      setError(event.message || 'WebSocket error occurred')
    }

    ws.onclose = () => {
      setIsConnected(false)
    }

    // Cleanup on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }
  }, [url])

  const subscribe = useCallback((jobId) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message = {
        type: 'subscribe',
        jobId
      }
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const getMessagesByType = useCallback((type) => {
    return messages.filter(msg => msg.type === type)
  }, [messages])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return {
    ws: wsRef.current,
    isConnected,
    messages,
    error,
    subscribe,
    getMessagesByType,
    clearMessages
  }
}
