/**
 * VLM Ensemble Voting Bias Test
 *
 * Tests whether ensemble voting (ensembleSize=3) introduces or amplifies position bias
 * This is the production configuration, so it's critical to test.
 */

const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const LocalVLMProvider = require('../../src/providers/local-vlm-provider');

const CAT_IMAGE = path.join(__dirname, '../fixtures/images/cat.jpg');
const DOG_IMAGE = path.join(__dirname, '../fixtures/images/sharp-dog.jpg');
const SHARP_DOG = path.join(__dirname, '../fixtures/images/sharp-dog.jpg');
const BLURRY_DOG = path.join(__dirname, '../fixtures/images/blurry-dog.jpg');

const VLM_API_URL = process.env.VLM_API_URL || 'http://localhost:8004';
const TEST_TIMEOUT = 120000; // 2 minutes for ensemble (3x comparisons)

test('Ensemble voting: Cat vs Dog with cat prompt', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 60000,
    ensembleSize: 3  // Production default
  });

  const prompt = 'a cat photograph';

  console.log('\n[Ensemble Test 1] Cat vs Dog with cat prompt (ensembleSize=3)');
  console.log('Expected: Cat should win regardless of position\n');

  // Test 1: Cat in A, Dog in B
  console.log('Test 1a: Cat=A, Dog=B (ensemble voting)');
  const result1 = await provider.compareWithEnsemble(CAT_IMAGE, DOG_IMAGE, prompt);
  console.log(`  Final: choice=${result1.choice}`);
  console.log(`  Votes: A=${result1.votes?.A || 'N/A'}, B=${result1.votes?.B || 'N/A'}, TIE=${result1.votes?.TIE || 'N/A'}`);
  console.log(`  Combined ranks: A=${result1.aggregatedRanks?.A?.combined?.toFixed(2)}, B=${result1.aggregatedRanks?.B?.combined?.toFixed(2)}`);

  // Test 2: Dog in A, Cat in B
  console.log('\nTest 1b: Dog=A, Cat=B (ensemble voting)');
  const result2 = await provider.compareWithEnsemble(DOG_IMAGE, CAT_IMAGE, prompt);
  console.log(`  Final: choice=${result2.choice}`);
  console.log(`  Votes: A=${result2.votes?.A || 'N/A'}, B=${result2.votes?.B || 'N/A'}, TIE=${result2.votes?.TIE || 'N/A'}`);
  console.log(`  Combined ranks: A=${result2.aggregatedRanks?.A?.combined?.toFixed(2)}, B=${result2.aggregatedRanks?.B?.combined?.toFixed(2)}`);

  // Analysis
  console.log('\nAnalysis:');
  const catWinsBoth = (result1.choice === 'A' && result2.choice === 'B');
  if (catWinsBoth) {
    console.log('  ✓ GOOD: Cat won in both positions (ensemble voting works correctly)');
  } else {
    console.log(`  ✗ BIAS: Ensemble voting shows position bias (Test1=${result1.choice}, Test2=${result2.choice})`);
  }
});

test('Ensemble voting: Sharp vs Blurry aesthetics', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 60000,
    ensembleSize: 3
  });

  console.log('\n[Ensemble Test 2] Sharp vs Blurry dog (ensembleSize=3, aesthetics)');
  console.log('Expected: Sharp should win regardless of position\n');

  // Test 1: Sharp in A, Blurry in B
  console.log('Test 2a: Sharp=A, Blurry=B (ensemble voting, aesthetics)');
  const result1 = await provider.compareWithEnsembleSeparate(
    { localPath: SHARP_DOG, candidateId: 'sharp' },
    { localPath: BLURRY_DOG, candidateId: 'blurry' },
    'a dog photograph'
  );
  console.log(`  Final: choice=${result1.choice}`);
  console.log(`  Votes: A=${result1.votes?.A || 'N/A'}, B=${result1.votes?.B || 'N/A'}, TIE=${result1.votes?.TIE || 'N/A'}`);
  console.log(`  Combined ranks: A=${result1.aggregatedRanks?.A?.combined?.toFixed(2)}, B=${result1.aggregatedRanks?.B?.combined?.toFixed(2)}`);

  // Test 2: Blurry in A, Sharp in B
  console.log('\nTest 2b: Blurry=A, Sharp=B (ensemble voting, aesthetics)');
  const result2 = await provider.compareWithEnsembleSeparate(
    { localPath: BLURRY_DOG, candidateId: 'blurry' },
    { localPath: SHARP_DOG, candidateId: 'sharp' },
    'a dog photograph'
  );
  console.log(`  Final: choice=${result2.choice}`);
  console.log(`  Votes: A=${result2.votes?.A || 'N/A'}, B=${result2.votes?.B || 'N/A'}, TIE=${result2.votes?.TIE || 'N/A'}`);
  console.log(`  Combined ranks: A=${result2.aggregatedRanks?.A?.combined?.toFixed(2)}, B=${result2.aggregatedRanks?.B?.combined?.toFixed(2)}`);

  // Analysis
  console.log('\nAnalysis:');
  const sharpWinsBoth = (result1.choice === 'A' && result2.choice === 'B');
  if (sharpWinsBoth) {
    console.log('  ✓ GOOD: Sharp won in both positions (ensemble voting works correctly)');
  } else {
    console.log(`  ✗ BIAS: Ensemble voting shows position bias (Test1=${result1.choice}, Test2=${result2.choice})`);
  }
});

test('Summary: Ensemble voting bias check', { timeout: 5000 }, async () => {
  console.log('\n' + '='.repeat(70));
  console.log('ENSEMBLE VOTING BIAS SUMMARY');
  console.log('='.repeat(70));
  console.log('\nEnsemble voting (ensembleSize=3) runs 3 comparisons with debiasing');
  console.log('and aggregates results via majority vote + averaged ranks.');
  console.log('\nIf ensemble voting works correctly:');
  console.log('  - Better image should win regardless of position');
  console.log('  - Vote distribution should favor the better image');
  console.log('  - Combined ranks should reflect image quality, not position');
  console.log('='.repeat(70) + '\n');
});
