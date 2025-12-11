/**
 * BeamSearchTimeline Component
 *
 * Main horizontal timeline view for real-time beam search visualization.
 * Features:
 * - Horizontal scroll through iterations (Iteration 0 → 1 → 2 → ...)
 * - Real-time card streaming as candidates are generated
 * - Progressive loading states (skeleton → image → prompts → survival)
 * - Visual survival badges (✓ survived, ✗ eliminated)
 * - Scroll-snap for smooth snapping to iteration columns
 */

import PropTypes from 'prop-types';
import IterationColumn from './IterationColumn';
import './BeamSearchTimeline.css';

export default function BeamSearchTimeline({
  candidatesByIteration,
  survivalStatus
}) {
  // Sort iterations numerically
  const sortedIterations = Object.keys(candidatesByIteration)
    .map(Number)
    .sort((a, b) => a - b);

  if (sortedIterations.length === 0) {
    return (
      <div className="timeline-empty">
        <p>Waiting for candidates...</p>
      </div>
    );
  }

  return (
    <div className="timeline-container">
      {sortedIterations.map((iterationNum) => (
        <IterationColumn
          key={iterationNum}
          iteration={iterationNum}
          candidates={candidatesByIteration[iterationNum] || []}
          survivalStatus={survivalStatus}
        />
      ))}
    </div>
  );
}

BeamSearchTimeline.propTypes = {
  candidatesByIteration: PropTypes.objectOf(
    PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        iteration: PropTypes.number.isRequired,
        imageUrl: PropTypes.string,
        combined: PropTypes.string,
        parentId: PropTypes.number
      })
    )
  ).isRequired,
  survivalStatus: PropTypes.objectOf(
    PropTypes.shape({
      survived: PropTypes.bool.isRequired,
      rank: PropTypes.number.isRequired
    })
  ).isRequired
};
