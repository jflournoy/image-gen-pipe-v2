/**
 * @file ImageGallery Component Tests (TDD RED → GREEN)
 * Tests for displaying generated images from beam search
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ImageGallery from './ImageGallery'

describe('🔴 RED: ImageGallery Component', () => {
  it('should render empty state when no images provided', () => {
    render(<ImageGallery images={[]} />)

    expect(screen.getByText(/no images/i)).toBeInTheDocument()
  })

  it('should render image cards when images are provided', () => {
    const images = [
      { id: 'img1', url: 'http://localhost:3000/api/images/img1', score: 95 },
      { id: 'img2', url: 'http://localhost:3000/api/images/img2', score: 87 }
    ]

    render(<ImageGallery images={images} />)

    const imgElements = screen.getAllByRole('img')
    expect(imgElements).toHaveLength(2)
    expect(imgElements[0]).toHaveAttribute('src', images[0].url)
    expect(imgElements[1]).toHaveAttribute('src', images[1].url)
  })

  it('should display image scores', () => {
    const images = [
      { id: 'img1', url: 'http://localhost:3000/api/images/img1', score: 95.5 }
    ]

    render(<ImageGallery images={images} />)

    expect(screen.getByText(/95.5/)).toBeInTheDocument()
  })

  it('should display alt text for accessibility', () => {
    const images = [
      { id: 'img1', url: 'http://localhost:3000/api/images/img1', score: 95 }
    ]

    render(<ImageGallery images={images} />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('alt')
  })

  it('should sort images by score descending', () => {
    const images = [
      { id: 'img1', url: 'http://localhost:3000/api/images/img1', score: 80 },
      { id: 'img2', url: 'http://localhost:3000/api/images/img2', score: 95 },
      { id: 'img3', url: 'http://localhost:3000/api/images/img3', score: 87 }
    ]

    render(<ImageGallery images={images} />)

    const imgElements = screen.getAllByRole('img')
    // First image should be the highest scored (img2, score 95)
    expect(imgElements[0]).toHaveAttribute('src', images[1].url)
    // Second should be score 87 (img3)
    expect(imgElements[1]).toHaveAttribute('src', images[2].url)
    // Third should be score 80 (img1)
    expect(imgElements[2]).toHaveAttribute('src', images[0].url)
  })
})
