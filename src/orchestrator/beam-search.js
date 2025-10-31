/**
 * TDD GREEN Phase: Beam Search Orchestrator
 *
 * Implements streaming parallel beam search for image generation.
 * Reference: docs/streaming-parallel-architecture.md
 */

/**
 * Rank candidates by total score and select top M
 * @param {Array<Object>} candidates - Candidates with totalScore property
 * @param {number} keepTop - Number of top candidates to keep
 * @returns {Array<Object>} Top M candidates sorted by score (descending)
 */
function rankAndSelect(candidates, keepTop) {
  // Create a copy to avoid mutating original array
  const sorted = [...candidates].sort((a, b) => b.totalScore - a.totalScore);

  // Return top M candidates (or all if keepTop > candidate count)
  return sorted.slice(0, keepTop);
}

/**
 * Calculate total score from alignment and aesthetic scores
 * @param {number} alignmentScore - Alignment score (0-100)
 * @param {number} aestheticScore - Aesthetic score (0-10)
 * @param {number} alpha - Weight for alignment (default 0.7). Range 0-1.
 * @returns {number} Total score (0-100)
 */
function calculateTotalScore(alignmentScore, aestheticScore, alpha = 0.7) {
  // Normalize aesthetic score from 0-10 scale to 0-100 scale
  const normalizedAesthetic = aestheticScore * 10;

  // Weighted combination: alpha * alignment + (1-alpha) * aesthetic
  const totalScore = alpha * alignmentScore + (1 - alpha) * normalizedAesthetic;

  return totalScore;
}

/**
 * Process a single candidate through the streaming pipeline
 * @param {string} whatPrompt - Content prompt
 * @param {string} howPrompt - Style prompt
 * @param {Object} llmProvider - LLM provider instance
 * @param {Object} imageGenProvider - Image generation provider instance
 * @param {Object} visionProvider - Vision provider instance
 * @param {Object} options - Processing options
 * @param {number} options.iteration - Current iteration number
 * @param {number} options.candidateId - Candidate identifier
 * @param {string} options.dimension - 'what' or 'how'
 * @param {number} [options.alpha=0.7] - Scoring weight for alignment
 * @param {number} [options.parentId] - Parent candidate ID (for tracking lineage)
 * @param {string} [options.size] - Image size
 * @param {string} [options.quality] - Image quality
 * @returns {Promise<Object>} Candidate with all processing results
 */
async function processCandidateStream(
  whatPrompt,
  howPrompt,
  llmProvider,
  imageGenProvider,
  visionProvider,
  options = {}
) {
  // Stage 1: Combine prompts
  const combined = await llmProvider.combinePrompts(whatPrompt, howPrompt);

  // Stage 2: Generate image (starts as soon as combine finishes)
  const image = await imageGenProvider.generateImage(combined, options);

  // Stage 3: Evaluate image (starts as soon as image finishes)
  const evaluation = await visionProvider.analyzeImage(image.url, combined);

  // Calculate total score
  const alpha = options.alpha !== undefined ? options.alpha : 0.7;
  const totalScore = calculateTotalScore(
    evaluation.alignmentScore,
    evaluation.aestheticScore,
    alpha
  );

  // Return complete candidate object
  return {
    whatPrompt,
    howPrompt,
    combined,
    image,
    evaluation,
    totalScore,
    metadata: {
      iteration: options.iteration,
      candidateId: options.candidateId,
      dimension: options.dimension,
      parentId: options.parentId
    }
  };
}

/**
 * Initial expansion (Iteration 0) - Generate N WHAT+HOW pairs with variation
 * @param {string} userPrompt - Initial user prompt
 * @param {Object} llmProvider - LLM provider instance
 * @param {Object} imageGenProvider - Image generation provider instance
 * @param {Object} visionProvider - Vision provider instance
 * @param {Object} config - Configuration
 * @param {number} config.beamWidth - Number of candidates to generate (N)
 * @param {number} [config.temperature=0.7] - Temperature for stochastic variation
 * @param {number} [config.alpha=0.7] - Scoring weight for alignment
 * @returns {Promise<Array>} Array of N candidates
 */
async function initialExpansion(
  userPrompt,
  llmProvider,
  imageGenProvider,
  visionProvider,
  config
) {
  const { beamWidth: N, temperature = 0.7, alpha = 0.7 } = config;

  // Generate N WHAT+HOW pairs in parallel with stochastic variation
  const whatHowPairs = await Promise.all(
    Array(N).fill().map(async () => {
      // Generate WHAT and HOW in parallel for each candidate
      const [what, how] = await Promise.all([
        llmProvider.refinePrompt(userPrompt, {
          dimension: 'what',
          operation: 'expand',
          temperature
        }),
        llmProvider.refinePrompt(userPrompt, {
          dimension: 'how',
          operation: 'expand',
          temperature
        })
      ]);
      return {
        what: what.refinedPrompt,
        how: how.refinedPrompt
      };
    })
  );

  // Stream all N candidates through the pipeline in parallel
  const candidates = await Promise.all(
    whatHowPairs.map(({ what, how }, i) =>
      processCandidateStream(
        what,
        how,
        llmProvider,
        imageGenProvider,
        visionProvider,
        {
          iteration: 0,
          candidateId: i,
          dimension: 'what', // First iteration refines WHAT
          alpha
        }
      )
    )
  );

  return candidates;
}

