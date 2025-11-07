/**
 * @file ProgressVisualization Component Tests (TDD RED)
 * Tests for progress visualization during beam search
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressVisualization from './ProgressVisualization';

describe('🔴 RED: ProgressVisualization Component', () => {
  describe('Basic rendering', () => {
    it('should render nothing when no job is active', () => {
      const { container } = render(<ProgressVisualization />);
      expect(container.firstChild).toBeNull();
    });

    it('should display job ID when job is started', () => {
      render(<ProgressVisualization jobId="test-job-123" status="running" />);

      expect(screen.getByText(/job: test-job-123/i)).toBeInTheDocument();
    });

    it('should display current status', () => {
      render(<ProgressVisualization jobId="test-job-123" status="running" />);

      expect(screen.getByText(/status: running/i)).toBeInTheDocument();
    });
  });

  describe('Progress display', () => {
    it('should show iteration progress', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          currentIteration={1}
          totalIterations={3}
        />
      );

      expect(screen.getByText(/iteration 1 of 3/i)).toBeInTheDocument();
    });

    it('should calculate and display progress percentage', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          currentIteration={1}
          totalIterations={4}
        />
      );

      // 1/4 = 25%
      expect(screen.getByText(/25%/)).toBeInTheDocument();
    });

    it('should display progress bar with correct width', () => {
      const { container } = render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          currentIteration={2}
          totalIterations={4}
        />
      );

      const progressBar = container.querySelector('.progress-bar-fill');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveStyle({ width: '50%' });
    });
  });

  describe('Candidate processing display', () => {
    it('should show candidate count when provided', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          currentIteration={1}
          totalIterations={2}
          candidatesProcessed={3}
          totalCandidates={4}
        />
      );

      expect(screen.getByText(/candidates: 3 \/ 4/i)).toBeInTheDocument();
    });

    it('should display best score when available', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          currentIteration={1}
          totalIterations={2}
          bestScore={85.5}
        />
      );

      expect(screen.getByText(/best score: 85\.5/i)).toBeInTheDocument();
    });
  });

  describe('Status variants', () => {
    it('should display completed status with success styling', () => {
      const { container } = render(
        <ProgressVisualization
          jobId="test-job-123"
          status="completed"
          currentIteration={2}
          totalIterations={2}
        />
      );

      expect(screen.getByText(/status: completed/i)).toBeInTheDocument();
      expect(container.querySelector('.progress-visualization.completed')).toBeInTheDocument();
    });

    it('should display error status with error styling', () => {
      const { container } = render(
        <ProgressVisualization
          jobId="test-job-123"
          status="error"
          error="Failed to generate images"
        />
      );

      expect(screen.getByText(/status: error/i)).toBeInTheDocument();
      expect(screen.getByText(/failed to generate images/i)).toBeInTheDocument();
      expect(container.querySelector('.progress-visualization.error')).toBeInTheDocument();
    });

    it('should show 100% progress when completed', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="completed"
          currentIteration={3}
          totalIterations={3}
        />
      );

      expect(screen.getByText(/100%/)).toBeInTheDocument();
    });
  });

  describe('Timestamp display', () => {
    it('should display elapsed time when provided', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          elapsedTime={45000} // 45 seconds in ms
        />
      );

      expect(screen.getByText(/elapsed: 45s/i)).toBeInTheDocument();
    });

    it('should format elapsed time in minutes and seconds', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          elapsedTime={125000} // 2 minutes 5 seconds in ms
        />
      );

      expect(screen.getByText(/elapsed: 2m 5s/i)).toBeInTheDocument();
    });
  });

  describe('Animation states', () => {
    it('should show loading animation when running', () => {
      const { container } = render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
        />
      );

      expect(container.querySelector('.progress-bar-fill.animated')).toBeInTheDocument();
    });

    it('should not show loading animation when completed', () => {
      const { container } = render(
        <ProgressVisualization
          jobId="test-job-123"
          status="completed"
        />
      );

      expect(container.querySelector('.progress-bar-fill.animated')).not.toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle zero iterations gracefully', () => {
      render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          currentIteration={0}
          totalIterations={0}
        />
      );

      expect(screen.getByText(/0%/)).toBeInTheDocument();
    });

    it('should cap progress at 100% if calculations exceed', () => {
      const { container } = render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
          currentIteration={5}
          totalIterations={3}
        />
      );

      const progressBar = container.querySelector('.progress-bar-fill');
      expect(progressBar).toHaveStyle({ width: '100%' });
    });

    it('should handle missing optional props', () => {
      const { container } = render(
        <ProgressVisualization
          jobId="test-job-123"
          status="running"
        />
      );

      expect(container.firstChild).toBeInTheDocument();
      // Should not crash, should render basic info
    });
  });
});
