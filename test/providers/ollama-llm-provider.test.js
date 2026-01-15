/**
 * @file Ollama LLM Provider Tests (TDD RED)
 * Tests for local LLM provider using Ollama/llama-cpp-python
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');
const OllamaLLMProvider = require('../../src/providers/ollama-llm-provider.js');

describe('🔴 RED: OllamaLLMProvider', () => {
  const testBaseUrl = 'http://localhost:11434';
  let provider;

  before(() => {
    provider = new OllamaLLMProvider({
      baseUrl: testBaseUrl,
      model: 'capybarahermes-2.5-mistral-7b'
    });
  });

  after(() => {
    nock.cleanAll();
  });

  describe('Constructor', () => {
    it('should initialize with base URL and model configuration', () => {
      assert.ok(provider, 'Provider should be instantiated');
      assert.strictEqual(provider.baseUrl, testBaseUrl);
      assert.strictEqual(provider.model, 'capybarahermes-2.5-mistral-7b');
    });

    it('should use default base URL if not provided', () => {
      const defaultProvider = new OllamaLLMProvider({});
      assert.strictEqual(defaultProvider.baseUrl, 'http://localhost:11434');
    });

    it('should use default model if not provided', () => {
      const defaultProvider = new OllamaLLMProvider({});
      assert.strictEqual(defaultProvider.model, 'capybarahermes-2.5-mistral-7b');
    });
  });

  describe('refinePrompt', () => {
    it('should refine a prompt with dimension=what (content)', async () => {
      const mockResponse = {
        response: 'ancient temple ruins, overgrown with vines, shafts of light breaking through canopy, mystical atmosphere'
      };

      nock(testBaseUrl)
        .post('/api/generate', body => {
          return body.model === 'capybarahermes-2.5-mistral-7b' &&
                 body.prompt.includes('CONTENT') &&
                 body.prompt.includes('magical forest');
        })
        .reply(200, mockResponse);

      const result = await provider.refinePrompt('magical forest', {
        dimension: 'what'
      });

      assert.ok(result);
      assert.strictEqual(typeof result, 'string');
      assert.ok(result.length > 0);
    });

    it('should refine a prompt with dimension=how (style)', async () => {
      const mockResponse = {
        response: 'cinematic lighting, soft bokeh, warm color palette, dreamy atmosphere, golden hour glow'
      };

      nock(testBaseUrl)
        .post('/api/generate', body => {
          return body.model === 'capybarahermes-2.5-mistral-7b' &&
                 body.prompt.includes('STYLE') &&
                 body.prompt.includes('magical forest');
        })
        .reply(200, mockResponse);

      const result = await provider.refinePrompt('magical forest', {
        dimension: 'how'
      });

      assert.ok(result);
      assert.ok(result.length > 0);
    });

    it('should support critique-based refinement with previousResult', async () => {
      const mockResponse = {
        response: 'refined prompt with more detail about lighting and composition'
      };

      nock(testBaseUrl)
        .post('/api/generate', body => {
          return body.prompt.includes('Previous result') &&
                 body.prompt.includes('Current CLIP score');
        })
        .reply(200, mockResponse);

      const result = await provider.refinePrompt('original prompt', {
        previousResult: {
          prompt: 'previous prompt',
          clipScore: 75.5,
          aestheticScore: 6.8,
          caption: 'A fantasy scene with magical elements'
        }
      });

      assert.ok(result);
    });

    it('should default to dimension=what if not specified', async () => {
      const mockResponse = {
        response: 'refined content prompt'
      };

      nock(testBaseUrl)
        .post('/api/generate', body => {
          return body.prompt.includes('CONTENT');
        })
        .reply(200, mockResponse);

      const result = await provider.refinePrompt('test prompt');

      assert.ok(result);
    });

    it('should handle API errors gracefully', async () => {
      nock(testBaseUrl)
        .post('/api/generate')
        .reply(500, { error: 'Internal server error' });

      await assert.rejects(
        async () => {
          await provider.refinePrompt('test prompt');
        },
        {
          message: /Failed to refine prompt/
        }
      );
    });
  });

  describe('combinePrompts', () => {
    it('should combine what and how prompts intelligently', async () => {
      const mockResponse = {
        response: 'ancient temple ruins, overgrown with vines, cinematic lighting, soft bokeh, dreamy atmosphere'
      };

      nock(testBaseUrl)
        .post('/api/generate', body => {
          return body.prompt.includes('WHAT prompt: ancient temple') &&
                 body.prompt.includes('HOW prompt: cinematic lighting') &&
                 body.prompt.includes('combine');
        })
        .reply(200, mockResponse);

      const result = await provider.combinePrompts(
        'ancient temple ruins, overgrown with vines',
        'cinematic lighting, soft bokeh, dreamy atmosphere'
      );

      assert.ok(result);
      assert.ok(result.length > 0);
      // Should contain elements from both prompts
      assert.ok(result.includes('temple') || result.includes('vines') || result.includes('lighting'));
    });

    it('should handle empty what prompt', async () => {
      const mockResponse = {
        response: 'cinematic lighting, soft bokeh'
      };

      nock(testBaseUrl)
        .post('/api/generate')
        .reply(200, mockResponse);

      const result = await provider.combinePrompts('', 'cinematic lighting');

      assert.ok(result);
    });

    it('should handle empty how prompt', async () => {
      const mockResponse = {
        response: 'ancient temple ruins'
      };

      nock(testBaseUrl)
        .post('/api/generate')
        .reply(200, mockResponse);

      const result = await provider.combinePrompts('ancient temple', '');

      assert.ok(result);
    });

    it('should handle API errors gracefully', async () => {
      nock(testBaseUrl)
        .post('/api/generate')
        .reply(500, { error: 'Internal server error' });

      await assert.rejects(
        async () => {
          await provider.combinePrompts('what', 'how');
        },
        {
          message: /Failed to combine prompts/
        }
      );
    });
  });

  describe('generateText', () => {
    it('should generate text from a prompt', async () => {
      const mockResponse = {
        response: 'Generated text response based on the prompt'
      };

      nock(testBaseUrl)
        .post('/api/generate', body => {
          return body.model === 'capybarahermes-2.5-mistral-7b' &&
                 body.prompt.includes('test prompt');
        })
        .reply(200, mockResponse);

      const result = await provider.generateText('test prompt');

      assert.ok(result);
      assert.strictEqual(typeof result, 'string');
    });

    it('should support custom generation parameters', async () => {
      const mockResponse = {
        response: 'Creative response'
      };

      nock(testBaseUrl)
        .post('/api/generate', body => {
          return body.options &&
                 body.options.temperature === 0.9 &&
                 body.options.max_tokens === 512;
        })
        .reply(200, mockResponse);

      const result = await provider.generateText('test prompt', {
        temperature: 0.9,
        max_tokens: 512
      });

      assert.ok(result);
    });

    it('should handle API errors gracefully', async () => {
      nock(testBaseUrl)
        .post('/api/generate')
        .reply(500, { error: 'Internal server error' });

      await assert.rejects(
        async () => {
          await provider.generateText('test prompt');
        },
        {
          message: /Failed to generate text/
        }
      );
    });
  });

  describe('Health Check', () => {
    it('should provide a health check endpoint', async () => {
      nock(testBaseUrl)
        .get('/api/tags')
        .reply(200, {
          models: [
            { name: 'capybarahermes-2.5-mistral-7b', size: 4200000000 }
          ]
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.status, 'healthy');
      assert.ok(Array.isArray(health.models));
    });

    it('should handle service unavailable', async () => {
      nock(testBaseUrl)
        .get('/api/tags')
        .reply(503);

      await assert.rejects(
        async () => {
          await provider.healthCheck();
        },
        {
          message: /Service unavailable/
        }
      );
    });
  });
});
