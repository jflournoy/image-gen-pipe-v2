const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getRefineSystemPrompt } = require('../../src/prompts/refine');

describe('getRefineSystemPrompt', () => {
  it('returns a string for default options', () => {
    const prompt = getRefineSystemPrompt();
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
  });

  // Local variant
  it('returns local what+natural refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'local' });
    assert.ok(prompt.includes('CONTENT'));
    assert.ok(prompt.includes('refine'));
  });

  it('returns local how+natural refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'how', promptStyle: 'natural', variant: 'local' });
    assert.ok(prompt.includes('STYLE'));
  });

  it('returns local what+booru refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'what', promptStyle: 'booru', variant: 'local' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('CONTENT'));
  });

  it('returns local how+booru refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'how', promptStyle: 'booru', variant: 'local' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('STYLE'));
  });

  // OpenAI variant
  it('returns openai what+natural refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'openai' });
    assert.ok(prompt.includes('CONTENT'));
    assert.ok(prompt.includes('critique'));
  });

  it('returns openai how+natural refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'how', promptStyle: 'natural', variant: 'openai' });
    assert.ok(prompt.includes('STYLE'));
  });

  it('returns openai what+booru refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'what', promptStyle: 'booru', variant: 'openai' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('CONTENT'));
  });

  it('returns openai how+booru refine prompt', () => {
    const prompt = getRefineSystemPrompt({ dimension: 'how', promptStyle: 'booru', variant: 'openai' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('STYLE'));
  });

  it('defaults to what+natural+local', () => {
    const prompt = getRefineSystemPrompt();
    const explicit = getRefineSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'local' });
    assert.strictEqual(prompt, explicit);
  });

  it('local and openai variants differ for same dimension+style', () => {
    const local = getRefineSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'local' });
    const openai = getRefineSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'openai' });
    assert.notStrictEqual(local, openai);
  });

  it('all 8 variants are unique', () => {
    const variants = new Set();
    for (const dim of ['what', 'how']) {
      for (const style of ['natural', 'booru']) {
        for (const variant of ['local', 'openai']) {
          variants.add(getRefineSystemPrompt({ dimension: dim, promptStyle: style, variant }));
        }
      }
    }
    assert.strictEqual(variants.size, 8);
  });
});
