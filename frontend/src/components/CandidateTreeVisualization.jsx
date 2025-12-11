/**
 * 🟢 GREEN: CandidateTreeVisualization Component
 *
 * Visualizes the chain of candidates through beam search iterations.
 * Shows how candidates are generated, ranked, and refined across iterations.
 */

import ExpandableText from './ExpandableText'
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
                      <ExpandableText
                        label="WHAT"
                        text={candidate.whatPrompt}
                        maxLength={60}
                        showLabel={true}
                      />
                      <ExpandableText
                        label="HOW"
                        text={candidate.howPrompt}
                        maxLength={60}
                        showLabel={true}
                      />
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
            {metadata.finalists.map((finalist, idx) => {
              const ranking = finalist.ranking || {}
              const position = idx + 1
              const rankLabel = position === 1 ? '🥇 Winner' : '🥈 Runner-up'
              const explanation = position === 1
                ? 'Better on comparative evaluation'
                : 'Ranked lower on comparative evaluation'

              return (
                <div key={idx} className={styles.finalist_card}>
                  <h3>{rankLabel}</h3>
                  <p>
                    <strong>ID:</strong> i{finalist.iteration}c{finalist.candidateId}
                  </p>

                  {/* Comparative ranking explanation */}
                  {ranking.reason && (
                    <div className={styles.ranking_section}>
                      <div className={styles.rank_status}>
                        ⭐ RANKED {position === 1 ? '1st' : '2nd'} ({explanation})
                      </div>
                      <ExpandableText
                        label="💡 Why"
                        text={ranking.reason}
                        maxLength={100}
                        showLabel={true}
                      />
                    </div>
                  )}

                  {/* Strengths and weaknesses */}
                  {(ranking.strengths?.length > 0 || ranking.weaknesses?.length > 0) && (
                    <div className={styles.attributes_section}>
                      {ranking.strengths && ranking.strengths.length > 0 && (
                        <div className={styles.strengths}>
                          <div className={styles.attr_label}>✅ Strengths</div>
                          <div className={styles.attr_list}>
                            {ranking.strengths.slice(0, 3).map((strength, i) => (
                              <div key={i} className={styles.attr_item}>
                                • {strength}
                              </div>
                            ))}
                            {ranking.strengths.length > 3 && (
                              <div className={styles.attr_item}>
                                [+{ranking.strengths.length - 3} more strengths]
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {ranking.weaknesses && ranking.weaknesses.length > 0 && (
                        <div className={styles.weaknesses}>
                          <div className={styles.attr_label}>⚠️ Weaknesses</div>
                          <div className={styles.attr_list}>
                            {ranking.weaknesses.slice(0, 3).map((weakness, i) => (
                              <div key={i} className={styles.attr_item}>
                                • {weakness}
                              </div>
                            ))}
                            {ranking.weaknesses.length > 3 && (
                              <div className={styles.attr_item}>
                                [+{ranking.weaknesses.length - 3} more weaknesses]
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Prompts */}
                  <ExpandableText
                    label="📝 WHAT"
                    text={finalist.whatPrompt}
                    maxLength={80}
                    showLabel={true}
                  />
                  <ExpandableText
                    label="🎨 HOW"
                    text={finalist.howPrompt}
                    maxLength={80}
                    showLabel={true}
                  />

                  {/* Image status */}
                  {finalist.image?.url && (
                    <div className={styles.image_info}>
                      <div className={styles.image_status}>
                        🖼️ Image: <span className={styles.status_found}>✓ Found</span>
                      </div>
                      <img
                        src={finalist.image.url}
                        alt={`${rankLabel} Image`}
                        className={styles.finalist_image}
                      />
                    </div>
                  )}
                </div>
              )
            })}
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
