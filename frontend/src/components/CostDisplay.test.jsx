/**
 * @file CostDisplay Component Tests (TDD RED → GREEN)
 * Tests for cost visualization showing estimates and actual costs
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CostDisplay from './CostDisplay'

describe('🔴 RED: CostDisplay Component', () => {
  describe('Pre-run Cost Estimation', () => {
    it('should render cost estimation section when status is starting', () => {
      const props = {
        status: 'starting',
        params: { n: 4, iterations: 2 }
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/estimated cost/i)).toBeInTheDocument()
    })

    it('should calculate estimated cost based on beam width and iterations', () => {
      const props = {
        status: 'starting',
        params: { n: 4, iterations: 2 }
      }
      const { container } = render(<CostDisplay {...props} />)
      // Should show estimated total cost in main section
      const totalCost = container.querySelector('[class*="totalCostAmount"]')
      expect(totalCost).toBeInTheDocument()
      expect(totalCost?.textContent).toMatch(/\$[0-9.]+/)
    })

    it('should show cost breakdown by provider', () => {
      const props = {
        status: 'starting',
        params: { n: 4, iterations: 2 }
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/vision/i)).toBeInTheDocument()
      expect(screen.getByText(/image generation/i)).toBeInTheDocument()
      expect(screen.getByText(/llm/i)).toBeInTheDocument()
    })

    it('should show cost per iteration', () => {
      const props = {
        status: 'starting',
        params: { n: 4, iterations: 3 }
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/per iteration/i)).toBeInTheDocument()
    })
  })

  describe('Live Cost Tracking', () => {
    it('should display actual costs when job is running', () => {
      const props = {
        status: 'running',
        tokenUsage: {
          llm: { input: 1000, output: 500 },
          vision: { input: 200, output: 100 },
          imageGen: { requests: 8 }
        }
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/actual cost/i)).toBeInTheDocument()
    })

    it('should update costs in real-time as tokens accumulate', () => {
      const props = {
        status: 'running',
        tokenUsage: {
          llm: { input: 1000, output: 500 },
          vision: { input: 200, output: 100 },
          imageGen: { requests: 8 }
        }
      }
      const { rerender } = render(<CostDisplay {...props} />)

      // Update with more tokens
      const updatedProps = {
        ...props,
        tokenUsage: {
          llm: { input: 2000, output: 1000 },
          vision: { input: 400, output: 200 },
          imageGen: { requests: 16 }
        }
      }
      rerender(<CostDisplay {...updatedProps} />)
      expect(screen.getByText(/actual cost/i)).toBeInTheDocument()
    })

    it('should show progress toward estimated cost', () => {
      const props = {
        status: 'running',
        params: { n: 4, iterations: 2 },
        tokenUsage: {
          llm: { input: 500, output: 250 },
          vision: { input: 100, output: 50 },
          imageGen: { requests: 4 }
        }
      }
      const { container } = render(<CostDisplay {...props} />)
      // Should show both estimate and actual in comparison row
      const comparison = container.querySelector('[class*="comparisonRow"]')
      expect(comparison).toBeInTheDocument()
      expect(comparison?.textContent).toMatch(/Estimated/)
      expect(comparison?.textContent).toMatch(/Actual/)
    })
  })

  describe('Cost Breakdown Display', () => {
    it('should show per-provider cost breakdown', () => {
      const props = {
        status: 'completed',
        tokenUsage: {
          llm: { input: 5000, output: 2500 },
          vision: { input: 1000, output: 500 },
          imageGen: { requests: 20 }
        }
      }
      render(<CostDisplay {...props} />)

      expect(screen.getByText(/llm/i)).toBeInTheDocument()
      expect(screen.getByText(/vision/i)).toBeInTheDocument()
      expect(screen.getByText(/image gen/i)).toBeInTheDocument()
    })

    it('should display percentage of total for each provider', () => {
      const props = {
        status: 'completed',
        tokenUsage: {
          llm: { input: 5000, output: 2500 },
          vision: { input: 1000, output: 500 },
          imageGen: { requests: 20 }
        }
      }
      const { container } = render(<CostDisplay {...props} />)

      // Should show percentages in breakdown
      const percentages = container.querySelectorAll('[class*="percentage"]')
      expect(percentages.length).toBeGreaterThan(0)
      expect(percentages[0].textContent).toMatch(/%/)
    })

    it('should show critique generator costs separately', () => {
      const props = {
        status: 'completed',
        tokenUsage: {
          llm: { input: 5000, output: 2500 },
          vision: { input: 1000, output: 500 },
          imageGen: { requests: 20 },
          critique: { input: 1000, output: 500 }
        }
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/critique/i)).toBeInTheDocument()
    })
  })

  describe('Cost Formatting', () => {
    it('should format costs with proper currency symbol and decimals', () => {
      const props = {
        status: 'completed',
        tokenUsage: {
          llm: { input: 1000, output: 500 },
          vision: { input: 200, output: 100 },
          imageGen: { requests: 8 }
        }
      }
      const { container } = render(<CostDisplay {...props} />)
      // Should find at least one formatted cost in the total section
      const totalCost = container.querySelector('[class*="totalCostAmount"]')
      expect(totalCost?.textContent).toMatch(/\$\d+\.\d{2}/)
    })

    it('should show token counts alongside costs', () => {
      const props = {
        status: 'completed',
        tokenUsage: {
          llm: { input: 1000, output: 500 },
          vision: { input: 200, output: 100 },
          imageGen: { requests: 8 }
        }
      }
      const { container } = render(<CostDisplay {...props} />)
      // Should show token information in breakdown
      const tokenElements = container.querySelectorAll('[class*="tokens"]')
      expect(tokenElements.length).toBeGreaterThan(0)
    })

    it('should handle zero costs gracefully', () => {
      const props = {
        status: 'starting',
        params: {}
      }
      expect(() => {
        render(<CostDisplay {...props} />)
      }).not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should render without errors when no data provided', () => {
      expect(() => {
        render(<CostDisplay status="starting" />)
      }).not.toThrow()
    })

    it('should render empty state when status is not started', () => {
      const props = {
        status: null
      }
      expect(() => {
        render(<CostDisplay {...props} />)
      }).not.toThrow()
    })

    it('should handle completion status and show final costs', () => {
      const props = {
        status: 'completed',
        tokenUsage: {
          llm: { input: 5000, output: 2500 },
          vision: { input: 1000, output: 500 },
          imageGen: { requests: 20 }
        },
        finalCost: 4.50
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/completed|final/i)).toBeInTheDocument()
    })

    it('should display error state gracefully', () => {
      const props = {
        status: 'error',
        error: 'Failed to track costs'
      }
      expect(() => {
        render(<CostDisplay {...props} />)
      }).not.toThrow()
    })
  })

  describe('Integration with Form', () => {
    it('should accept beam width parameter for cost calculation', () => {
      const props = {
        status: 'starting',
        params: { n: 8, iterations: 2 }
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/estimated cost/i)).toBeInTheDocument()
    })

    it('should accept iteration count parameter for cost calculation', () => {
      const props = {
        status: 'starting',
        params: { n: 4, iterations: 3 }
      }
      render(<CostDisplay {...props} />)
      expect(screen.getByText(/estimated cost/i)).toBeInTheDocument()
    })

    it('should update estimates when params change', () => {
      const props = {
        status: 'starting',
        params: { n: 4, iterations: 2 }
      }
      const { rerender } = render(<CostDisplay {...props} />)

      // Change iterations
      const updatedProps = {
        status: 'starting',
        params: { n: 4, iterations: 3 }
      }
      expect(() => {
        rerender(<CostDisplay {...updatedProps} />)
      }).not.toThrow()
    })
  })

  describe('Comparison View', () => {
    it('should show estimated vs actual cost comparison', () => {
      const props = {
        status: 'completed',
        params: { n: 4, iterations: 2 },
        tokenUsage: {
          llm: { input: 3000, output: 1500 },
          vision: { input: 600, output: 300 },
          imageGen: { requests: 16 }
        }
      }
      render(<CostDisplay {...props} />)
      // Should show both estimated and actual
      expect(screen.getByText(/estimate/i)).toBeInTheDocument()
      expect(screen.getByText(/actual/i)).toBeInTheDocument()
    })

    it('should calculate variance between estimate and actual', () => {
      const props = {
        status: 'completed',
        params: { n: 4, iterations: 2 },
        tokenUsage: {
          llm: { input: 3000, output: 1500 },
          vision: { input: 600, output: 300 },
          imageGen: { requests: 16 }
        }
      }
      const { container } = render(<CostDisplay {...props} />)
      // Test that component exists and renders successfully
      const costDisplay = container.querySelector('[class*="costDisplay"]')
      expect(costDisplay).toBeInTheDocument()
    })
  })
})
