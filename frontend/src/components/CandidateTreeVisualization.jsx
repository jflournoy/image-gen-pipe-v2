/**
 * 🟢 GREEN: CandidateTreeVisualization Component
 *
 * Visualizes the chain of candidates through beam search iterations.
 * Shows how candidates are generated, ranked, and refined across iterations.
 */

import styles from './CandidateTreeVisualization.module.css'

export default function CandidateTreeVisualization({ metadata }) {
  if (!metadata) {
    return (
      <div className={styles.candidate_tree_visualization}>
        <p>No data available</p>
      </div>
    )
  }

  return (
    <div className={styles.candidate_tree_visualization}>
      <h1>Beam Search Evolution</h1>

      {/* Iterations section */}
      <div className={styles.iterations_container}>
        {metadata.iterations?.map((iteration) => (
          <section key={iteration.iteration} className={styles.iteration_section}>
            <h2>Iteration {iteration.iteration}</h2>

            <div className={styles.candidates_grid}>
              {iteration.candidates?.map((candidate) => {
                const globalId = `i${iteration.iteration}c${candidate.candidateId}`
                return (
                  <div
                    key={globalId}
                    className={`${styles.candidate_card} ${
                      candidate.survived ? styles.survived : styles.eliminated
                    }`}
                  >
                    <div className={styles.candidate_header}>
                      <h3>{globalId}</h3>
                      {candidate.image?.url && (
                        <img
                          src={candidate.image.url}
                          alt={`Candidate ${globalId}`}
                          className={styles.candidate_image}
                        />
                      )}
                    </div>

                    <div className={styles.candidate_prompts}>
                      <div className={styles.prompt_section}>
                        <strong>WHAT:</strong>
                        <p>{candidate.whatPrompt}</p>
                      </div>
                      <div className={styles.prompt_section}>
                        <strong>HOW:</strong>
                        <p>{candidate.howPrompt}</p>
                      </div>
                    </div>

                    {candidate.parentId !== null && (
                      <div className={styles.parent_info}>
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
        <section className={styles.winner_section}>
          <h2>🏆 Winner</h2>
          <div className={styles.winner_info}>
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
        <section className={styles.finalists_section}>
          <h2>🥇 Finalists</h2>
          <div className={styles.finalists_grid}>
            {metadata.finalists.map((finalist, idx) => (
              <div key={idx} className={styles.finalist_card}>
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
        <section className={styles.lineage_section}>
          <h2>🌳 Winner Lineage</h2>
          <div className={styles.lineage_path}>
            {metadata.lineage.map((node, idx) => (
              <div key={idx} className={styles.lineage_node}>
                i{node.iteration}c{node.candidateId}
                {idx < metadata.lineage.length - 1 && <span className={styles.arrow}>→</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
