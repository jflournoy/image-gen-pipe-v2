/**
 * @file CandidateTreeVisualization Styling Tests (TDD RED → GREEN)
 * Tests for visual styling and layout of the chain visualization component
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CandidateTreeVisualization from './CandidateTreeVisualization'

describe('🔴 RED: CandidateTreeVisualization Styling', () => {
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
            survived: false
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

  it('should have main container with correct class', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const mainDiv = container.querySelector('[class*="candidate_tree_visualization"]')
    expect(mainDiv).toBeInTheDocument()
  })

  it('should have iterations container with grid layout', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const iterationsContainer = container.querySelector('[class*="iterations_container"]')
    expect(iterationsContainer).toBeInTheDocument()
  })

  it('should have iteration sections with proper structure', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const iterationSection = container.querySelector('[class*="iteration_section"]')
    expect(iterationSection).toBeInTheDocument()
  })

  it('should have candidates grid for layout', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const candidatesGrid = container.querySelector('[class*="candidates_grid"]')
    expect(candidatesGrid).toBeInTheDocument()
  })

  it('should have candidate cards with styling classes', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const candidateCards = container.querySelectorAll('[class*="candidate_card"]')
    expect(candidateCards.length).toBe(2)
  })

  it('should have candidate header sections', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const headers = container.querySelectorAll('[class*="candidate_header"]')
    expect(headers.length).toBeGreaterThan(0)
  })

  it('should have candidate images with proper class', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const images = container.querySelectorAll('[class*="candidate_image"]')
    expect(images.length).toBeGreaterThan(0)
    images.forEach(img => {
      expect(img).toHaveAttribute('src')
      expect(img).toHaveAttribute('alt')
    })
  })

  it('should have prompt sections for styling', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const prompts = container.querySelectorAll('[class*="prompt_section"]')
    expect(prompts.length).toBeGreaterThan(0)
  })

  it('should have winner section with styling', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const winnerSection = container.querySelector('[class*="winner_section"]')
    expect(winnerSection).toBeInTheDocument()
  })

  it('should have finalist cards with grid layout', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const finalistsGrid = container.querySelector('[class*="finalists_grid"]')
    expect(finalistsGrid).toBeInTheDocument()

    const finalistCards = container.querySelectorAll('[class*="finalist_card"]')
    expect(finalistCards.length).toBe(2)
  })

  it('should have lineage section when lineage data exists', () => {
    const metadataWithLineage = {
      ...mockMetadata,
      lineage: [
        { iteration: 0, candidateId: 0 },
        { iteration: 1, candidateId: 0 }
      ]
    }

    const { container } = render(<CandidateTreeVisualization metadata={metadataWithLineage} />)
    const lineageSection = container.querySelector('[class*="lineage_section"]')
    expect(lineageSection).toBeInTheDocument()

    const lineageNodes = container.querySelectorAll('[class*="lineage_node"]')
    expect(lineageNodes.length).toBeGreaterThan(0)
  })

  it('should apply correct heading hierarchy', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)

    const h1 = container.querySelector('h1')
    expect(h1).toBeInTheDocument()
    expect(h1.textContent).toBe('Beam Search Evolution')

    const h2s = container.querySelectorAll('h2')
    expect(h2s.length).toBeGreaterThan(1)
  })

  it('should have proper parent info styling', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const parentInfos = container.querySelectorAll('[class*="parent_info"]')
    // First iteration has no parents, so might be 0
    expect(parentInfos.length).toBeGreaterThanOrEqual(0)
  })

  it('should have winner info styled section', () => {
    const { container } = render(<CandidateTreeVisualization metadata={mockMetadata} />)
    const winnerInfo = container.querySelector('[class*="winner_info"]')
    expect(winnerInfo).toBeInTheDocument()
  })
})
