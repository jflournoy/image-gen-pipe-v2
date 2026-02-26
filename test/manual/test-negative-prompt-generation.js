#!/usr/bin/env node
/**
 * Quick test: Can Mistral 7B generate smart negative prompts?
 * Tests the "30 year old man" edge case and other nuanced scenarios
 */

const axios = require('axios');

const LLM_URL = 'http://localhost:8003';

// Test cases with expected behavior
const testCases = [
  {
    prompt: '30 year old man',
    expectInNegative: ['old', 'elderly', 'aged'],
    shouldNotInclude: ['30', 'year', 'man'],
    description: 'Should prevent "old" misinterpretation while keeping age spec'
  },
  {
    prompt: 'beautiful sunset over mountains',
    expectInNegative: ['blurry', 'low quality'],
    shouldNotInclude: ['beautiful', 'sunset', 'mountains'],
    description: 'Should add quality negatives, not remove subject terms'
  },
  {
    prompt: 'old wooden barn in countryside',
    expectInNegative: ['blurry', 'modern'],
    shouldNotInclude: ['old', 'wooden'],
    description: 'Should NOT negate "old" since it describes the barn'
  },
  {
    prompt: 'dark moody portrait with dramatic lighting',
    expectInNegative: ['bright', 'overexposed'],
    shouldNotInclude: ['dark', 'moody', 'dramatic'],
    description: 'Should NOT negate desired style attributes'
  }
];

/**
 * Generate negative prompt using LLM
 */
async function generateNegativePrompt(positivePrompt) {
  const systemPrompt = `You are an expert at generating negative prompts for SDXL image generation.

Your task: Given a positive prompt, generate a negative prompt that:
1. Prevents common artifacts (blurry, low quality, distorted, deformed, etc.)
2. Disambiguates ambiguous terms (e.g., "old" in "30 year old" should be negated as "elderly, aged")
3. Prevents opposite characteristics from the desired result
4. Does NOT negate the core subject or desired attributes

Examples:

Positive: "30 year old man"
Negative: "old, elderly, aged, wrinkled, senior, young, child, teenager, blurry, low quality, distorted"

Positive: "old wooden barn"
Negative: "modern, new, metal, glass, blurry, low quality, distorted, people, cars"

Positive: "beautiful sunset"
Negative: "blurry, low quality, oversaturated, people, buildings, text, watermark, ugly"

Now generate a negative prompt for the following positive prompt. Output ONLY the negative prompt, nothing else.`;

  const userPrompt = `Positive prompt: "${positivePrompt}"`;

  try {
    const response = await axios.post(`${LLM_URL}/v1/completions`, {
      model: 'mistral',
      prompt: `${systemPrompt}\n\n${userPrompt}\n\nNegative prompt:`,
      max_tokens: 150,
      temperature: 0.3, // Lower temp for more consistent results
      top_p: 0.9,
      stop: ['\n\n', 'Positive:', 'Example:']
    });

    const result = response.data.choices[0].text.trim();
    return result;
  } catch (error) {
    console.error(`Error calling LLM: ${error.message}`);
    throw error;
  }
}

/**
 * Evaluate if negative prompt is good
 */
function evaluateNegative(negativePrompt, testCase) {
  const lower = negativePrompt.toLowerCase();
  const results = {
    hasExpected: [],
    missingExpected: [],
    wronglyIncluded: [],
    score: 0
  };

  // Check expected terms
  for (const term of testCase.expectInNegative) {
    if (lower.includes(term.toLowerCase())) {
      results.hasExpected.push(term);
    } else {
      results.missingExpected.push(term);
    }
  }

  // Check terms that should NOT be included
  for (const term of testCase.shouldNotInclude) {
    if (lower.includes(term.toLowerCase())) {
      results.wronglyIncluded.push(term);
    }
  }

  // Calculate score
  const expectedScore = results.hasExpected.length / testCase.expectInNegative.length;
  const wrongPenalty = results.wronglyIncluded.length * 0.2;
  results.score = Math.max(0, expectedScore - wrongPenalty);

  return results;
}

/**
 * Run all test cases
 */
async function runTests() {
  console.log('🧪 Testing Mistral 7B Negative Prompt Generation\n');
  console.log('='.repeat(80));

  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.description}`);
    console.log(`Positive: "${testCase.prompt}"`);

    try {
      const negativePrompt = await generateNegativePrompt(testCase.prompt);
      console.log(`Negative: "${negativePrompt}"`);

      const evalResult = evaluateNegative(negativePrompt, testCase);

      console.log(`\n✅ Has expected terms: ${evalResult.hasExpected.join(', ') || 'none'}`);
      if (evalResult.missingExpected.length > 0) {
        console.log(`❌ Missing expected: ${evalResult.missingExpected.join(', ')}`);
      }
      if (evalResult.wronglyIncluded.length > 0) {
        console.log(`⚠️  Wrongly included: ${evalResult.wronglyIncluded.join(', ')}`);
      }
      console.log(`Score: ${(evalResult.score * 100).toFixed(0)}%`);

    } catch (error) {
      console.error(`❌ Test failed: ${error.message}`);
    }

    console.log('-'.repeat(80));
  }

  console.log('\n✨ Test complete!\n');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
