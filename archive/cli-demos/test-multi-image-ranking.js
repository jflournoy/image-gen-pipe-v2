#!/usr/bin/env node

/**
 * Integration Test: Multi-Image Ranking with Real API
 *
 * Tests whether OpenAI Vision API can handle 2, 3, and 4 images
 * in a single request for comparative ranking.
 */

require('dotenv').config();

const ImageRanker = require('./src/services/image-ranker.js');
const fs = require('fs').promises;
const path = require('path');

async function convertToBase64DataURL(imagePath) {
  const imageBuffer = await fs.readFile(imagePath);
  const base64 = imageBuffer.toString('base64');
  return `data:image/png;base64,${base64}`;
}

async function testMultiImageRanking() {
  console.log('🧪 Testing Multi-Image Ranking with Real OpenAI API\n');
  console.log('='.repeat(80));

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY not found');
    process.exit(1);
  }

  // Use images from output directory
  const testImages = [
    'output/2025-12-05/ses-124350/iter0-cand0.png',
    'output/2025-12-05/ses-124350/iter0-cand1.png',
    'output/2025-12-05/ses-124350/iter0-cand2.png',
    'output/2025-12-05/ses-104156/iter0-cand0.png'
  ];

  // Verify images exist
  for (const imgPath of testImages) {
    try {
      await fs.access(imgPath);
    } catch {
      console.error(`❌ Image not found: ${imgPath}`);
      process.exit(1);
    }
  }

  console.log('✅ Found 4 test images\n');

  // Convert to base64 data URLs (required for Vision API)
  console.log('🔄 Converting images to base64...');
  const dataURLs = await Promise.all(
    testImages.map(async (imgPath, idx) => ({
      candidateId: idx,
      url: await convertToBase64DataURL(imgPath),
      path: imgPath
    }))
  );
  console.log('✅ Images converted\n');

  const ranker = new ImageRanker({
    apiKey: process.env.OPENAI_API_KEY
  });

  const testPrompt = 'a serene mountain landscape at sunset';

  // Test 1: Rank 2 images
  console.log('='.repeat(80));
  console.log('TEST 1: Ranking 2 images (pairwise comparison)');
  console.log('='.repeat(80));
  try {
    const twoImages = dataURLs.slice(0, 2);
    console.log(`Images: ${twoImages.map(i => path.basename(i.path)).join(', ')}`);

    const result2 = await ranker.compareTwo(
      twoImages[0],
      twoImages[1],
      testPrompt
    );

    console.log('✅ SUCCESS - 2 image comparison works!');
    console.log(`   Winner: ${result2.winner}`);
    console.log(`   Reason: ${result2.reason}`);
    console.log('');
  } catch (error) {
    console.error('❌ FAILED - 2 image comparison');
    console.error(`   Error: ${error.message}`);
    console.log('');
  }

  // Test 2: Rank 3 images all-at-once
  console.log('='.repeat(80));
  console.log('TEST 2: Ranking 3 images (all-at-once)');
  console.log('='.repeat(80));
  try {
    const threeImages = dataURLs.slice(0, 3);
    console.log(`Images: ${threeImages.map(i => path.basename(i.path)).join(', ')}`);

    const result3 = await ranker.rankAllAtOnce(
      threeImages,
      testPrompt
    );

    console.log('✅ SUCCESS - 3 image all-at-once ranking works!');
    result3.forEach(r => {
      console.log(`   Rank ${r.rank}: Candidate ${r.candidateId}`);
      console.log(`      Reason: ${r.reason.substring(0, 60)}...`);
    });
    console.log('');
  } catch (error) {
    console.error('❌ FAILED - 3 image all-at-once ranking');
    console.error(`   Error: ${error.message}`);
    if (error.response) {
      console.error(`   API Response: ${JSON.stringify(error.response.data)}`);
    }
    console.log('');
  }

  // Test 3: Rank 4 images all-at-once (CRITICAL TEST)
  console.log('='.repeat(80));
  console.log('TEST 3: Ranking 4 images (all-at-once) - THRESHOLD TEST');
  console.log('='.repeat(80));
  try {
    const fourImages = dataURLs.slice(0, 4);
    console.log(`Images: ${fourImages.map(i => path.basename(i.path)).join(', ')}`);

    const result4 = await ranker.rankAllAtOnce(
      fourImages,
      testPrompt
    );

    console.log('✅ SUCCESS - 4 image all-at-once ranking works!');
    result4.forEach(r => {
      console.log(`   Rank ${r.rank}: Candidate ${r.candidateId}`);
      console.log(`      Reason: ${r.reason.substring(0, 60)}...`);
    });
    console.log('');
  } catch (error) {
    console.error('❌ FAILED - 4 image all-at-once ranking');
    console.error(`   Error: ${error.message}`);
    if (error.response) {
      console.error(`   API Response: ${JSON.stringify(error.response.data)}`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('📊 Test Summary');
  console.log('='.repeat(80));
  console.log('If all tests passed:');
  console.log('  ✅ allAtOnceThreshold = 4 is VERIFIED and safe');
  console.log('');
  console.log('If 4-image test failed:');
  console.log('  ⚠️  allAtOnceThreshold should be lowered to 3 or 2');
  console.log('  ⚠️  Update src/services/image-ranker.js line 34');
  console.log('='.repeat(80));
}

// Run the test
testMultiImageRanking().catch(error => {
  console.error('\n💥 Test script crashed:', error);
  console.error(error.stack);
  process.exit(1);
});
