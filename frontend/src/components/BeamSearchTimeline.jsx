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

import { useEffect, useRef } from 'react';
import IterationColumn from './IterationColumn';
import './BeamSearchTimeline.css';

export default function BeamSearchTimeline({
  candidatesByIteration,
  survivalStatus,
  autoScrollToLatest = true
}) {
  const containerRef = useRef(null);
  const latestIterationRef = useRef(null);

  // Auto-scroll to latest iteration
  useEffect(() => {
    if (autoScrollToLatest && latestIterationRef.current) {
      latestIterationRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [candidatesByIteration, autoScrollToLatest]);

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
    <div className="timeline-container" ref={containerRef}>
      {sortedIterations.map((iterationNum, idx) => {
        const isLatest = idx === sortedIterations.length - 1;
        return (
          <div
            key={iterationNum}
            ref={isLatest ? latestIterationRef : null}
          >
            <IterationColumn
              iteration={iterationNum}
              candidates={candidatesByIteration[iterationNum] || []}
              survivalStatus={survivalStatus}
            />
          </div>
        );
      })}
    </div>
  );
}
