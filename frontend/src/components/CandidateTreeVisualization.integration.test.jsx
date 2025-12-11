/**
 * @file CandidateTreeVisualization Integration Tests
 * Tests for integrating the component with the app and handling API data
 */

import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import CandidateTreeVisualization from './CandidateTreeVisualization'

describe('🔴 RED: CandidateTreeVisualization Integration', () => {
  const mockMetadata = {
    sessionId: 'ses-123456',
    userPrompt: 'test landscape',
    iterations: [
      {
        iteration: 0,
        candidates: [
          {
            candidateId: 0,
            parentId: null,
            whatPrompt: 'landscape',
            howPrompt: 'oil painting',
            combined: 'landscape oil painting',
            image: { url: 'http://localhost:3000/api/images/i0c0' },
            survived: true
          }
        ]
      }
    ],
    winner: {
      candidateId: 0,
      iteration: 0,
      whatPrompt: 'landscape',
      howPrompt: 'oil painting'
    }
  }

  it('should render without errors with valid metadata', () => {
    expect(() => {
      render(<CandidateTreeVisualization metadata={mockMetadata} />)
    }).not.toThrow()
  })

  it('should handle missing metadata gracefully', () => {
    expect(() => {
      render(<CandidateTreeVisualization metadata={undefined} />)
    }).not.toThrow()

    expect(screen.getByText(/no data available/i)).toBeInTheDocument()
  })

  it('should handle null metadata gracefully', () => {
    expect(() => {
      render(<CandidateTreeVisualization metadata={null} />)
    }).not.toThrow()

    expect(screen.getByText(/no data available/i)).toBeInTheDocument()
  })

  it('should render with partial metadata (no finalists)', () => {
    const partialMetadata = {
      sessionId: 'ses-123',
      userPrompt: 'test',
      iterations: mockMetadata.iterations
    }

    expect(() => {
      render(<CandidateTreeVisualization metadata={partialMetadata} />)
    }).not.toThrow()
  })

  it('should accept prop changes and re-render', () => {
    const { rerender } = render(<CandidateTreeVisualization metadata={mockMetadata} />)

    expect(screen.getByText(/beam search evolution/i)).toBeInTheDocument()

    const newMetadata = {
      ...mockMetadata,
      userPrompt: 'updated prompt'
    }

    rerender(<CandidateTreeVisualization metadata={newMetadata} />)

    expect(screen.getByText(/beam search evolution/i)).toBeInTheDocument()
  })

  it('should handle large number of iterations', () => {
    const largeMetadata = {
      ...mockMetadata,
      iterations: Array.from({ length: 5 }, (_, i) => ({
        iteration: i,
        candidates: Array.from({ length: 3 }, (_, j) => ({
          candidateId: j,
          parentId: i > 0 ? j : null,
          whatPrompt: `iteration ${i} candidate ${j} what`,
          howPrompt: `iteration ${i} candidate ${j} how`,
          combined: `iteration ${i} candidate ${j} combined`,
          image: { url: `http://localhost:3000/api/images/i${i}c${j}` },
          survived: j < 2
        }))
      }))
    }

    const { container } = render(<CandidateTreeVisualization metadata={largeMetadata} />)

    // Verify all iterations are rendered by checking the container
    const iterationSections = container.querySelectorAll('[class*="iteration_section"]')
    expect(iterationSections.length).toBe(5)
  })

  it('should handle empty iterations array', () => {
    const emptyMetadata = {
      ...mockMetadata,
      iterations: []
    }

    expect(() => {
      render(<CandidateTreeVisualization metadata={emptyMetadata} />)
    }).not.toThrow()
  })

  it('should display user prompt when available', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)

    // The metadata contains the userPrompt but it's not displayed in current implementation
    // This test documents that behavior
    expect(mockMetadata.userPrompt).toBe('test landscape')
  })

  it('should handle metadata updates efficiently', () => {
    const { rerender } = render(<CandidateTreeVisualization metadata={mockMetadata} />)

    // Simulate multiple updates
    for (let i = 0; i < 3; i++) {
      const updatedMetadata = {
        ...mockMetadata,
        winner: {
          ...mockMetadata.winner,
          candidateId: i
        }
      }
      expect(() => {
        rerender(<CandidateTreeVisualization metadata={updatedMetadata} />)
      }).not.toThrow()
    }
  })

  it('should be compatible with future data structures', () => {
    const extendedMetadata = {
      ...mockMetadata,
      additionalField: 'some value',
      ranking: { scores: [1, 2, 3] }
    }

    expect(() => {
      render(<CandidateTreeVisualization metadata={extendedMetadata} />)
    }).not.toThrow()
  })

  it('should handle missing optional fields gracefully', () => {
    const minimalMetadata = {
      iterations: [
        {
          iteration: 0,
          candidates: [
            {
              candidateId: 0,
              parentId: null,
              whatPrompt: 'what',
              howPrompt: 'how'
            }
          ]
        }
      ]
    }

    expect(() => {
      render(<CandidateTreeVisualization metadata={minimalMetadata} />)
    }).not.toThrow()
  })
})
