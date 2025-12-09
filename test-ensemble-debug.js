/**
 * Debug script to verify ensemble and transitivity behavior
 */
const ImageRanker = require('./src/services/image-ranker.js');

async function debugTest() {
  console.log('='.repeat(60));
  console.log('🔬 Debugging Transitivity Inference');
  console.log('='.repeat(60));

  const ranker = new ImageRanker({
    apiKey: 'mock-key',
    defaultEnsembleSize: 1  // Keep it simple
  });

  let compareTwoCalls = 0;
  let transitivityInferred = 0;

  // Mock compareTwo
  ranker.compareTwo = async (imageA, imageB, _prompt) => {
    compareTwoCalls++;
    const winner = imageA.candidateId < imageB.candidateId ? 'A' : 'B';
    console.log('    [API CALL] ' + imageA.candidateId + ' vs ' + imageB.candidateId + ' → ' + winner + ' wins');
    return { winner, reason: 'test' };
  };

  // Patch _findBestWithTransitivity to see transitivity checks
  const original_findBest = ranker._findBestWithTransitivity.bind(ranker);
  ranker._findBestWithTransitivity = async (candidates, prompt, graph, options) => {
    console.log('\n  Finding best among: [' + candidates.map(c => c.candidateId).join(', ') + ']');

    // Patch canInferWinner on the graph to log calls
    const originalCanInfer = graph.canInferWinner.bind(graph);
    graph.canInferWinner = (idA, idB) => {
      const result = originalCanInfer(idA, idB);
      if (result) {
        transitivityInferred++;
        console.log('    [TRANSITIVITY] Inferred ' + result.winner + ' > ' + (result.winner === idA ? idB : idA) + ' (skipped API call!)');
      } else {
        console.log('    [CHECK] No inference for ' + idA + ' vs ' + idB + ', need API call');
      }
      return result;
    };

    return original_findBest(candidates, prompt, graph, options);
  };

  const images = [
    { candidateId: 0, url: 'http://image-0.png' },
    { candidateId: 1, url: 'http://image-1.png' },
    { candidateId: 2, url: 'http://image-2.png' },
    { candidateId: 3, url: 'http://image-3.png' }
  ];

  console.log('\n📊 Test: Ranking 4 images, keepTop=4 (full ranking)');
  const result = await ranker.rankImages(images, 'test prompt', { keepTop: 4 });

  console.log('\n' + '='.repeat(60));
  console.log('📈 Results:');
  console.log('='.repeat(60));
  console.log('  API calls made: ' + compareTwoCalls);
  console.log('  Transitivity inferences: ' + transitivityInferred);
  console.log('  Comparisons saved: ' + transitivityInferred + ' (via transitivity)');

  console.log('\n  Final Rankings:');
  result.forEach(r => {
    console.log('    Rank ' + r.rank + ': Candidate ' + r.candidateId);
  });

  // Without transitivity, full ranking of 4 items needs:
  // Round 1: 3 comparisons (champion vs 3 challengers)
  // Round 2: 2 comparisons (champion vs 2 challengers)
  // Round 3: 1 comparison (champion vs 1 challenger)
  // Total: 6 comparisons
  console.log('\n  Expected without transitivity: 6 comparisons');
  console.log('  Actual API calls: ' + compareTwoCalls);
  if (compareTwoCalls < 6) {
    console.log('  ✓ Transitivity saved ' + (6 - compareTwoCalls) + ' API calls!');
  } else {
    console.log('  ✗ No transitivity savings in this case (tournament pattern)');
  }
}

debugTest().catch(console.error);
