const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getCombineSystemPrompt } = require('../../src/prompts/combine');

describe('getCombineSystemPrompt', () => {
  it('returns a string for default options', () => {
    const prompt = getCombineSystemPrompt();
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
  });

  // Natural style × 3 descriptiveness levels
  it('returns concise natural prompt (descriptiveness=1)', () => {
    const prompt = getCombineSystemPrompt({ promptStyle: 'natural', descriptiveness: 1 });
    assert.ok(prompt.includes('BRIEF'));
    assert.ok(prompt.includes('MINIMAL'));
  });

  it('returns balanced natural prompt (descriptiveness=2)', () => {
    const prompt = getCombineSystemPrompt({ promptStyle: 'natural', descriptiveness: 2 });
    assert.ok(prompt.includes('BALANCED'));
    assert.ok(prompt.includes('CONCRETE VISUAL LANGUAGE'));
  });

  it('returns descriptive natural prompt (descriptiveness=3)', () => {
    const prompt = getCombineSystemPrompt({ promptStyle: 'natural', descriptiveness: 3 });
    assert.ok(prompt.includes('COMPREHENSIVE'));
    assert.ok(prompt.includes('RICHLY DETAILED'));
  });

  // Booru style × 3 descriptiveness levels
  it('returns concise booru prompt (descriptiveness=1)', () => {
    const prompt = getCombineSystemPrompt({ promptStyle: 'booru', descriptiveness: 1 });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('MINIMAL'));
  });

  it('returns balanced booru prompt (descriptiveness=2)', () => {
    const prompt = getCombineSystemPrompt({ promptStyle: 'booru', descriptiveness: 2 });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('BALANCED'));
  });

  it('returns descriptive booru prompt (descriptiveness=3)', () => {
    const prompt = getCombineSystemPrompt({ promptStyle: 'booru', descriptiveness: 3 });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('COMPREHENSIVE'));
  });

  it('defaults to natural style and descriptiveness=2', () => {
    const prompt = getCombineSystemPrompt();
    const explicit = getCombineSystemPrompt({ promptStyle: 'natural', descriptiveness: 2 });
    assert.strictEqual(prompt, explicit);
  });

  it('all 6 variants are unique', () => {
    const variants = new Set();
    for (const style of ['natural', 'booru']) {
      for (const desc of [1, 2, 3]) {
        variants.add(getCombineSystemPrompt({ promptStyle: style, descriptiveness: desc }));
      }
    }
    assert.strictEqual(variants.size, 6);
  });
});
