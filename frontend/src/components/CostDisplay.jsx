/**
 * 🟢 GREEN: CostDisplay Component
 *
 * Visualizes job costs with pre-run estimates and post-run actual costs.
 * Shows cost breakdown by provider (LLM, Vision, Image Gen, Critique).
 */

import styles from './CostDisplay.module.css'

/**
 * Pricing configuration (matches backend TokenTracker)
 */
const PRICING = {
  llm: {
    gpt4o: { inputPer1k: 0.005, outputPer1k: 0.015 },
    gpt4oMini: { inputPer1k: 0.00015, outputPer1k: 0.0006 }
  },
  vision: {
    gpt4o: { inputPer1k: 0.005, outputPer1k: 0.015 }
  },
  imageGen: {
    dalle3: { perImage: 0.04 }
  },
  critique: {
    gpt4o: { inputPer1k: 0.005, outputPer1k: 0.015 }
  }
}

/**
 * Calculate estimated costs based on job parameters
 */
function estimateCosts(params) {
  if (!params) return { total: 0, breakdown: {} }

  const { n = 4, iterations = 2 } = params
  const totalCandidates = n * iterations

  // Estimate based on typical token usage
  const breakdown = {
    llm: 0.05, // ~500 tokens per LLM call, assume 10 LLM calls
    vision: 0.02, // Vision API calls for ranking
    imageGen: totalCandidates * 0.04, // Each candidate is an image
    critique: 0.03
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)

  return { total, breakdown }
}

/**
 * Calculate actual costs from token usage
 */
function calculateActualCosts(tokenUsage) {
  if (!tokenUsage) return { total: 0, breakdown: {} }

  const breakdown = {
    llm: 0,
    vision: 0,
    imageGen: 0,
    critique: 0
  }

  // LLM costs
  if (tokenUsage.llm) {
    const { input = 0, output = 0 } = tokenUsage.llm
    breakdown.llm = (input / 1000) * 0.00015 + (output / 1000) * 0.0006
  }

  // Vision costs
  if (tokenUsage.vision) {
    const { input = 0, output = 0 } = tokenUsage.vision
    breakdown.vision = (input / 1000) * 0.005 + (output / 1000) * 0.015
  }

  // Image generation costs
  if (tokenUsage.imageGen?.requests) {
    breakdown.imageGen = tokenUsage.imageGen.requests * 0.04
  }

  // Critique costs
  if (tokenUsage.critique) {
    const { input = 0, output = 0 } = tokenUsage.critique
    breakdown.critique = (input / 1000) * 0.005 + (output / 1000) * 0.015
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)

  return { total, breakdown }
}

/**
 * Format cost as currency string
 */
function formatCost(cost) {
  return `$${cost.toFixed(2)}`
}

/**
 * Calculate percentage of total
 */
function getPercentage(value, total) {
  if (total === 0) return 0
  return ((value / total) * 100).toFixed(1)
}

/**
 * CostDisplay Component
 */
export default function CostDisplay({
  status,
  params,
  tokenUsage,
  finalCost,
  error
}) {
  if (!status) {
    return null
  }

  const isStarting = status === 'starting'
  const isRunning = status === 'running'
  const isCompleted = status === 'completed'
  const isError = status === 'error'

  // Calculate costs
  const estimated = estimateCosts(params)
  const actual = calculateActualCosts(tokenUsage)

  // Determine which cost to show
  const displayCost = isStarting ? estimated : actual
  const total = finalCost !== undefined ? finalCost : displayCost.total

  return (
    <div className={styles.costDisplay}>
      <div className={styles.costHeader}>
        <h2>
          {isStarting && '💰 Estimated Cost'}
          {isRunning && '💸 Actual Cost (Live)'}
          {isCompleted && '✅ Final Cost'}
          {isError && '⚠️ Cost Unavailable'}
        </h2>
      </div>

      {isError && error && (
        <div className={styles.errorMessage}>{error}</div>
      )}

      {!isError && (
        <>
          {/* Total Cost */}
          <div className={styles.totalCostSection}>
            <div className={styles.totalCostAmount}>{formatCost(total)}</div>
            {!isStarting && params && (
              <div className={styles.comparisonRow}>
                <span>Estimated: {formatCost(estimated.total)}</span>
                <span>Actual: {formatCost(actual.total)}</span>
              </div>
            )}
          </div>

          {/* Cost Breakdown */}
          <div className={styles.breakdown}>
            <h3>Cost Breakdown</h3>
            <div className={styles.breakdownItems}>
              {/* LLM */}
              {(displayCost.breakdown.llm > 0 || isStarting) && (
                <div className={styles.breakdownItem}>
                  <div className={styles.itemHeader}>
                    <span className={styles.provider}>LLM</span>
                    <span className={styles.cost}>
                      {formatCost(displayCost.breakdown.llm || 0)}
                    </span>
                  </div>
                  {total > 0 && (
                    <div className={styles.percentage}>
                      {getPercentage(displayCost.breakdown.llm, total)}%
                    </div>
                  )}
                  {tokenUsage?.llm && (
                    <div className={styles.tokens}>
                      {tokenUsage.llm.input + (tokenUsage.llm.output || 0)} tokens
                    </div>
                  )}
                </div>
              )}

              {/* Vision */}
              {(displayCost.breakdown.vision > 0 || isStarting) && (
                <div className={styles.breakdownItem}>
                  <div className={styles.itemHeader}>
                    <span className={styles.provider}>Vision</span>
                    <span className={styles.cost}>
                      {formatCost(displayCost.breakdown.vision || 0)}
                    </span>
                  </div>
                  {total > 0 && (
                    <div className={styles.percentage}>
                      {getPercentage(displayCost.breakdown.vision, total)}%
                    </div>
                  )}
                  {tokenUsage?.vision && (
                    <div className={styles.tokens}>
                      {tokenUsage.vision.input + (tokenUsage.vision.output || 0)} tokens
                    </div>
                  )}
                </div>
              )}

              {/* Image Generation */}
              {(displayCost.breakdown.imageGen > 0 || isStarting) && (
                <div className={styles.breakdownItem}>
                  <div className={styles.itemHeader}>
                    <span className={styles.provider}>Image Generation</span>
                    <span className={styles.cost}>
                      {formatCost(displayCost.breakdown.imageGen || 0)}
                    </span>
                  </div>
                  {total > 0 && (
                    <div className={styles.percentage}>
                      {getPercentage(displayCost.breakdown.imageGen, total)}%
                    </div>
                  )}
                  {tokenUsage?.imageGen?.requests && (
                    <div className={styles.tokens}>
                      {tokenUsage.imageGen.requests} images
                    </div>
                  )}
                </div>
              )}

              {/* Critique */}
              {(displayCost.breakdown.critique > 0 || isStarting) && (
                <div className={styles.breakdownItem}>
                  <div className={styles.itemHeader}>
                    <span className={styles.provider}>Critique</span>
                    <span className={styles.cost}>
                      {formatCost(displayCost.breakdown.critique || 0)}
                    </span>
                  </div>
                  {total > 0 && (
                    <div className={styles.percentage}>
                      {getPercentage(displayCost.breakdown.critique, total)}%
                    </div>
                  )}
                  {tokenUsage?.critique && (
                    <div className={styles.tokens}>
                      {tokenUsage.critique.input + (tokenUsage.critique.output || 0)} tokens
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Per-Iteration Info */}
          {!isError && params?.iterations && (
            <div className={styles.perIterationInfo}>
              <span>Per iteration: {formatCost(total / params.iterations)}</span>
              <span>Iterations: {params.iterations}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
