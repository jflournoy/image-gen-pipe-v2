const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getNegativeSystemPrompt } = require('../../src/prompts/negative');

describe('getNegativeSystemPrompt', () => {
  it('returns a string for natural style', () => {
    const prompt = getNegativeSystemPrompt({ promptStyle: 'natural' });
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
  });

  it('returns a string for booru style', () => {
    const prompt = getNegativeSystemPrompt({ promptStyle: 'booru' });
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
  });

  it('defaults to natural style when no options given', () => {
    const prompt = getNegativeSystemPrompt();
    const natural = getNegativeSystemPrompt({ promptStyle: 'natural' });
    assert.strictEqual(prompt, natural);
  });

  it('natural prompt includes key instructions', () => {
    const prompt = getNegativeSystemPrompt({ promptStyle: 'natural' });
    assert.ok(prompt.includes('negative prompts for SDXL'));
    assert.ok(prompt.includes('SHORT, FOCUSED'));
    assert.ok(prompt.includes('Output ONLY the negative prompt'));
  });

  it('booru prompt includes standard quality negatives', () => {
    const prompt = getNegativeSystemPrompt({ promptStyle: 'booru' });
    assert.ok(prompt.includes('lowres'));
    assert.ok(prompt.includes('bad anatomy'));
    assert.ok(prompt.includes('booru-style'));
    assert.ok(prompt.includes('Output ONLY comma-separated tags'));
  });

  it('natural and booru prompts are different', () => {
    const natural = getNegativeSystemPrompt({ promptStyle: 'natural' });
    const booru = getNegativeSystemPrompt({ promptStyle: 'booru' });
    assert.notStrictEqual(natural, booru);
  });
});
