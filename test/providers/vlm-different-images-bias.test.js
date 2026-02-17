/**
 * VLM Position Bias Test - Different Images
 *
 * Tests whether VLM chooses based on image content/quality OR position.
 *
 * Test scenarios:
 * 1. Alignment: Cat vs Dog with prompts favoring each animal
 * 2. Aesthetics: Good quality vs Poor quality images
 *
 * Expected behavior (NO position bias):
 * - Cat image should win when prompt is "a cat photograph"
 * - Dog image should win when prompt is "a dog photograph"
 * - Good quality image should win aesthetic comparison
 * - Position (A vs B) should NOT matter
 *
 * Position bias indicator:
 * - If B wins regardless of content/quality → strong position bias
 * - If choice varies with position but not content → position bias
 */

const test = require('node:test');
const path = require('node:path');
const LocalVLMProvider = require('../../src/providers/local-vlm-provider');

// Test images
const CAT_IMAGE = path.join(__dirname, '../fixtures/images/cat.jpg');
const DOG_IMAGE = path.join(__dirname, '../fixtures/images/sharp-dog.jpg');
const GOOD_IMAGE = path.join(__dirname, '../fixtures/images/aesthetic-good.jpg');
const POOR_IMAGE = path.join(__dirname, '../fixtures/images/aesthetic-poor.jpg');

const VLM_API_URL = process.env.VLM_API_URL || 'http://localhost:8004';
const TEST_TIMEOUT = 60000;

test('Alignment test: Cat vs Dog - cat prompt, both positions', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 30000,
    ensembleSize: 1
  });

  const prompt = 'a cat photograph';

  console.log('\n[Alignment Test 1] Cat vs Dog with "a cat" prompt');
  console.log('Expected: Cat should win (position should not matter)\n');

  // Test 1: Cat in position A, Dog in position B
  console.log('Test 1a: Cat=A, Dog=B');
  const result1 = await provider.compareImages(CAT_IMAGE, DOG_IMAGE, prompt);
  console.log(`  Raw VLM: choice=${result1.choice}, ranks: Cat(A)=[${result1.ranks.A.alignment},${result1.ranks.A.aesthetics}], Dog(B)=[${result1.ranks.B.alignment},${result1.ranks.B.aesthetics}]`);

  // Test 2: Dog in position A, Cat in position B
  console.log('Test 1b: Dog=A, Cat=B');
  const result2 = await provider.compareImages(DOG_IMAGE, CAT_IMAGE, prompt);
  console.log(`  Raw VLM: choice=${result2.choice}, ranks: Dog(A)=[${result2.ranks.A.alignment},${result2.ranks.A.aesthetics}], Cat(B)=[${result2.ranks.B.alignment},${result2.ranks.B.aesthetics}]`);

  // Analysis
  console.log('\nAnalysis:');
  if (result1.choice === 'A' && result2.choice === 'B') {
    console.log('  ✓ GOOD: Cat won in both positions (content-based choice)');
  } else if (result1.choice === 'B' && result2.choice === 'B') {
    console.log('  ✗ POSITION BIAS: B won in both cases regardless of which animal was in B position');
  } else if (result1.choice === 'A' && result2.choice === 'A') {
    console.log('  ✗ POSITION BIAS: A won in both cases regardless of which animal was in A position');
  } else {
    console.log(`  ? MIXED: Test1=${result1.choice}, Test2=${result2.choice} (TIE or inconsistent)`);
  }

  // Store results for later assertion
  return { result1, result2 };
});

