/**
 * VLM Position Bias Detection Tests
 *
 * These tests detect systematic position bias in the VLM model by:
 * 1. Comparing identical images repeatedly
 * 2. Measuring choice distribution (should be balanced with debiasing)
 * 3. Validating that VLM doesn't systematically prefer position B
 *
 * Expected: With proper debiasing, final choices should be ~50/50 A/B
 * If VLM has position bias: vlmChoice will be mostly B, but mappedChoice should still be balanced
 */

const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const LocalVLMProvider = require('../../src/providers/local-vlm-provider');

// Use existing test fixture
const TEST_IMAGE = path.join(__dirname, '../fixtures/images/cat.jpg');
const VLM_API_URL = process.env.VLM_API_URL || 'http://localhost:8004';
const TEST_TIMEOUT = 120000; // 2 minutes total for 20 comparisons

test('VLM position bias detection - identical image comparisons', { timeout: TEST_TIMEOUT }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 60000,
    ensembleSize: 1  // Single comparison for speed
  });

  const numTrials = 20;
  const results = [];

  console.log(`\n[Bias Test] Running ${numTrials} comparisons of identical images...`);
  console.log(`[Bias Test] Image: ${TEST_IMAGE}`);
  console.log(`[Bias Test] This will take ~${numTrials * 5}s (5s per comparison)\n`);

  for (let i = 0; i < numTrials; i++) {
    try {
      const result = await provider.compareWithDebiasing(
        TEST_IMAGE,
        TEST_IMAGE,
        'a cat photograph'
      );
      results.push(result.choice);

      // Show progress
      process.stdout.write(`\r[Bias Test] Progress: ${i + 1}/${numTrials} - Latest: ${result.choice}`);
    } catch (error) {
      console.error(`\n[Bias Test] Comparison ${i + 1} failed:`, error.message);
      throw error;
    }
  }

  console.log('\n');  // New line after progress

  // Count A vs B choices
  const aCount = results.filter(c => c === 'A').length;
  const bCount = results.filter(c => c === 'B').length;
  const tieCount = results.filter(c => c === 'TIE').length;

  console.log(`[Bias Test] Results after ${numTrials} trials:`);
  console.log(`  A wins: ${aCount} (${(aCount / numTrials * 100).toFixed(1)}%)`);
  console.log(`  B wins: ${bCount} (${(bCount / numTrials * 100).toFixed(1)}%)`);
  console.log(`  TIE:    ${tieCount} (${(tieCount / numTrials * 100).toFixed(1)}%)`);
  console.log(`  Difference: ${Math.abs(aCount - bCount)} (${(Math.abs(aCount - bCount) / numTrials * 100).toFixed(1)}%)`);

  // Statistical analysis
  const total = aCount + bCount; // Exclude TIEs from bias calculation
  const expectedPerSide = total / 2;
  const deviation = Math.abs(aCount - expectedPerSide);
  const deviationPercent = (deviation / expectedPerSide) * 100;

  console.log('\n[Bias Test] Statistical Analysis:');
  console.log(`  Expected per side: ${expectedPerSide.toFixed(1)} (excluding TIEs)`);
  console.log(`  Deviation from expected: ${deviation.toFixed(1)} (${deviationPercent.toFixed(1)}%)`);

  // Threshold: Allow up to 40% deviation for identical images
  // (With 20 trials, we expect ~10 per side, allow ±8 = 2-18 range)
  const maxDeviation = 8;

  console.log(`  Threshold: max ${maxDeviation} deviation`);
  console.log(`  Test: ${Math.abs(aCount - bCount) <= maxDeviation ? 'PASS ✓' : 'FAIL ✗'}\n`);

  // Assert: Should be roughly balanced
  assert(
    Math.abs(aCount - bCount) <= maxDeviation,
    `Strong position bias detected! A=${aCount}, B=${bCount}, diff=${Math.abs(aCount - bCount)} (max allowed: ${maxDeviation}). ` +
    'This suggests VLM is choosing based on position rather than image content.'
  );
});

test('VLM raw response check - single identical image comparison', { timeout: 60000 }, async () => {
  const provider = new LocalVLMProvider({
    apiUrl: VLM_API_URL,
    timeout: 60000,
    ensembleSize: 1
  });

  console.log('\n[Raw Response Test] Comparing identical images once...');

  const result = await provider.compareImages(TEST_IMAGE, TEST_IMAGE, 'a cat photograph');

  console.log('[Raw Response Test] Result:');
  console.log(`  Choice: ${result.choice}`);
  console.log(`  Explanation: ${result.explanation}`);
  console.log(`  Confidence: ${result.confidence}`);
  console.log(`  Ranks A: alignment=${result.ranks.A.alignment}, aesthetics=${result.ranks.A.aesthetics}, combined=${result.ranks.A.combined}`);
  console.log(`  Ranks B: alignment=${result.ranks.B.alignment}, aesthetics=${result.ranks.B.aesthetics}, combined=${result.ranks.B.combined}`);

  // Ideally, identical images should be TIE with equal ranks
  // But model may not detect they're identical
  if (result.choice === 'TIE') {
    console.log('  ✓ Model correctly identified identical images as TIE');
  } else {
    console.log(`  ⚠ Model chose ${result.choice} for identical images (may indicate position bias)`);
  }

  // Check if ranks match choice
  const aTotal = result.ranks.A.alignment + result.ranks.A.aesthetics;
  const bTotal = result.ranks.B.alignment + result.ranks.B.aesthetics;

  if (result.choice === 'A' && aTotal < bTotal) {
    console.log('  ✓ Ranks consistent with choice (A has lower rank total)');
  } else if (result.choice === 'B' && bTotal < aTotal) {
    console.log('  ✓ Ranks consistent with choice (B has lower rank total)');
  } else if (result.choice === 'TIE' && aTotal === bTotal) {
    console.log('  ✓ Ranks consistent with TIE (equal rank totals)');
  } else {
    console.log(`  ✗ WARNING: Ranks inconsistent with choice! choice=${result.choice}, A_total=${aTotal}, B_total=${bTotal}`);
  }

  console.log('');
});
