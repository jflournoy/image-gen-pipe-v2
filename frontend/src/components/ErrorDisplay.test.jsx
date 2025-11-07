/**
 * @file ErrorDisplay Component Tests (TDD RED)
 * Tests for enhanced error handling and display
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorDisplay from './ErrorDisplay';

describe('🔴 RED: ErrorDisplay Component', () => {
  describe('Basic rendering', () => {
    it('should render nothing when no error', () => {
      const { container } = render(<ErrorDisplay />);
      expect(container.firstChild).toBeNull();
    });

    it('should display error message when provided', () => {
      render(<ErrorDisplay error="Failed to connect to server" />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/failed to connect to server/i)).toBeInTheDocument();
    });

    it('should have error styling class', () => {
      const { container } = render(<ErrorDisplay error="Test error" />);

      expect(container.querySelector('.error-display')).toBeInTheDocument();
    });
  });

  describe('Error types', () => {
    it('should display network error with appropriate icon', () => {
      render(<ErrorDisplay error="Network error" type="network" />);

      expect(screen.getByText(/network error/i)).toBeInTheDocument();
      expect(screen.getByText(/🌐/)).toBeInTheDocument();
    });

    it('should display API error with appropriate icon', () => {
      render(<ErrorDisplay error="API request failed" type="api" />);

      expect(screen.getByText(/api request failed/i)).toBeInTheDocument();
      expect(screen.getByText(/⚠️/)).toBeInTheDocument();
    });

    it('should display WebSocket error with appropriate icon', () => {
      render(<ErrorDisplay error="WebSocket disconnected" type="websocket" />);

      expect(screen.getByText(/websocket disconnected/i)).toBeInTheDocument();
      expect(screen.getByText(/🔌/)).toBeInTheDocument();
    });

    it('should display generic error when type not specified', () => {
      render(<ErrorDisplay error="Something went wrong" />);

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      expect(screen.getByText(/❌/)).toBeInTheDocument();
    });
  });

  describe('Retry functionality', () => {
    it('should show retry button when onRetry provided', () => {
      const onRetry = vi.fn();
      render(<ErrorDisplay error="Test error" onRetry={onRetry} />);

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('should call onRetry when retry button clicked', () => {
      const onRetry = vi.fn();
      render(<ErrorDisplay error="Test error" onRetry={onRetry} />);

      const retryButton = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryButton);

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should not show retry button when onRetry not provided', () => {
      render(<ErrorDisplay error="Test error" />);

      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('should disable retry button when retrying', () => {
      const onRetry = vi.fn();
      render(<ErrorDisplay error="Test error" onRetry={onRetry} retrying={true} />);

      const retryButton = screen.getByRole('button', { name: /retrying/i });
      expect(retryButton).toBeDisabled();
    });

    it('should show loading state when retrying', () => {
      const onRetry = vi.fn();
      render(<ErrorDisplay error="Test error" onRetry={onRetry} retrying={true} />);

      expect(screen.getByText(/retrying/i)).toBeInTheDocument();
    });
  });

  describe('Dismissible errors', () => {
    it('should show dismiss button when dismissible', () => {
      const onDismiss = vi.fn();
      render(<ErrorDisplay error="Test error" onDismiss={onDismiss} />);

      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('should call onDismiss when dismiss button clicked', () => {
      const onDismiss = vi.fn();
      render(<ErrorDisplay error="Test error" onDismiss={onDismiss} />);

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      fireEvent.click(dismissButton);

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('should not show dismiss button when onDismiss not provided', () => {
      render(<ErrorDisplay error="Test error" />);

      expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });
  });

  describe('Error details', () => {
    it('should display error details when provided and expanded', () => {
      const details = 'Server returned status code 500';
      render(<ErrorDisplay error="Request failed" details={details} />);

      // Details should be hidden initially
      expect(screen.queryByText(/server returned status code 500/i)).not.toBeInTheDocument();

      // Click to expand details
      const detailsToggle = screen.getByText(/details/i);
      fireEvent.click(detailsToggle);

      // Now details should be visible
      expect(screen.getByText(/server returned status code 500/i)).toBeInTheDocument();
    });

    it('should show expandable details section', () => {
      const details = 'Detailed error information';
      render(<ErrorDisplay error="Error" details={details} />);

      // Should show a details toggle/section
      expect(screen.getByText(/details/i)).toBeInTheDocument();
    });

    it('should toggle details visibility when clicked', () => {
      const details = 'Hidden details';
      render(<ErrorDisplay error="Error" details={details} />);

      const detailsToggle = screen.getByText(/details/i);

      // Initially details might be hidden
      fireEvent.click(detailsToggle);

      // Details should be visible
      expect(screen.getByText(/hidden details/i)).toBeInTheDocument();
    });
  });

  describe('Help text', () => {
    it('should display help text when provided', () => {
      render(<ErrorDisplay
        error="Connection failed"
        helpText="Check your network connection and try again"
      />);

      expect(screen.getByText(/check your network connection/i)).toBeInTheDocument();
    });

    it('should provide default help text for network errors', () => {
      render(<ErrorDisplay error="Network timeout" type="network" />);

      expect(screen.getByText(/check.*connection/i)).toBeInTheDocument();
    });

    it('should provide default help text for API errors', () => {
      render(<ErrorDisplay error="API error" type="api" />);

      expect(screen.getByText(/try again|contact support/i)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have role="alert" for screen readers', () => {
      render(<ErrorDisplay error="Test error" />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should have aria-live="assertive" for critical errors', () => {
      const { container } = render(<ErrorDisplay error="Critical error" critical={true} />);

      const alert = container.querySelector('[aria-live="assertive"]');
      expect(alert).toBeInTheDocument();
    });

    it('should have aria-live="polite" for non-critical errors', () => {
      const { container } = render(<ErrorDisplay error="Warning" critical={false} />);

      const alert = container.querySelector('[aria-live="polite"]');
      expect(alert).toBeInTheDocument();
    });
  });

  describe('Auto-dismiss', () => {
    it('should auto-dismiss after timeout when specified', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();

      render(<ErrorDisplay
        error="Temporary error"
        onDismiss={onDismiss}
        autoDismissAfter={3000}
      />);

      // Fast-forward time
      vi.advanceTimersByTime(3000);

      expect(onDismiss).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not auto-dismiss without timeout', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();

      render(<ErrorDisplay error="Error" onDismiss={onDismiss} />);

      vi.advanceTimersByTime(5000);

      expect(onDismiss).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Multiple errors', () => {
    it('should display multiple errors when provided as array', () => {
      const errors = [
        'Error 1: Connection failed',
        'Error 2: Timeout',
        'Error 3: Invalid response'
      ];

      render(<ErrorDisplay errors={errors} />);

      expect(screen.getByText(/error 1/i)).toBeInTheDocument();
      expect(screen.getByText(/error 2/i)).toBeInTheDocument();
      expect(screen.getByText(/error 3/i)).toBeInTheDocument();
    });

    it('should show error count when multiple errors', () => {
      const errors = ['Error 1', 'Error 2', 'Error 3'];

      render(<ErrorDisplay errors={errors} />);

      expect(screen.getByText(/3 errors/i)).toBeInTheDocument();
    });
  });
});
