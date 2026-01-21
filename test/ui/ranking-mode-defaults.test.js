/**
 * Test: Ranking Mode Defaults
 * Ensures Tournament/VLM is the default ranking mode in the UI
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('🔴 VLM/Tournament radio button should be checked by default', () => {
  const htmlPath = path.join(__dirname, '../../public/demo.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Extract the full radio element for VLM
  const vlmRadioFull = htmlContent.match(
    /<input[^>]*name="rankingMode"[^>]*value="vlm"[^>]*>/
  );

  assert(vlmRadioFull, 'VLM radio button not found');
  assert(vlmRadioFull[0].includes('checked'), 'VLM radio button should have checked attribute');
});

test('🔴 Scoring radio button should NOT be checked by default', () => {
  const htmlPath = path.join(__dirname, '../../public/demo.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Find the scoring radio button and verify it does NOT have checked attribute
  const scoringRadioFull = htmlContent.match(
    /<input[^>]*name="rankingMode"[^>]*value="scoring"[^>]*>/
  );

  assert(scoringRadioFull, 'Scoring radio button not found');
  assert(!scoringRadioFull[0].includes('checked'), 'Scoring radio button should NOT have checked attribute');
});

test('🔴 .env file should have RANKING_MODE=tournament', () => {
  const envPath = path.join(__dirname, '../../.env');
  const envContent = fs.readFileSync(envPath, 'utf8');

  assert(
    /RANKING_MODE\s*=\s*tournament/.test(envContent),
    '.env should have RANKING_MODE=tournament'
  );
});
