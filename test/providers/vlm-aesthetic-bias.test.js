/**
 * VLM Aesthetic Quality Test
 *
 * Tests whether VLM can distinguish image quality and whether
 * position bias affects aesthetic judgments.
 */

const test = require('node:test');
const path = require('node:path');
const LocalVLMProvider = require('../../src/providers/local-vlm-provider');

// Test images with clear quality differences
const SHARP_DOG = path.join(__dirname, '../fixtures/images/sharp-dog.jpg');
const BLURRY_DOG = path.join(__dirname, '../fixtures/images/blurry-dog.jpg');
const GOOD_IMAGE = path.join(__dirname, '../fixtures/images/aesthetic-good.jpg');
const POOR_IMAGE = path.join(__dirname, '../fixtures/images/aesthetic-poor.jpg');

const VLM_API_URL = process.env.VLM_API_URL || 'http://localhost:8004';
const TEST_TIMEOUT = 60000;

test('Aesthetic test: Sharp vs Blurry dog - aesthetics only', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 30000,
    ensembleSize: 1
  });

  console.log('\n[Aesthetic Test 1] Sharp vs Blurry dog - aesthetics only');
  console.log('Expected: Sharp dog should win (position should not matter)\n');

  // Test 1: Sharp in position A, Blurry in position B
  console.log('Test 1a: Sharp=A, Blurry=B (aesthetics only)');
  const result1 = await provider.compareImagesAesthetics(
    { localPath: SHARP_DOG, candidateId: 'sharp' },
    { localPath: BLURRY_DOG, candidateId: 'blurry' }
  );
  console.log(`  Raw VLM: choice=${result1.choice}`);
  console.log(`  Ranks: Sharp(A)=[aesthetics:${result1.ranks.A.aesthetics}], Blurry(B)=[aesthetics:${result1.ranks.B.aesthetics}]`);
  console.log(`  Explanation: ${result1.explanation}`);

  // Test 2: Blurry in position A, Sharp in position B
  console.log('\nTest 1b: Blurry=A, Sharp=B (aesthetics only)');
  const result2 = await provider.compareImagesAesthetics(
    { localPath: BLURRY_DOG, candidateId: 'blurry' },
    { localPath: SHARP_DOG, candidateId: 'sharp' }
  );
  console.log(`  Raw VLM: choice=${result2.choice}`);
  console.log(`  Ranks: Blurry(A)=[aesthetics:${result2.ranks.A.aesthetics}], Sharp(B)=[aesthetics:${result2.ranks.B.aesthetics}]`);
  console.log(`  Explanation: ${result2.explanation}`);

  // Analysis
  console.log('\nAnalysis:');
  const sharpWinsInBothPositions = (result1.choice === 'A' && result2.choice === 'B');
  const bWinsInBothPositions = (result1.choice === 'B' && result2.choice === 'B');
  const aWinsInBothPositions = (result1.choice === 'A' && result2.choice === 'A');

  if (sharpWinsInBothPositions) {
    console.log('  ✓ GOOD: Sharp dog won in both positions (quality-based choice)');
  } else if (bWinsInBothPositions) {
    console.log('  ✗ POSITION BIAS: B won in both cases (position bias detected)');
  } else if (aWinsInBothPositions) {
    console.log('  ✗ POSITION BIAS: A won in both cases (position bias detected)');
  } else {
    console.log(`  ? MIXED: Test1=${result1.choice}, Test2=${result2.choice}`);
    if (result1.choice === 'TIE' && result2.choice === 'TIE') {
      console.log('    VLM cannot distinguish quality difference (both TIE)');
    }
  }

  return { result1, result2, sharpWinsInBothPositions };
});

test('Aesthetic test: Good vs Poor - aesthetics only', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 30000,
    ensembleSize: 1
  });

  console.log('\n[Aesthetic Test 2] Good vs Poor quality - aesthetics only');
  console.log('Expected: Good quality should win (position should not matter)\n');

  // Test 1: Good in position A, Poor in position B
  console.log('Test 2a: Good=A, Poor=B (aesthetics only)');
  const result1 = await provider.compareImagesAesthetics(
    { localPath: GOOD_IMAGE, candidateId: 'good' },
    { localPath: POOR_IMAGE, candidateId: 'poor' }
  );
  console.log(`  Raw VLM: choice=${result1.choice}`);
  console.log(`  Ranks: Good(A)=[aesthetics:${result1.ranks.A.aesthetics}], Poor(B)=[aesthetics:${result1.ranks.B.aesthetics}]`);
  console.log(`  Explanation: ${result1.explanation}`);

  // Test 2: Poor in position A, Good in position B
  console.log('\nTest 2b: Poor=A, Good=B (aesthetics only)');
  const result2 = await provider.compareImagesAesthetics(
    { localPath: POOR_IMAGE, candidateId: 'poor' },
    { localPath: GOOD_IMAGE, candidateId: 'good' }
  );
  console.log(`  Raw VLM: choice=${result2.choice}`);
  console.log(`  Ranks: Poor(A)=[aesthetics:${result2.ranks.A.aesthetics}], Good(B)=[aesthetics:${result2.ranks.B.aesthetics}]`);
  console.log(`  Explanation: ${result2.explanation}`);

  // Analysis
  console.log('\nAnalysis:');
  const goodWinsInBothPositions = (result1.choice === 'A' && result2.choice === 'B');
  const bWinsInBothPositions = (result1.choice === 'B' && result2.choice === 'B');
  const aWinsInBothPositions = (result1.choice === 'A' && result2.choice === 'A');

  if (goodWinsInBothPositions) {
    console.log('  ✓ GOOD: Good quality won in both positions (quality-based choice)');
  } else if (bWinsInBothPositions) {
    console.log('  ✗ POSITION BIAS: B won in both cases (position bias detected)');
  } else if (aWinsInBothPositions) {
    console.log('  ✗ POSITION BIAS: A won in both cases (position bias detected)');
  } else {
    console.log(`  ? MIXED: Test1=${result1.choice}, Test2=${result2.choice}`);
    if (result1.choice === 'TIE' && result2.choice === 'TIE') {
      console.log('    VLM cannot distinguish quality difference (both TIE)');
    }
  }

  return { result1, result2, goodWinsInBothPositions };
});

test('Summary: Aesthetic quality detection', { timeout: 5000 }, async () => {
  console.log('\n' + '='.repeat(70));
  console.log('AESTHETIC QUALITY DETECTION SUMMARY');
  console.log('='.repeat(70));
  console.log('\nThe VLM should be able to distinguish image quality based on:');
  console.log('  - Sharpness vs blurriness');
  console.log('  - Overall aesthetic appeal');
  console.log('  - Technical quality (composition, lighting, etc.)');
  console.log('\nIf VLM consistently returns TIE, it cannot detect quality differences.');
  console.log('If VLM chooses B regardless of which image is better, position bias exists.');
  console.log('='.repeat(70) + '\n');
});