test('Alignment test: Cat vs Dog - dog prompt, both positions', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 30000,
    ensembleSize: 1
  });

  const prompt = 'a dog photograph';

  console.log('\n[Alignment Test 2] Cat vs Dog with "a dog" prompt');
  console.log('Expected: Dog should win (position should not matter)\n');

  // Test 1: Cat in position A, Dog in position B
  console.log('Test 2a: Cat=A, Dog=B');
  const result1 = await provider.compareImages(CAT_IMAGE, DOG_IMAGE, prompt);
  console.log(`  Raw VLM: choice=${result1.choice}, ranks: Cat(A)=[${result1.ranks.A.alignment},${result1.ranks.A.aesthetics}], Dog(B)=[${result1.ranks.B.alignment},${result1.ranks.B.aesthetics}]`);

  // Test 2: Dog in position A, Cat in position B
  console.log('Test 2b: Dog=A, Cat=B');
  const result2 = await provider.compareImages(DOG_IMAGE, CAT_IMAGE, prompt);
  console.log(`  Raw VLM: choice=${result2.choice}, ranks: Dog(A)=[${result2.ranks.A.alignment},${result2.ranks.A.aesthetics}], Cat(B)=[${result2.ranks.B.alignment},${result2.ranks.B.aesthetics}]`);

  // Analysis
  console.log('\nAnalysis:');
  if (result1.choice === 'B' && result2.choice === 'A') {
    console.log('  ✓ GOOD: Dog won in both positions (content-based choice)');
  } else if (result1.choice === 'B' && result2.choice === 'B') {
    console.log('  ✗ POSITION BIAS: B won in both cases regardless of which animal was in B position');
  } else if (result1.choice === 'A' && result2.choice === 'A') {
    console.log('  ✗ POSITION BIAS: A won in both cases regardless of which animal was in A position');
  } else {
    console.log(`  ? MIXED: Test1=${result1.choice}, Test2=${result2.choice} (TIE or inconsistent)`);
  }

  return { result1, result2 };
});

test('Aesthetic test: Good vs Poor quality, both positions', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 30000,
    ensembleSize: 1
  });

  const prompt = 'a photograph';  // Neutral prompt for aesthetic comparison

  console.log('\n[Aesthetic Test] Good vs Poor quality images');
  console.log('Expected: Good quality should win (position should not matter)\n');

  // Test 1: Good in position A, Poor in position B
  console.log('Test 3a: Good=A, Poor=B');
  const result1 = await provider.compareImages(GOOD_IMAGE, POOR_IMAGE, prompt);
  console.log(`  Raw VLM: choice=${result1.choice}, ranks: Good(A)=[${result1.ranks.A.alignment},${result1.ranks.A.aesthetics}], Poor(B)=[${result1.ranks.B.alignment},${result1.ranks.B.aesthetics}]`);

  // Test 2: Poor in position A, Good in position B
  console.log('Test 3b: Poor=A, Good=B');
  const result2 = await provider.compareImages(POOR_IMAGE, GOOD_IMAGE, prompt);
  console.log(`  Raw VLM: choice=${result2.choice}, ranks: Poor(A)=[${result2.ranks.A.alignment},${result2.ranks.A.aesthetics}], Good(B)=[${result2.ranks.B.alignment},${result2.ranks.B.aesthetics}]`);

  // Analysis
  console.log('\nAnalysis:');
  if (result1.choice === 'A' && result2.choice === 'B') {
    console.log('  ✓ GOOD: Good quality won in both positions (quality-based choice)');
  } else if (result1.choice === 'B' && result2.choice === 'B') {
    console.log('  ✗ POSITION BIAS: B won in both cases regardless of which image quality was in B position');
  } else if (result1.choice === 'A' && result2.choice === 'A') {
    console.log('  ✗ POSITION BIAS: A won in both cases regardless of which image quality was in A position');
  } else {
    console.log(`  ? MIXED: Test1=${result1.choice}, Test2=${result2.choice} (TIE or inconsistent)`);
  }

  return { result1, result2 };
});

test('Summary: Position bias detection across all tests', { timeout: 5000 }, async () => {
  console.log('\n' + '='.repeat(70));
  console.log('POSITION BIAS SUMMARY');
  console.log('='.repeat(70));
  console.log('\nCheck the analysis output above for each test.');
  console.log('\nIf you see "✗ POSITION BIAS" in multiple tests, the VLM has');
  console.log('a systematic preference for position A or B regardless of content.');
  console.log('\nExpected behavior: VLM should choose based on:');
  console.log('  - Alignment tests: Which image matches the prompt');
  console.log('  - Aesthetic tests: Which image has better visual quality');
  console.log('  - Position should NOT influence the choice');
  console.log('='.repeat(70) + '\n');
});
