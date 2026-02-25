const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getExpandSystemPrompt } = require('../../src/prompts/expand');

describe('getExpandSystemPrompt', () => {
  it('returns a string for default options', () => {
    const prompt = getExpandSystemPrompt();
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
  });

  // Local variant
  it('returns local what+natural prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'local' });
    assert.ok(prompt.includes('CONTENT'));
    assert.ok(prompt.includes('SDXL'));
  });

  it('returns local how+natural prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'how', promptStyle: 'natural', variant: 'local' });
    assert.ok(prompt.includes('STYLE'));
    assert.ok(prompt.includes('CONCRETE VISUAL LANGUAGE'));
  });

  it('returns local what+booru prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'what', promptStyle: 'booru', variant: 'local' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('CONTENT'));
  });

  it('returns local how+booru prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'how', promptStyle: 'booru', variant: 'local' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('STYLE'));
  });

  // OpenAI variant
  it('returns openai what+natural prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'openai' });
    assert.ok(prompt.includes('CONTENT'));
    assert.ok(prompt.includes('CONCRETE VISUAL LANGUAGE'));
  });

  it('returns openai how+natural prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'how', promptStyle: 'natural', variant: 'openai' });
    assert.ok(prompt.includes('STYLE'));
    assert.ok(prompt.includes('CONCRETE VISUAL LANGUAGE'));
  });

  it('returns openai what+booru prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'what', promptStyle: 'booru', variant: 'openai' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('CONTENT'));
  });

  it('returns openai how+booru prompt', () => {
    const prompt = getExpandSystemPrompt({ dimension: 'how', promptStyle: 'booru', variant: 'openai' });
    assert.ok(prompt.includes('booru'));
    assert.ok(prompt.includes('style'));
  });

  it('defaults to what+natural+local', () => {
    const prompt = getExpandSystemPrompt();
    const explicit = getExpandSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'local' });
    assert.strictEqual(prompt, explicit);
  });

  it('local and openai variants differ for same dimension+style', () => {
    const local = getExpandSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'local' });
    const openai = getExpandSystemPrompt({ dimension: 'what', promptStyle: 'natural', variant: 'openai' });
    assert.notStrictEqual(local, openai);
  });

  it('all 8 variants are unique', () => {
    const variants = new Set();
    for (const dim of ['what', 'how']) {
      for (const style of ['natural', 'booru']) {
        for (const variant of ['local', 'openai']) {
          variants.add(getExpandSystemPrompt({ dimension: dim, promptStyle: style, variant }));
        }
      }
    }
    assert.strictEqual(variants.size, 8);
  });
});
