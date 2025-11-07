/**
 * @file LoadingSkeleton Component Tests (TDD RED)
 * Tests for loading skeleton placeholders during image generation
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingSkeleton from './LoadingSkeleton';

describe('🔴 RED: LoadingSkeleton Component', () => {
  describe('Basic rendering', () => {
    it('should render a single skeleton by default', () => {
      const { container } = render(<LoadingSkeleton />);

      const skeletons = container.querySelectorAll('.loading-skeleton');
      expect(skeletons).toHaveLength(1);
    });

    it('should render multiple skeletons when count specified', () => {
      const { container } = render(<LoadingSkeleton count={3} />);

      const skeletons = container.querySelectorAll('.loading-skeleton');
      expect(skeletons).toHaveLength(3);
    });

    it('should have skeleton-container wrapper', () => {
      const { container } = render(<LoadingSkeleton count={2} />);

      expect(container.querySelector('.skeleton-container')).toBeInTheDocument();
    });
  });

  describe('Skeleton variants', () => {
    it('should render image skeleton by default', () => {
      const { container } = render(<LoadingSkeleton />);

      expect(container.querySelector('.skeleton-image')).toBeInTheDocument();
    });

    it('should render text skeleton when type="text"', () => {
      const { container } = render(<LoadingSkeleton type="text" />);

      expect(container.querySelector('.skeleton-text')).toBeInTheDocument();
    });

    it('should render card skeleton when type="card"', () => {
      const { container } = render(<LoadingSkeleton type="card" />);

      expect(container.querySelector('.skeleton-card')).toBeInTheDocument();
    });

    it('should render circle skeleton when type="circle"', () => {
      const { container } = render(<LoadingSkeleton type="circle" />);

      expect(container.querySelector('.skeleton-circle')).toBeInTheDocument();
    });
  });

  describe('Animation', () => {
    it('should have shimmer animation class', () => {
      const { container } = render(<LoadingSkeleton />);

      expect(container.querySelector('.skeleton-shimmer')).toBeInTheDocument();
    });

    it('should support disabling animation', () => {
      const { container } = render(<LoadingSkeleton animated={false} />);

      expect(container.querySelector('.skeleton-shimmer')).not.toBeInTheDocument();
    });
  });

  describe('Custom dimensions', () => {
    it('should accept custom width', () => {
      const { container } = render(<LoadingSkeleton width="200px" />);

      const skeleton = container.querySelector('.loading-skeleton');
      expect(skeleton).toHaveStyle({ width: '200px' });
    });

    it('should accept custom height', () => {
      const { container } = render(<LoadingSkeleton height="150px" />);

      const skeleton = container.querySelector('.loading-skeleton');
      expect(skeleton).toHaveStyle({ height: '150px' });
    });

    it('should accept custom border radius', () => {
      const { container } = render(<LoadingSkeleton borderRadius="8px" />);

      const skeleton = container.querySelector('.loading-skeleton');
      expect(skeleton).toHaveStyle({ borderRadius: '8px' });
    });
  });

  describe('Image card skeleton', () => {
    it('should render image placeholder when type="image-card"', () => {
      const { container } = render(<LoadingSkeleton type="image-card" />);

      expect(container.querySelector('.skeleton-image-card')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-image-placeholder')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-score-placeholder')).toBeInTheDocument();
    });

    it('should render multiple image cards with count', () => {
      const { container } = render(<LoadingSkeleton type="image-card" count={4} />);

      const imageCards = container.querySelectorAll('.skeleton-image-card');
      expect(imageCards).toHaveLength(4);
    });
  });

  describe('Accessibility', () => {
    it('should have aria-busy="true" for screen readers', () => {
      const { container } = render(<LoadingSkeleton />);

      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    });

    it('should have aria-label describing loading state', () => {
      render(<LoadingSkeleton />);

      expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
    });

    it('should support custom aria-label', () => {
      render(<LoadingSkeleton ariaLabel="Loading images" />);

      expect(screen.getByLabelText(/loading images/i)).toBeInTheDocument();
    });
  });

  describe('Loading text', () => {
    it('should display loading text when provided', () => {
      render(<LoadingSkeleton showText={true} />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should support custom loading text', () => {
      render(<LoadingSkeleton showText={true} loadingText="Generating images..." />);

      expect(screen.getByText(/generating images/i)).toBeInTheDocument();
    });

    it('should not show text by default', () => {
      render(<LoadingSkeleton />);

      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
  });

  describe('Pulse animation variant', () => {
    it('should support pulse animation instead of shimmer', () => {
      const { container } = render(<LoadingSkeleton animation="pulse" />);

      expect(container.querySelector('.skeleton-pulse')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-shimmer')).not.toBeInTheDocument();
    });

    it('should default to shimmer animation', () => {
      const { container } = render(<LoadingSkeleton />);

      expect(container.querySelector('.skeleton-shimmer')).toBeInTheDocument();
    });
  });

  describe('Grid layout', () => {
    it('should render skeletons in grid layout when showGrid=true', () => {
      const { container } = render(<LoadingSkeleton count={4} showGrid={true} />);

      expect(container.querySelector('.skeleton-grid')).toBeInTheDocument();
    });

    it('should support custom grid columns', () => {
      const { container } = render(<LoadingSkeleton count={6} showGrid={true} gridColumns={3} />);

      const grid = container.querySelector('.skeleton-grid');
      expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(3, 1fr)' });
    });

    it('should default to 2 columns in grid', () => {
      const { container } = render(<LoadingSkeleton count={4} showGrid={true} />);

      const grid = container.querySelector('.skeleton-grid');
      expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(2, 1fr)' });
    });
  });

  describe('Progress indicator', () => {
    it('should show progress when progress prop provided', () => {
      render(<LoadingSkeleton showProgress={true} progress={50} />);

      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });

    it('should display progress bar when showProgress=true', () => {
      const { container } = render(<LoadingSkeleton showProgress={true} progress={75} />);

      const progressBar = container.querySelector('.skeleton-progress-bar');
      expect(progressBar).toBeInTheDocument();
    });

    it('should update progress bar width based on progress value', () => {
      const { container } = render(<LoadingSkeleton showProgress={true} progress={60} />);

      const progressFill = container.querySelector('.skeleton-progress-fill');
      expect(progressFill).toHaveStyle({ width: '60%' });
    });
  });
});
