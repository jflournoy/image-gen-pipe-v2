/**
 * CandidateCard Component
 *
 * Displays a single candidate in the beam search timeline.
 * Features:
 * - Progressive loading: skeleton → image → prompts → survival badge
 * - Combined prompt with text overflow handling
 * - Expandable WHAT/HOW prompts
 * - Survival status badge (✓ or ✗)
 * - Parent-child relationship indication
 */

import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import ExpandableText from './ExpandableText';
import LoadingSkeleton from './LoadingSkeleton';
import './CandidateCard.css';

export default function CandidateCard({ candidate, survivalStatus }) {
  const [showDetails, setShowDetails] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset image loaded state when imageUrl changes
  useEffect(() => {
    setImageLoaded(false);
    if (candidate.imageUrl) {
      console.log(`[CandidateCard ${candidate.id}] Image URL: ${candidate.imageUrl}`);
    }
  }, [candidate.imageUrl, candidate.id]);

  const hasImage = !!candidate.imageUrl && imageLoaded;
  const hasPrompts = !!candidate.combined;
  const hasSurvivalStatus = survivalStatus !== undefined;
  const survived = survivalStatus?.survived;
  const rank = survivalStatus?.rank;

  return (
    <div
      className={`candidate-card ${
        hasSurvivalStatus
          ? survived
            ? 'survived'
            : 'eliminated'
          : 'pending'
      }`}
      data-id={candidate.id}
      data-parent={candidate.parentId !== null ? candidate.parentId : undefined}
    >
      {/* Image Section */}
      <div className="card-image-section">
        {!candidate.imageUrl ? (
          <LoadingSkeleton type="image-card" count={1} />
        ) : imageLoaded ? (
          <img
            src={candidate.imageUrl}
            alt={`Candidate ${candidate.id}`}
            className="card-image"
            onLoad={() => setImageLoaded(true)}
          />
        ) : (
          <>
            <LoadingSkeleton type="image-card" count={1} />
            <img
              src={candidate.imageUrl}
              alt={`Candidate ${candidate.id}`}
              className="card-image"
              style={{ display: 'none' }}
              onLoad={() => setImageLoaded(true)}
            />
          </>
        )}
      </div>

      {/* Card Body */}
      <div className="card-body">
        {/* Card Header with ID and Status Badge */}
        <div className="card-header">
          <h3 className="card-id">{candidate.id}</h3>
          {hasSurvivalStatus && (
            <div className={`survival-badge ${survived ? 'survived' : 'eliminated'}`}>
              {survived ? '✓' : '✗'} Rank {rank}
            </div>
          )}
        </div>

        {/* Combined Prompt */}
        {!hasPrompts ? (
          <div className="prompt-loading">Loading prompts...</div>
        ) : (
          <>
            <div className="combined-prompt-section">
              <ExpandableText
                label="Combined"
                text={candidate.combined}
                maxLength={100}
                showLabel={true}
              />
            </div>

            {/* Expandable WHAT/HOW Details */}
            <details
              className="prompt-details"
              open={showDetails}
              onChange={(e) => setShowDetails(e.target.open)}
            >
              <summary>Show WHAT/HOW breakdown</summary>
              <div className="prompt-breakdown">
                {candidate.whatPrompt && (
                  <ExpandableText
                    label="WHAT"
                    text={candidate.whatPrompt}
                    maxLength={80}
                    showLabel={true}
                  />
                )}
                {candidate.howPrompt && (
                  <ExpandableText
                    label="HOW"
                    text={candidate.howPrompt}
                    maxLength={80}
                    showLabel={true}
                  />
                )}
              </div>
            </details>
          </>
        )}

        {/* Parent Info */}
        {candidate.parentId !== null && candidate.parentId !== undefined && typeof candidate.parentId === 'number' && (
          <div className="parent-info">
            Parent: i{candidate.iteration - 1}c{candidate.parentId}
          </div>
        )}
      </div>
    </div>
  );
}

CandidateCard.propTypes = {
  candidate: PropTypes.shape({
    id: PropTypes.string.isRequired,
    iteration: PropTypes.number.isRequired,
    candidateId: PropTypes.number.isRequired,
    imageUrl: PropTypes.string,
    combined: PropTypes.string,
    whatPrompt: PropTypes.string,
    howPrompt: PropTypes.string,
    ranking: PropTypes.object,
    parentId: PropTypes.number,
    timestamp: PropTypes.string
  }).isRequired,
  survivalStatus: PropTypes.shape({
    survived: PropTypes.bool.isRequired,
    rank: PropTypes.number.isRequired
  })
};
