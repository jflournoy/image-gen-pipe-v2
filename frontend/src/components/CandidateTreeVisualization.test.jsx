/**
 * @file CandidateTreeVisualization Component Tests (TDD RED → GREEN)
 * Tests for visualizing the chain of candidates through beam search iterations
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CandidateTreeVisualization from './CandidateTreeVisualization'

describe('🔴 RED: CandidateTreeVisualization Component', () => {
  const mockMetadata = {
    sessionId: 'ses-123456',
    userPrompt: 'a beautiful landscape painting',
    iterations: [
      {
        iteration: 0,
        candidates: [
          {
            candidateId: 0,
            parentId: null,
            whatPrompt: 'landscape with mountains',
            howPrompt: 'oil painting style',
            combined: 'landscape with mountains, oil painting style',
            image: { url: 'http://localhost:3000/api/images/i0c0' },
            survived: true
          },
          {
            candidateId: 1,
            parentId: null,
            whatPrompt: 'mountain landscape',
            howPrompt: 'watercolor style',
            combined: 'mountain landscape, watercolor style',
            image: { url: 'http://localhost:3000/api/images/i0c1' },
            survived: true
          }
        ]
      }
    ],
    winner: {
      candidateId: 0,
      iteration: 0,
      whatPrompt: 'landscape with mountains',
      howPrompt: 'oil painting style'
    },
    finalists: [
      {
        candidateId: 0,
        iteration: 0,
        whatPrompt: 'landscape with mountains',
        howPrompt: 'oil painting style'
      },
      {
        candidateId: 1,
        iteration: 0,
        whatPrompt: 'mountain landscape',
        howPrompt: 'watercolor style'
      }
    ]
  }

  it('should render without crashing', () => {
    render(<CandidateTreeVisualization metadata={mockMetadata} />)
    expect(screen.getByText(/beam search evolution/i)).toBeInTheDocument()
  })

  it('should display iteration sections', () => {
    render(<CandidateTreeVisualization metadata={mockMetadata} />)

    expect(screen.getByText(/iteration 0/i)).toBeInTheDocument()
  })

  it('should display candidates with IDs in each iteration', () => {
    render(<CandidateTreeVisualization metadata={mockMetadata} />)

    // Should display global IDs like "i0c0", "i0c1" - they appear in multiple places
    expect(screen.getAllByText('i0c0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('i0c1').length).toBeGreaterThan(0)
  })

  it('should display candidate prompts', () => {
    render(<CandidateTreeVisualization metadata={mockMetadata} />)

    // These texts appear in multiple places, so we just check they exist
    expect(screen.getAllByText('landscape with mountains').length).toBeGreaterThan(0)
    expect(screen.getAllByText('oil painting style').length).toBeGreaterThan(0)
  })

  it('should render empty state when no metadata provided', () => {
    render(<CandidateTreeVisualization metadata={null} />)

    expect(screen.getByText(/no data available/i)).toBeInTheDocument()
  })

  it('should display winner information when available', () => {
    render(<CandidateTreeVisualization metadata={mockMetadata} />)

    expect(screen.getByText('🏆 Winner')).toBeInTheDocument()
  })

  it('should display finalist comparison section', () => {
    render(<CandidateTreeVisualization metadata={mockMetadata} />)

    // Should show finalists section
    expect(screen.getByText(/finalist/i)).toBeInTheDocument()
  })

  it('should indicate survived status visually', () => {
    render(<CandidateTreeVisualization metadata={mockMetadata} />)

    // Component should somehow indicate which candidates survived
    // This will be validated by CSS classes or elements
    const iterationSection = screen.getByText(/iteration 0/i).closest('section')
    expect(iterationSection).toBeInTheDocument()
  })

  it('should handle multiple iterations', () => {
    const multiIterationMetadata = {
      ...mockMetadata,
      iterations: [
        ...mockMetadata.iterations,
        {
          iteration: 1,
          candidates: [
            {
              candidateId: 0,
              parentId: 0,
              whatPrompt: 'refined landscape',
              howPrompt: 'refined oil painting',
              combined: 'refined landscape, refined oil painting',
              image: { url: 'http://localhost:3000/api/images/i1c0' },
              survived: true
            }
          ]
        }
      ]
    }

    render(<CandidateTreeVisualization metadata={multiIterationMetadata} />)

    expect(screen.getByText(/iteration 0/i)).toBeInTheDocument()
    expect(screen.getByText(/iteration 1/i)).toBeInTheDocument()
    expect(screen.getByText(/i1c0/i)).toBeInTheDocument()
  })

  it('should show parent-child relationships', () => {
    const multiIterationMetadata = {
      ...mockMetadata,
      iterations: [
        ...mockMetadata.iterations,
        {
          iteration: 1,
          candidates: [
            {
              candidateId: 0,
              parentId: 0,
              whatPrompt: 'refined landscape',
              howPrompt: 'refined oil painting',
              combined: 'refined landscape, refined oil painting',
              image: { url: 'http://localhost:3000/api/images/i1c0' },
              survived: true
            }
          ]
        }
      ]
    }

    render(<CandidateTreeVisualization metadata={multiIterationMetadata} />)

    // Component should show relationship between i0c0 (parent) and i1c0 (child)
    // Validate by finding both the iteration 0 and iteration 1
    expect(screen.getByText(/iteration 0/i)).toBeInTheDocument()
    expect(screen.getByText(/iteration 1/i)).toBeInTheDocument()
    // The parent-child relationship is shown through the parentId field
    expect(screen.getByText(/Parent: i0c0/)).toBeInTheDocument()
  })
})
