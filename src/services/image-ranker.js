/**
 * TDD GREEN Phase: Image Ranker
 *
 * Comparative ranking system for images using LLM vision capabilities.
 * Instead of absolute scores, compares images relatively to determine quality.
 *
 * Strategy:
 * - All-pairs comparison for small N (≤8): Build complete comparison graph
 * - Tournament selection with transitivity for large N (>8): Minimize comparisons
 * - Transitive inference to minimize API calls (if A>B and B>C, then A>C)
 * - Optional ensemble voting for reliability (multiple comparisons per pair)
 *
 * All-Pairs Optimization (N ≤ 8):
 * - Compares all unique pairs upfront: C(N,2) = N*(N-1)/2 comparisons
 * - Builds complete comparison graph with full transitivity information
 * - Better for ensemble voting (all pairs compared consistently)
 * - Unlocks transitivity benefits for subsequent rankings
 * - Example: 4 candidates = 6 all-pairs comparisons (optimal for total ordering)
 *
 * Benefits of comparative ranking:
 * - More reliable than absolute scoring (easier for model to compare than score)
 * - Provides reasons tied to specific comparisons
 * - Consistent algorithm regardless of image count
 * - Complete graph enables better transitivity inference
 */

const OpenAI = require('openai');
const providerConfig = require('../config/provider-config.js');

