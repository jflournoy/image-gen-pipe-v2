/**
 * @file ImageGallery Component
 * Displays a gallery of generated images with scores
 */

import LoadingSkeleton from './LoadingSkeleton';
import PropTypes from 'prop-types';

export default function ImageGallery({ images, loading = false, expectedCount = 4 }) {
  // Show loading skeletons while generating
  if (loading) {
    return (
      <div className="image-gallery">
        <LoadingSkeleton
          type="image-card"
          count={expectedCount}
          showGrid={true}
          gridColumns={2}
          showText={true}
          loadingText="Generating images..."
        />
      </div>
    );
  }

  // Show empty state if no images
  if (!images || images.length === 0) {
    return (
      <div className="image-gallery-empty">
        <p>No images to display yet.</p>
      </div>
    );
  }

  // Sort images by score descending (highest first)
  const sortedImages = [...images].sort((a, b) => b.score - a.score)

  return (
    <div className="image-gallery">
      <div className="gallery-grid">
        {sortedImages.map((image) => (
          <div key={image.id} className="image-card">
            <img
              src={image.url}
              alt={`Generated image ${image.id} with score ${image.score}`}
              className="gallery-image"
            />
            <div className="image-score">
              Score: {image.score}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

ImageGallery.propTypes = {
  images: PropTypes.array,
  loading: PropTypes.bool,
  expectedCount: PropTypes.number
};