/**
 * Refinement iteration (Iteration 1+) - Generate children from top parents
 * @param {Array} parents - Top M parent candidates from previous iteration
 * @param {Object} llmProvider - LLM provider instance
 * @param {Object} imageGenProvider - Image generation provider instance
 * @param {Object} visionProvider - Vision provider instance
 * @param {Object} critiqueGenProvider - Critique generator instance
 * @param {Object} config - Configuration
 * @param {number} config.beamWidth - Total candidates to generate (N)
 * @param {number} config.keepTop - Number of parents (M)
 * @param {number} [config.alpha=0.7] - Scoring weight for alignment
 * @param {number} iteration - Current iteration number
 * @returns {Promise<Array>} Array of N child candidates
 */
async function refinementIteration(
  parents,
  llmProvider,
  imageGenProvider,
  visionProvider,
  critiqueGenProvider,
  config,
  iteration
) {
  const { beamWidth: N, keepTop: M, alpha = 0.7 } = config;
  const expansionRatio = Math.floor(N / M);

  // Determine dimension: odd iterations refine WHAT, even refine HOW
  const dimension = iteration % 2 === 1 ? 'what' : 'how';

  // Generate M critiques in parallel (one per parent)
  const parentsWithCritiques = await Promise.all(
    parents.map(async (parent) => {
      const critique = await critiqueGenProvider.generateCritique(
        parent.evaluation,
        {
          what: parent.whatPrompt,
          how: parent.howPrompt,
          combined: parent.combined
        },
        {
          dimension,
          iteration
        }
      );
      return { ...parent, critique };
    })
  );

  // Generate N total children (each parent generates expansionRatio children)
  const allChildren = await Promise.all(
    parentsWithCritiques.flatMap((parent, parentIdx) =>
      Array(expansionRatio).fill().map(async (_, childIdx) => {
        // Refine the selected dimension using critique
        const refinedResult = await llmProvider.refinePrompt(
          dimension === 'what' ? parent.whatPrompt : parent.howPrompt,
          {
            operation: 'refine',
            dimension,
            critique: parent.critique
          }
        );

        // Construct new prompts: refine selected dimension, inherit other
        const whatPrompt = dimension === 'what'
          ? refinedResult.refinedPrompt
          : parent.whatPrompt;
        const howPrompt = dimension === 'how'
          ? refinedResult.refinedPrompt
          : parent.howPrompt;

        // Stream child through pipeline
        return processCandidateStream(
          whatPrompt,
          howPrompt,
          llmProvider,
          imageGenProvider,
          visionProvider,
          {
            iteration,
            candidateId: parentIdx * expansionRatio + childIdx,
            dimension,
            parentId: parent.metadata.candidateId,
            alpha
          }
        );
      })
    )
  );

  return allChildren;
}

/**
 * Main beam search orchestrator
 * @param {string} userPrompt - Initial user prompt
 * @param {Object} providers - Provider instances
 * @param {Object} providers.llm - LLM provider instance
 * @param {Object} providers.imageGen - Image generation provider instance
 * @param {Object} providers.vision - Vision provider instance
 * @param {Object} providers.critiqueGen - Critique generator instance
 * @param {Object} config - Configuration
 * @param {number} config.beamWidth - Number of candidates per iteration (N)
 * @param {number} config.keepTop - Number of top candidates to keep (M)
 * @param {number} config.maxIterations - Maximum number of iterations to run
 * @param {number} [config.alpha=0.7] - Scoring weight for alignment
 * @param {number} [config.temperature=0.7] - Temperature for stochastic variation
 * @param {Object} [config.metadataTracker] - Optional metadata tracker instance
 * @returns {Promise<Object>} Best candidate after all iterations
 */
async function beamSearch(userPrompt, providers, config) {
  const { llm, imageGen, vision, critiqueGen } = providers;
  const { maxIterations, keepTop, metadataTracker } = config;

  // Iteration 0: Initial expansion
  let candidates = await initialExpansion(
    userPrompt,
    llm,
    imageGen,
    vision,
    config
  );

  // Rank and select top M candidates
  let topCandidates = rankAndSelect(candidates, keepTop);

  // Record iteration 0 candidates if tracker provided
  if (metadataTracker) {
    await Promise.all(candidates.map(candidate =>
      metadataTracker.recordCandidate(candidate, {
        survived: topCandidates.includes(candidate)
      })
    ));
  }

  // Iterations 1+: Refinement
  for (let iteration = 1; iteration < maxIterations; iteration++) {
    // Generate N children from M parents
    candidates = await refinementIteration(
      topCandidates,
      llm,
      imageGen,
      vision,
      critiqueGen,
      config,
      iteration
    );

    // Rank and select top M for next iteration
    topCandidates = rankAndSelect(candidates, keepTop);

    // Record iteration candidates if tracker provided
    if (metadataTracker) {
      await Promise.all(candidates.map(candidate =>
        metadataTracker.recordCandidate(candidate, {
          survived: topCandidates.includes(candidate)
        })
      ));
    }
  }

  // Mark final winner if tracker provided
  const winner = topCandidates[0];
  if (metadataTracker) {
    await metadataTracker.markFinalWinner({
      iteration: winner.metadata.iteration,
      candidateId: winner.metadata.candidateId,
      totalScore: winner.totalScore
    });
  }

  // Return best candidate from final iteration
  return winner;
}

module.exports = {
  rankAndSelect,
  calculateTotalScore,
  processCandidateStream,
  initialExpansion,
  refinementIteration,
  beamSearch
};
