/**
 * IterationColumn Component
 *
 * Displays all candidates from a single iteration as a vertical column.
 * Used within BeamSearchTimeline for horizontal scrolling layout.
 */

import PropTypes from 'prop-types';
import CandidateCard from './CandidateCard';
import './IterationColumn.css';

export default function IterationColumn({ iteration, candidates, survivalStatus }) {
  // Debug: Log which candidates are rendering and their image URLs
  if (candidates.length > 0) {
    const candidatesWithImages = candidates.filter(c => c.imageUrl);
    const candidatesWithParents = candidates.filter(c => c.parentId !== null && c.parentId !== undefined);
    if (candidatesWithImages.length > 0 || candidatesWithParents.length > 0) {
      console.log(`[IterationColumn ${iteration}] ${candidates.length} candidates: ${candidatesWithImages.length} with images, ${candidatesWithParents.length} with parents`);
    }
  }

  return (
    <div className="iteration-column">
      <div className="iteration-header">
        <h2>Iteration {iteration}</h2>
        <span className="candidate-count">({candidates.length} candidates)</span>
      </div>

      <div className="candidates-container">
        {candidates.length === 0 ? (
          <div className="no-candidates">Waiting for candidates...</div>
        ) : (
          candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              survivalStatus={survivalStatus[candidate.id]}
            />
          ))
        )}
      </div>
    </div>
  );
}

IterationColumn.propTypes = {
  iteration: PropTypes.number.isRequired,
  candidates: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      iteration: PropTypes.number.isRequired,
      imageUrl: PropTypes.string,
      combined: PropTypes.string,
      parentId: PropTypes.number
    })
  ).isRequired,
  survivalStatus: PropTypes.objectOf(
    PropTypes.shape({
      survived: PropTypes.bool.isRequired,
      rank: PropTypes.number.isRequired
    })
  ).isRequired
};
