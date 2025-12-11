/**
 * 🟢 GREEN: CandidateTreeVisualization Component
 *
 * Visualizes the chain of candidates through beam search iterations.
 * Shows how candidates are generated, ranked, and refined across iterations.
 */

export default function CandidateTreeVisualization({ metadata }) {
  if (!metadata) {
    return (
      <div className="candidate-tree-visualization">
        <p>No data available</p>
      </div>
    )
  }

  return (
    <div className="candidate-tree-visualization">
      <h1>Beam Search Evolution</h1>

      {/* Iterations section */}
      <div className="iterations-container">
        {metadata.iterations?.map((iteration) => (
          <section key={iteration.iteration} className="iteration-section">
            <h2>Iteration {iteration.iteration}</h2>

            <div className="candidates-grid">
              {iteration.candidates?.map((candidate) => {
                const globalId = `i${iteration.iteration}c${candidate.candidateId}`
                return (
                  <div
                    key={globalId}
                    className={`candidate-card ${
                      candidate.survived ? 'survived' : 'eliminated'
                    }`}
                  >
                    <div className="candidate-header">
                      <h3>{globalId}</h3>
                      {candidate.image?.url && (
                        <img
                          src={candidate.image.url}
                          alt={`Candidate ${globalId}`}
                          className="candidate-image"
                        />
                      )}
                    </div>

                    <div className="candidate-prompts">
                      <div className="prompt-section">
                        <strong>WHAT:</strong>
                        <p>{candidate.whatPrompt}</p>
                      </div>
                      <div className="prompt-section">
                        <strong>HOW:</strong>
                        <p>{candidate.howPrompt}</p>
                      </div>
                    </div>

                    {candidate.parentId !== null && (
                      <div className="parent-info">
                        Parent: i{iteration.iteration - 1}c{candidate.parentId}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Winner section */}
      {metadata.winner && (
        <section className="winner-section">
          <h2>🏆 Winner</h2>
          <div className="winner-info">
            <p>
              <strong>ID:</strong> i{metadata.winner.iteration}c{metadata.winner.candidateId}
            </p>
            <p>
              <strong>WHAT:</strong> {metadata.winner.whatPrompt}
            </p>
            <p>
              <strong>HOW:</strong> {metadata.winner.howPrompt}
            </p>
          </div>
        </section>
      )}

      {/* Finalists comparison section */}
      {metadata.finalists && metadata.finalists.length > 0 && (
        <section className="finalists-section">
          <h2>🥇 Finalists</h2>
          <div className="finalists-grid">
            {metadata.finalists.map((finalist, idx) => (
              <div key={idx} className="finalist-card">
                <h3>{idx === 0 ? '🥇 Winner' : '🥈 Runner-up'}</h3>
                <p>
                  <strong>ID:</strong> i{finalist.iteration}c{finalist.candidateId}
                </p>
                <p>
                  <strong>WHAT:</strong> {finalist.whatPrompt}
                </p>
                <p>
                  <strong>HOW:</strong> {finalist.howPrompt}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lineage section (if available) */}
      {metadata.lineage && metadata.lineage.length > 0 && (
        <section className="lineage-section">
          <h2>🌳 Winner Lineage</h2>
          <div className="lineage-path">
            {metadata.lineage.map((node, idx) => (
              <div key={idx} className="lineage-node">
                i{node.iteration}c{node.candidateId}
                {idx < metadata.lineage.length - 1 && <span className="arrow">→</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
