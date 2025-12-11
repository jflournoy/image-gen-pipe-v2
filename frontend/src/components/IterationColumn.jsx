/**
 * IterationColumn Component
 *
 * Displays all candidates from a single iteration as a vertical column.
 * Used within BeamSearchTimeline for horizontal scrolling layout.
 */

import CandidateCard from './CandidateCard';
import './IterationColumn.css';

export default function IterationColumn({ iteration, candidates, survivalStatus }) {
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
