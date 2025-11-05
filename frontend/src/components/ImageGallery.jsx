/**
 * @file ImageGallery Component
 * Displays a gallery of generated images with scores
 */

export default function ImageGallery({ images }) {
  // Show empty state if no images
  if (!images || images.length === 0) {
    return (
      <div className="image-gallery-empty">
        <p>No images to display yet.</p>
      </div>
    )
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