class ImageRanker {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || providerConfig.vision.model;

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        maxRetries: options.maxRetries || providerConfig.llm.maxRetries,
        timeout: options.timeout || providerConfig.llm.timeout
      });
    }

    // Ensemble configuration
    this.defaultEnsembleSize = options.defaultEnsembleSize || 1;
    this.ensembleTemperature = options.ensembleTemperature || 0.8; // Higher for variance
    this.defaultTemperature = options.temperature || 0.3; // Low for consistency

    // Multi-factor scoring weights (alignment vs aesthetics)
    // Default: 70% alignment (prompt match), 30% aesthetics
    this.alignmentWeight = options.alignmentWeight ?? 0.7;

    // Threshold for switching algorithms (kept for backward compatibility)
    this.allAtOnceThreshold = 4;

    // Token tracking for cost monitoring
    this.accumulatedTokens = 0;

    // Error tracking for graceful degradation
    this.errors = [];
  }

  /**
   * Rank images using unified pairwise comparison with transitive inference
   * Consistent algorithm for all N - no special cases for small N
   * @param {Array<{candidateId: number, url: string}>} images - Images to rank
   * @param {string} prompt - The prompt they should match
   * @param {Object} options - Ranking options
   * @param {number} [options.keepTop] - Number of top candidates needed (for optimization)
   * @param {number} [options.ensembleSize] - Number of votes per comparison for reliability
   * @returns {Promise<Array<{candidateId: number, rank: number, reason: string}>>}
   */
  async rankImages(images, prompt, options = {}) {
    // Reset token counter and error tracking for this ranking session
    this.resetTokenCount();
    this.resetErrors();

    const gracefulDegradation = options.gracefulDegradation ?? false;

    try {
      // Always use transitive pairwise ranking for consistency
      // This ensures the same algorithm regardless of image count
      const rankings = await this.rankPairwiseTransitive(images, prompt, options);

      // Check if any errors occurred during ranking
      if (this.errors.length > 0 && !gracefulDegradation) {
        // With graceful degradation disabled, throw on any error
        const firstError = this.errors[0];
        throw new Error(firstError.message);
      }

      // Attach accumulated tokens and errors as metadata
      const tokensUsed = this.getAccumulatedTokens();
      return {
        rankings,
        metadata: {
          tokensUsed,
          errors: this.errors.length > 0 ? this.errors : undefined
        }
      };
    } catch (error) {
      // If graceful degradation is disabled, rethrow
      if (!gracefulDegradation) {
        throw error;
      }

      // With graceful degradation, return empty rankings with error metadata
      this.recordError({
        message: error.message,
        type: 'ranking_failure',
        fatal: true
      });

      return {
        rankings: [],
        metadata: {
          tokensUsed: this.getAccumulatedTokens(),
          errors: this.errors
        }
      };
    }
  }

  /**
   * Rank all images at once (best for N ≤ 4)
   * Sends all images in one API call for holistic comparison
   * @param {Array<{candidateId: number, url: string}>} images - Images to rank
   * @param {string} prompt - The prompt they should match
   * @param {Object} options - Ranking options
   * @returns {Promise<Array<{candidateId: number, rank: number, reason: string}>>}
   */
  async rankAllAtOnce(images, prompt, _options = {}) {
    // Shuffle images to mitigate position bias
    // Create array of indices and shuffle them
    const indices = images.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const shuffledImages = indices.map(i => images[i]);

    // Create letter labels for clearer reference (A, B, C, D...)
    const labels = shuffledImages.map((_, i) => String.fromCharCode(65 + i));
    const labelToCandidateId = new Map(
      shuffledImages.map((img, i) => [labels[i], img.candidateId])
    );

    // Build vision API request with all images
    const systemPrompt = `You are an expert at comparing and ranking images for quality and prompt adherence.

Your task is to rank ${images.length} images (labeled ${labels.join(', ')}) based on how well they match the given prompt.

Consider:
1. Content alignment: Does the image contain what the prompt asks for?
2. Aesthetic quality: Composition, lighting, color, technical execution
3. Prompt adherence: How closely does it follow the specific details?

Output format (JSON):
{
  "rankings": [
    {
      "imageLabel": "<letter A-${labels[labels.length - 1]}>",
      "rank": <1 for best, ${images.length} for worst>,
      "reason": "Specific comparative reason (e.g., 'Image A has clouds as requested, better composition than B')",
      "strengths": ["what this image does well"],
      "weaknesses": ["what could be improved"],
      "improvementSuggestion": "Specific actionable improvement for the prompt"
    },
    ...
  ]
}

IMPORTANT:
- Reference images by their letter labels (${labels.join(', ')})
- Provide COMPARATIVE reasons (reference what makes this better/worse than others)
- Rank ALL ${images.length} images
- Use ranks 1 through ${images.length} exactly once each
- For EACH image, provide strengths, weaknesses, and improvement suggestions`;

    const userPrompt = `Prompt: "${prompt}"

The images are labeled in order: ${labels.join(', ')}. Please rank all ${images.length} images from best (rank 1) to worst (rank ${images.length}), with comparative reasons.`;

    // Build image content for vision API with labels
    const imageContent = shuffledImages.map((img) => ({
      type: 'image_url',
      image_url: { url: img.url }
    }));

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          ...imageContent
        ]
      }
    ];

    const result = await this._callVisionAPI(messages);

    // Map image labels back to candidateIds
    return result.rankings.map(r => ({
      candidateId: labelToCandidateId.get(r.imageLabel),
      rank: r.rank,
      reason: r.reason,
      strengths: r.strengths || [],
      weaknesses: r.weaknesses || [],
      improvementSuggestion: r.improvementSuggestion
    }));
  }

  /**
   * Rank images using pairwise comparisons with merge-sort (best for N > 4)
   * O(N log N) comparisons instead of O(N²)
   * @param {Array<{candidateId: number, url: string}>} images - Images to rank
   * @param {string} prompt - The prompt they should match
   * @param {Object} options - Ranking options
   * @returns {Promise<Array<{candidateId: number, rank: number, reason: string}>>}
   */
  async rankPairwise(images, prompt, _options = {}) {
    // Use merge sort to rank images with pairwise comparisons
    const sorted = await this._mergeSort(images, prompt);

    // Convert sorted array to rankings with reasons
    const rankings = sorted.map((item, index) => ({
      candidateId: item.candidateId,
      rank: index + 1,
      reason: item.reason || `Ranked ${index + 1} of ${images.length} through pairwise comparison`
    }));

    return rankings;
  }

  /**
   * Rank images using transitive inference to minimize comparisons
   * Uses all-pairs comparison for small N (≤8) to build complete graph
   * Uses tournament-style selection for larger N
   * @param {Array<{candidateId: number, url: string}>} images - Images to rank
   * @param {string} prompt - The prompt they should match
   * @param {Object} options - Ranking options
   * @param {number} options.keepTop - Number of top candidates needed
   * @param {number} options.ensembleSize - Number of votes per comparison
   * @param {Array<{winnerId: string, loserId: string}>} [options.knownComparisons] - Pre-existing comparison results to skip
   * @returns {Promise<Array<{candidateId: number, rank: number, reason: string}>>}
   */
  async rankPairwiseTransitive(images, prompt, options = {}) {
    const knownComparisons = options.knownComparisons || [];

    // Comparison graph: tracks A > B relationships and infers transitivity
    const graph = new ComparisonGraph();

    // Pre-populate graph with known comparisons (e.g., from previous iteration's ranking)
    // This avoids re-comparing parents that were already ranked
    for (const { winnerId, loserId } of knownComparisons) {
      graph.recordComparison(winnerId, loserId, 'A');  // A=winner format
    }

    // Choose strategy: all-pairs for small N, tournament for large N
    const useAllPairs = images.length <= 8;

    if (useAllPairs) {
      // All-pairs: compare all unique pairs upfront for complete graph
      // Benefit: Fully leverages transitivity, better for ensemble voting
      // Cost: C(N,2) = N*(N-1)/2 comparisons, but more comprehensive
      const ranked = [];
      const remaining = [...images];

      // Rank ALL candidates through complete transitivity hierarchy
      // This ensures every image has a definitive rank relative to all others
      for (let rank = 1; rank <= images.length; rank++) {
        if (remaining.length === 0) break;

        if (remaining.length === 1) {
          ranked.push({
            candidateId: remaining[0].candidateId,
            rank,
            reason: 'Last remaining candidate'
          });
          break;
        }

        // For first rank, do all-pairs to build complete graph
        if (rank === 1) {
          const allPairsRanked = await this._rankAllPairsOptimal(remaining, prompt, graph, options);
          const winner = allPairsRanked[0];
          ranked.push({
            candidateId: winner.candidateId,
            rank,
            reason: `Best candidate (${winner.wins} wins in all-pairs comparison)`
          });
          const winnerIdx = remaining.findIndex(img => img.candidateId === winner.candidateId);
          remaining.splice(winnerIdx, 1);
        } else {
          // For subsequent ranks, use transitivity from complete graph
          const allPairsRanked = await this._rankAllPairsOptimal(remaining, prompt, graph, options);
          const winner = allPairsRanked[0];
          ranked.push({
            candidateId: winner.candidateId,
            rank,
            reason: `Best remaining candidate (${winner.wins} wins)`
          });
          const winnerIdx = remaining.findIndex(img => img.candidateId === winner.candidateId);
          remaining.splice(winnerIdx, 1);
        }
      }

      return ranked;
    } else {
      // Tournament-style selection - rank ALL candidates for complete hierarchy
      const ranked = [];
      const remaining = [...images];

      // Rank ALL candidates so every image is in the final hierarchy
      for (let rank = 1; rank <= images.length; rank++) {
        if (remaining.length === 0) break;

        if (remaining.length === 1) {
          ranked.push({
            candidateId: remaining[0].candidateId,
            rank,
            reason: 'Last remaining candidate'
          });
          break;
        }

        const { winner, reason, ranks, strengths, weaknesses } = await this._findBestWithTransitivity(remaining, prompt, graph, options);

        ranked.push({
          candidateId: winner.candidateId,
          rank,
          reason,
          ranks,
          strengths,
          weaknesses
        });

        const winnerIdx = remaining.findIndex(img => img.candidateId === winner.candidateId);
        remaining.splice(winnerIdx, 1);
      }

      return ranked;
    }
  }

  /**
   * Find the best candidate among a set using transitivity to minimize comparisons
   * @private
   * @param {Array} candidates - Candidates to evaluate
   * @param {string} prompt - Prompt for comparison
   * @param {ComparisonGraph} graph - Comparison graph for transitivity
   * @param {Object} options - Options including ensembleSize
   * @returns {Promise<{winner: Object, reason: string, ranks: Object, strengths: string[], weaknesses: string[]}>}
   */
  async _findBestWithTransitivity(candidates, prompt, graph, options = {}) {
    if (candidates.length === 1) {
      return { winner: candidates[0], reason: 'Only candidate', strengths: [], weaknesses: [] };
    }

    // Tournament: compare pairs, track results
    let champion = candidates[0];
    let championReason = 'Initial candidate';
    let championRanks = null;
    let championStrengths = [];
    let championWeaknesses = [];

    for (let i = 1; i < candidates.length; i++) {
      const challenger = candidates[i];

      // Check if we can infer winner from transitivity
      const inferred = graph.canInferWinner(champion.candidateId, challenger.candidateId);

      if (inferred) {
        // Use transitive inference (no API call needed!)
        if (inferred.winner === champion.candidateId) {
          championReason = `Better than candidate ${challenger.candidateId} (inferred via transitivity)`;
        } else {
          champion = challenger;
          championReason = 'Better than previous champion (inferred via transitivity)';
          // Reset feedback for new champion (no direct comparison data available)
          championStrengths = [];
          championWeaknesses = [];
        }
      } else {
        // Need to compare directly (with ensemble voting for reliability)
        try {
          const comparison = await this.compareWithEnsemble(champion, challenger, prompt, options);

          // Record comparison in graph
          graph.recordComparison(champion.candidateId, challenger.candidateId, comparison.winner);

          if (comparison.winner === 'A') {
            championReason = comparison.reason;
            // Store winner's ranks and feedback
            championRanks = comparison.aggregatedRanks?.A || comparison.ranks?.A;
            championStrengths = comparison.aggregatedFeedback?.A?.strengths || [];
            championWeaknesses = comparison.aggregatedFeedback?.A?.weaknesses || [];
          } else {
            champion = challenger;
            championReason = comparison.reason;
            // Store winner's ranks and feedback
            championRanks = comparison.aggregatedRanks?.B || comparison.ranks?.B;
            championStrengths = comparison.aggregatedFeedback?.B?.strengths || [];
            championWeaknesses = comparison.aggregatedFeedback?.B?.weaknesses || [];
          }
        } catch (error) {
          // If comparison fails, record error and keep current champion
          this.recordError({
            message: error.message,
            type: 'comparison_failure',
            candidateA: champion.candidateId,
            candidateB: challenger.candidateId,
            fatal: false
          });
          championReason = `Comparison with ${challenger.candidateId} failed, keeping current champion`;
        }
      }
    }

    return {
      winner: champion,
      reason: championReason,
      ranks: championRanks,
      strengths: championStrengths,
      weaknesses: championWeaknesses
    };
  }

  /**
   * Rank candidates using all-pairs comparison with complete transitivity graph
   * More efficient for ensemble voting and leverages transitivity fully
   * @private
   * @param {Array} candidates - Candidates to rank
   * @param {string} prompt - Prompt for comparison
   * @param {ComparisonGraph} graph - Graph to populate with all comparisons
   * @param {Object} options - Options including ensembleSize, keepTop
   * @returns {Promise<Array>} Ranked candidates with win counts
   */
  async _rankAllPairsOptimal(candidates, prompt, graph, options = {}) {
    if (candidates.length <= 1) {
      return candidates.map(c => ({ ...c, wins: 0 }));
    }

    // Generate all unique pairs
    const pairs = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        pairs.push({ a: candidates[i], b: candidates[j], aIdx: i, bIdx: j });
      }
    }

    // Compare all pairs (with ensemble if specified)
    const winCounts = new Map(candidates.map(c => [c.candidateId, 0]));
    const totalPairs = pairs.length;
    let completedPairs = 0;

    for (const { a, b } of pairs) {
      // Skip if already compared
      if (graph.canInferWinner(a.candidateId, b.candidateId)) {
        // Use inferred result
        const inferred = graph.canInferWinner(a.candidateId, b.candidateId);
        if (inferred.winner === a.candidateId) {
          winCounts.set(a.candidateId, (winCounts.get(a.candidateId) || 0) + 1);
        } else {
          winCounts.set(b.candidateId, (winCounts.get(b.candidateId) || 0) + 1);
        }
        completedPairs++;

        // Report progress (inferred comparison)
        if (options.onProgress) {
          options.onProgress({
            type: 'comparison',
            completed: completedPairs,
            total: totalPairs,
            candidateA: a.candidateId,
            candidateB: b.candidateId,
            inferred: true
          });
        }
      } else {
        // New comparison needed - handle errors gracefully
        try {
          const comparison = await this.compareWithEnsemble(a, b, prompt, options);
          graph.recordComparison(a.candidateId, b.candidateId, comparison.winner);

          if (comparison.winner === 'A') {
            winCounts.set(a.candidateId, (winCounts.get(a.candidateId) || 0) + 1);
          } else {
            winCounts.set(b.candidateId, (winCounts.get(b.candidateId) || 0) + 1);
          }
          completedPairs++;

          // Report progress (actual comparison)
          if (options.onProgress) {
            options.onProgress({
              type: 'comparison',
              completed: completedPairs,
              total: totalPairs,
              candidateA: a.candidateId,
              candidateB: b.candidateId,
              winner: comparison.winner === 'A' ? a.candidateId : b.candidateId,
              inferred: false
            });
          }
        } catch (error) {
          // Record error but continue with remaining comparisons
          this.recordError({
            message: error.message,
            type: 'comparison_failure',
            candidateA: a.candidateId,
            candidateB: b.candidateId,
            fatal: false
          });
          completedPairs++;

          // Report progress (failed comparison)
          if (options.onProgress) {
            options.onProgress({
              type: 'comparison',
              completed: completedPairs,
              total: totalPairs,
              candidateA: a.candidateId,
              candidateB: b.candidateId,
              error: true
            });
          }
          // Skip this pair - don't record any wins for failed comparisons
        }
      }
    }

    // Rank candidates by win count (descending)
    return candidates
      .map(c => ({ ...c, wins: winCounts.get(c.candidateId) || 0 }))
      .sort((a, b) => b.wins - a.wins);
  }

  /**
   * Merge sort using pairwise image comparisons
   * @private
   * @param {Array} images - Images to sort
   * @param {string} prompt - Prompt for comparison context
   * @returns {Promise<Array>} Sorted images (best to worst)
   */
  async _mergeSort(images, prompt) {
    if (images.length <= 1) {
      return images;
    }

    const mid = Math.floor(images.length / 2);
    const left = await this._mergeSort(images.slice(0, mid), prompt);
    const right = await this._mergeSort(images.slice(mid), prompt);

    return this._merge(left, right, prompt);
  }

  /**
   * Merge two sorted arrays using pairwise comparisons
   * @private
   */
  async _merge(left, right, prompt) {
    const result = [];
    let i = 0;
    let j = 0;

    while (i < left.length && j < right.length) {
      const comparison = await this.compareTwo(left[i], right[j], prompt);

      if (comparison.winner === 'A') {
        result.push({ ...left[i], reason: comparison.reason });
        i++;
      } else {
        result.push({ ...right[j], reason: comparison.reason });
        j++;
      }
    }

    // Add remaining elements
    while (i < left.length) {
      result.push(left[i]);
      i++;
    }

    while (j < right.length) {
      result.push(right[j]);
      j++;
    }

    return result;
  }

  /**
   * Compare two images with ensemble voting for reliability
   * Calls vision API multiple times in PARALLEL and uses majority vote
   * Aggregates multi-factor ranks across all votes:
   * 1. Average alignment ranks across all votes
   * 2. Average aesthetics ranks across all votes
   * 3. Combine averaged dimensions into final ranking
   * @param {{candidateId: number, url: string}} imageA - First image
   * @param {{candidateId: number, url: string}} imageB - Second image
   * @param {string} prompt - The prompt they should match
   * @param {Object} options - Options
   * @param {number} [options.ensembleSize] - Number of comparisons to make
   * @returns {Promise<{winner: string, votes: {A: number, B: number}, confidence: number, reason: string, aggregatedRanks: Object}>}
   */
  async compareWithEnsemble(imageA, imageB, prompt, options = {}) {
    const ensembleSize = options.ensembleSize || this.defaultEnsembleSize;
    const votes = { A: 0, B: 0 };
    let lastReason = '';

    // Accumulate ranks for averaging (per-dimension, combined calculated AFTER averaging)
    const rankAccumulators = {
      A: { alignment: 0, aesthetics: 0 },
      B: { alignment: 0, aesthetics: 0 }
    };

    // Collect strengths/weaknesses across comparisons (use Sets to deduplicate)
    const strengthsA = new Set();
    const strengthsB = new Set();
    const weaknessesA = new Set();
    const weaknessesB = new Set();

    // PARALLELIZATION: Prepare all comparison promises with swap info
    const comparisonPromises = [];
    const swapInfo = [];

    for (let i = 0; i < ensembleSize; i++) {
      // Randomize order for this comparison to reduce bias
      const shouldSwap = Math.random() < 0.5;
      const [firstImage, secondImage] = shouldSwap
        ? [imageB, imageA]
        : [imageA, imageB];

      comparisonPromises.push(
        this.compareTwo(firstImage, secondImage, prompt, {
          temperature: this.ensembleTemperature
        })
      );
      swapInfo.push(shouldSwap);
    }

    // Execute all comparisons in parallel
    const results = await Promise.all(comparisonPromises);

    // Process results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const shouldSwap = swapInfo[i];

      // Map result back to original imageA/imageB
      // Winner 'A' in response refers to firstImage, 'B' refers to secondImage
      let actualWinner;
      if (result.winner === 'A') {
        actualWinner = shouldSwap ? 'B' : 'A'; // First was imageB : imageA
      } else if (result.winner === 'B') {
        actualWinner = shouldSwap ? 'A' : 'B'; // Second was imageA : imageB
      } else {
        actualWinner = 'tie';
      }

      if (actualWinner === 'A') {
        votes.A++;
        // A won: A's strengths are winner strengths, B's weaknesses are loser weaknesses
        (result.winnerStrengths || []).forEach(s => strengthsA.add(s));
        (result.loserWeaknesses || []).forEach(w => weaknessesB.add(w));
      } else if (actualWinner === 'B') {
        votes.B++;
        // B won: B's strengths are winner strengths, A's weaknesses are loser weaknesses
        (result.winnerStrengths || []).forEach(s => strengthsB.add(s));
        (result.loserWeaknesses || []).forEach(w => weaknessesA.add(w));
      }

      // Accumulate individual dimension ranks (need to map back if swapped)
      if (result.ranks) {
        if (shouldSwap) {
          // Result.ranks.A refers to firstImage which is imageB
          rankAccumulators.B.alignment += result.ranks.A?.alignment || 0;
          rankAccumulators.B.aesthetics += result.ranks.A?.aesthetics || 0;
          rankAccumulators.A.alignment += result.ranks.B?.alignment || 0;
          rankAccumulators.A.aesthetics += result.ranks.B?.aesthetics || 0;
        } else {
          // Result.ranks.A refers to firstImage which is imageA
          rankAccumulators.A.alignment += result.ranks.A?.alignment || 0;
          rankAccumulators.A.aesthetics += result.ranks.A?.aesthetics || 0;
          rankAccumulators.B.alignment += result.ranks.B?.alignment || 0;
          rankAccumulators.B.aesthetics += result.ranks.B?.aesthetics || 0;
        }
      }

      // Track last reason for reporting
      lastReason = result.reason;
    }

    // Determine winner by majority
    let winner;
    if (votes.A > votes.B) {
      winner = 'A';
    } else if (votes.B > votes.A) {
      winner = 'B';
    } else {
      // Tie: prefer first image (A) with low confidence
      winner = 'A';
    }

    // Confidence = majority votes / total votes
    const majorityVotes = Math.max(votes.A, votes.B);
    const confidence = ensembleSize > 0 ? majorityVotes / ensembleSize : 0;

    // Step 1: Average each dimension's ranks across all votes
    const avgAlignmentA = ensembleSize > 0 ? rankAccumulators.A.alignment / ensembleSize : 0;
    const avgAestheticsA = ensembleSize > 0 ? rankAccumulators.A.aesthetics / ensembleSize : 0;
    const avgAlignmentB = ensembleSize > 0 ? rankAccumulators.B.alignment / ensembleSize : 0;
    const avgAestheticsB = ensembleSize > 0 ? rankAccumulators.B.aesthetics / ensembleSize : 0;

    // Step 2: Apply alpha weighting to averaged dimension ranks
    // This is more nuanced than averaging pre-combined scores
    const aggregatedRanks = {
      A: {
        alignment: avgAlignmentA,
        aesthetics: avgAestheticsA,
        combined: this._calculateCombinedRank({ alignment: avgAlignmentA, aesthetics: avgAestheticsA })
      },
      B: {
        alignment: avgAlignmentB,
        aesthetics: avgAestheticsB,
        combined: this._calculateCombinedRank({ alignment: avgAlignmentB, aesthetics: avgAestheticsB })
      }
    };

    // Aggregate strengths/weaknesses per candidate
    const aggregatedFeedback = {
      A: { strengths: [...strengthsA], weaknesses: [...weaknessesA] },
      B: { strengths: [...strengthsB], weaknesses: [...weaknessesB] }
    };

    return {
      winner,
      votes,
      confidence,
      reason: lastReason,
      aggregatedRanks,
      aggregatedFeedback
    };
  }

  /**
   * Compare two images and determine which is better
   * Returns multi-factor RANKS (1 or 2) and combined weighted rank score
   * Lower combined rank score wins (rank 1 is better than rank 2)
   * @param {{candidateId: number, url: string}} imageA - First image
   * @param {{candidateId: number, url: string}} imageB - Second image
   * @param {string} prompt - The prompt they should match
   * @returns {Promise<{winner: string, reason: string, ranks: Object, winnerStrengths: string[], loserWeaknesses: string[]}>}
   */
  async compareTwo(imageA, imageB, prompt, options = {}) {
    const systemPrompt = `You are an expert at comparing images for quality and prompt adherence.

Your task is to compare two images (A and B) and RANK them on multiple factors.

For each factor, assign rank 1 (better) or rank 2 (worse):
1. alignment: Which image better matches the prompt content and requirements?
2. aesthetics: Which image has better technical quality - composition, lighting, color, clarity?

Output format (JSON):
{
  "winner": "A" | "B" | "tie",
  "reason": "Specific reason explaining the decision, mentioning alignment (prompt match) and aesthetic quality differences",
  "ranks": {
    "A": { "alignment": <1 or 2>, "aesthetics": <1 or 2> },
    "B": { "alignment": <1 or 2>, "aesthetics": <1 or 2> }
  },
  "winnerStrengths": ["strength 1", "strength 2"],
  "loserWeaknesses": ["weakness 1", "weakness 2"]
}

Important:
- For each factor, one image gets rank 1, the other gets rank 2
- If truly equal on a factor, both can get rank 1
- Winner is determined by weighted combination (alignment weighted higher)
- Reference both alignment and aesthetics in your reason`;

    const userPrompt = `Prompt: "${prompt}"

Compare images A and B. Rank both on alignment (prompt match) and aesthetics (visual quality). Use rank 1 for better, rank 2 for worse.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageA.url } },
          { type: 'image_url', image_url: { url: imageB.url } }
        ]
      }
    ];

    const temperature = options.temperature !== undefined ? options.temperature : this.defaultTemperature;
    const result = await this._callVisionAPI(messages, { temperature });

    // Get ranks from result, with sensible defaults
    const ranks = result.ranks || {
      A: { alignment: 1, aesthetics: 1 },
      B: { alignment: 2, aesthetics: 2 }
    };

    // Calculate combined rank score (lower is better)
    ranks.A.combined = this._calculateCombinedRank(ranks.A);
    ranks.B.combined = this._calculateCombinedRank(ranks.B);

    // Determine winner based on combined rank score (lower wins)
    let winner = result.winner;
    if (ranks.A.combined < ranks.B.combined) {
      winner = 'A';
    } else if (ranks.B.combined < ranks.A.combined) {
      winner = 'B';
    }

    return {
      winner,
      reason: result.reason,
      ranks,
      winnerStrengths: result.winnerStrengths || [],
      loserWeaknesses: result.loserWeaknesses || []
    };
  }

  /**
   * Calculate combined rank score from alignment and aesthetics ranks
   * Lower combined score is better (rank 1 is better than rank 2)
   * @private
   */
  _calculateCombinedRank(imageRanks) {
    const alignWeight = this.alignmentWeight;
    const aestheticWeight = 1 - alignWeight;
    return (alignWeight * imageRanks.alignment) + (aestheticWeight * imageRanks.aesthetics);
  }

  /**
   * Call OpenAI vision API with JSON response format
   * @private
   * @param {Array} messages - Messages array for API
   * @param {Object} options - API options
   * @param {number} [options.temperature] - Temperature for response variance
   * @returns {Promise<Object>} Parsed JSON response
   */
  async _callVisionAPI(messages, options = {}) {
    // Model-aware parameters (gpt-5 vs others)
    const isGpt5 = this.model.includes('gpt-5');
    const tokenParam = isGpt5 ? 'max_completion_tokens' : 'max_tokens';

    const requestParams = {
      model: this.model,
      messages,
      response_format: { type: 'json_object' }
    };

    // Add temperature only for non-gpt-5 models
    if (!isGpt5) {
      const temperature = options.temperature !== undefined ? options.temperature : this.defaultTemperature;
      requestParams.temperature = temperature;
    }

    // Token limit
    requestParams[tokenParam] = isGpt5 ? 4000 : 1000;

    const completion = await this.client.chat.completions.create(requestParams);

    // Track token usage for cost monitoring
    if (completion.usage) {
      this.accumulatedTokens += completion.usage.total_tokens || 0;
    }

    // Validate response structure with detailed error diagnostics
    if (!completion.choices || completion.choices.length === 0) {
      throw new Error(
        `Vision API returned no choices. Model: ${this.model}, Finish reason: ${completion.choices?.[0]?.finish_reason || 'none'}`
      );
    }

    const message = completion.choices[0].message;
    if (!message || !message.content) {
      throw new Error(
        `Vision API returned empty content. Model: ${this.model}, Finish reason: ${completion.choices[0].finish_reason}, Refusal: ${message?.refusal || 'none'}`
      );
    }

    const responseText = message.content.trim();

    // Validate that we got a non-empty response after trimming
    if (!responseText) {
      throw new Error(
        `Vision API returned empty response after trimming. Model: ${this.model}, Original length: ${message.content.length}, Finish reason: ${completion.choices[0].finish_reason}`
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse vision API JSON response:', responseText);
      throw new Error(`Failed to parse vision response: ${parseError.message}`);
    }

    return parsed;
  }

  /**
   * Get accumulated token usage from ranking operations
   * @returns {number} Total tokens used
   */
  getAccumulatedTokens() {
    return this.accumulatedTokens;
  }

  /**
   * Reset accumulated token counter
   */
  resetTokenCount() {
    this.accumulatedTokens = 0;
  }

  /**
   * Record an error for graceful degradation
   * @param {Object} error - Error information
   */
  recordError(error) {
    this.errors.push({
      ...error,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Reset error tracking
   */
  resetErrors() {
    this.errors = [];
  }
}

/**
 * Comparison Graph for transitive inference
 * Tracks A > B relationships and infers A > C when A > B and B > C
 */
class ComparisonGraph {
  constructor() {
    // Map: candidateId → Set of candidateIds it beats
    this.beats = new Map();
    // Map: candidateId → Set of candidateIds it loses to
    this.losesTo = new Map();
  }

  /**
   * Record a comparison result
   * @param {number} idA - First candidate ID
   * @param {number} idB - Second candidate ID
   * @param {string} winner - 'A' or 'B'
   */
  recordComparison(idA, idB, winner) {
    const winnerId = winner === 'A' ? idA : idB;
    const loserId = winner === 'A' ? idB : idA;

    // Direct relationship
    if (!this.beats.has(winnerId)) this.beats.set(winnerId, new Set());
    if (!this.losesTo.has(loserId)) this.losesTo.set(loserId, new Set());

    this.beats.get(winnerId).add(loserId);
    this.losesTo.get(loserId).add(winnerId);

    // Transitive closure: if A > B and B > C, then A > C
    this._propagateTransitivity(winnerId, loserId);
  }

  /**
   * Propagate transitive relationships after a new comparison
   * @private
   * @param {number} winnerId - Winner of comparison
   * @param {number} loserId - Loser of comparison
   */
  _propagateTransitivity(winnerId, loserId) {
    // All candidates that beat winner also beat loser
    const beatWinner = this.losesTo.get(winnerId) || new Set();
    for (const superiorId of beatWinner) {
      if (!this.beats.has(superiorId)) this.beats.set(superiorId, new Set());
      this.beats.get(superiorId).add(loserId);

      if (!this.losesTo.has(loserId)) this.losesTo.set(loserId, new Set());
      this.losesTo.get(loserId).add(superiorId);
    }

    // Winner beats all candidates that loser beats
    const loserBeats = this.beats.get(loserId) || new Set();
    for (const inferiorId of loserBeats) {
      if (!this.beats.has(winnerId)) this.beats.set(winnerId, new Set());
      this.beats.get(winnerId).add(inferiorId);

      if (!this.losesTo.has(inferiorId)) this.losesTo.set(inferiorId, new Set());
      this.losesTo.get(inferiorId).add(winnerId);
    }
  }

  /**
   * Check if we can infer winner from existing comparisons
   * @param {number} idA - First candidate ID
   * @param {number} idB - Second candidate ID
   * @returns {{winner: number, inferred: boolean} | null}
   */
  canInferWinner(idA, idB) {
    // Check if A beats B
    if (this.beats.has(idA) && this.beats.get(idA).has(idB)) {
      return { winner: idA, inferred: true };
    }

    // Check if B beats A
    if (this.beats.has(idB) && this.beats.get(idB).has(idA)) {
      return { winner: idB, inferred: true };
    }

    // Cannot infer
    return null;
  }
}

module.exports = ImageRanker;
