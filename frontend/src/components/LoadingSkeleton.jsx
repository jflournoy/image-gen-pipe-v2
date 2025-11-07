/**
 * @file LoadingSkeleton Component (TDD GREEN)
 * Loading skeleton placeholders for better perceived performance
 */

import PropTypes from 'prop-types';
import './LoadingSkeleton.css';

export default function LoadingSkeleton({
  count = 1,
  type = 'image',
  animated = true,
  animation = 'shimmer',
  width,
  height,
  borderRadius,
  ariaLabel = 'Loading',
  showText = false,
  loadingText = 'Loading...',
  showGrid = false,
  gridColumns = 2,
  showProgress = false,
  progress = 0
}) {
  // Render skeleton based on type
  const renderSkeleton = (index) => {
    const skeletonClasses = [
      'loading-skeleton',
      `skeleton-${type}`,
      animated && animation === 'shimmer' && 'skeleton-shimmer',
      animated && animation === 'pulse' && 'skeleton-pulse'
    ].filter(Boolean).join(' ');

    const style = {
      width,
      height,
      borderRadius
    };

    // Render image card skeleton (image + score)
    if (type === 'image-card') {
      const cardSkeletonClasses = [
        'loading-skeleton',
        animated && animation === 'shimmer' && 'skeleton-shimmer',
        animated && animation === 'pulse' && 'skeleton-pulse'
      ].filter(Boolean).join(' ');

      return (
        <div key={index} className="skeleton-image-card">
          <div className={`${cardSkeletonClasses} skeleton-image-placeholder`} />
          <div className={`${cardSkeletonClasses} skeleton-score-placeholder`} />
        </div>
      );
    }

    // Render simple skeleton
    return (
      <div
        key={index}
        className={skeletonClasses}
        style={style}
        aria-busy="true"
        aria-label={index === 0 ? ariaLabel : undefined}
      />
    );
  };

  const skeletons = Array.from({ length: count }, (_, i) => renderSkeleton(i));

  const containerClasses = [
    'skeleton-container',
    showGrid && 'skeleton-grid'
  ].filter(Boolean).join(' ');

  const containerStyle = showGrid ? {
    gridTemplateColumns: `repeat(${gridColumns}, 1fr)`
  } : {};

  return (
    <div className={containerClasses} style={containerStyle}>
      {skeletons}

      {showText && (
        <div className="skeleton-loading-text">
          {loadingText}
        </div>
      )}

      {showProgress && (
        <div className="skeleton-progress">
          <div className="skeleton-progress-bar">
            <div
              className="skeleton-progress-fill"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin="0"
              aria-valuemax="100"
            />
          </div>
          <div className="skeleton-progress-text">
            {Math.round(progress)}%
          </div>
        </div>
      )}
    </div>
  );
}

LoadingSkeleton.propTypes = {
  count: PropTypes.number,
  type: PropTypes.oneOf(['image', 'text', 'card', 'circle', 'image-card']),
  animated: PropTypes.bool,
  animation: PropTypes.oneOf(['shimmer', 'pulse']),
  width: PropTypes.string,
  height: PropTypes.string,
  borderRadius: PropTypes.string,
  ariaLabel: PropTypes.string,
  showText: PropTypes.bool,
  loadingText: PropTypes.string,
  showGrid: PropTypes.bool,
  gridColumns: PropTypes.number,
  showProgress: PropTypes.bool,
  progress: PropTypes.number
};
