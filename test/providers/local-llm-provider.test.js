/**
 * 🔴 RED: Local LLM Provider Tests
 *
 * Tests for LocalLLMProvider - llama.cpp-based local LLM for prompt refinement
 * Uses OpenAI-compatible /v1/completions API
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('LocalLLMProvider', () => {
  let LocalLLMProvider;

  beforeEach(() => {
    // Clear module cache to get fresh instance
    delete require.cache[require.resolve('../../src/providers/local-llm-provider.js')];
    LocalLLMProvider = require('../../src/providers/local-llm-provider.js');
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('constructor', () => {
    test('should use default apiUrl and model', () => {
      const provider = new LocalLLMProvider();

      assert.strictEqual(provider.apiUrl, 'http://localhost:8003');
      assert.strictEqual(provider.model, 'mistralai/Mistral-7B-Instruct-v0.2');
    });

    test('should accept custom apiUrl and model', () => {
      const provider = new LocalLLMProvider({
        apiUrl: 'http://localhost:9000',
        model: 'custom/model-v1'
      });

      assert.strictEqual(provider.apiUrl, 'http://localhost:9000');
      assert.strictEqual(provider.model, 'custom/model-v1');
    });
  });

  describe('refinePrompt', () => {
    test('should refine prompt with dimension=what', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{
            text: 'A majestic golden retriever standing in a sunlit meadow, flowers swaying in the breeze, mountains in the background.',
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 }
        });

      const result = await provider.refinePrompt('a dog in a field', { dimension: 'what' });

      assert.ok(result.refinedPrompt.includes('golden retriever') || result.refinedPrompt.includes('meadow'));
      assert.ok(result.metadata, 'Should include metadata');
      assert.strictEqual(result.metadata.tokensUsed, 80);
    });

    test('should refine prompt with dimension=how', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{
            text: 'Soft golden hour lighting, shallow depth of field, bokeh background, cinematic composition, warm color palette.',
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
        });

      const result = await provider.refinePrompt('a dog in a field', { dimension: 'how' });

      assert.ok(result.refinedPrompt.includes('lighting') || result.refinedPrompt.includes('cinematic') || result.refinedPrompt.includes('bokeh'));
      assert.ok(result.metadata);
    });

    test('should default to dimension=what if not specified', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Refined content prompt', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.refinePrompt('test prompt');

      assert.ok(capturedBody.prompt.includes('CONTENT'));
    });

    test('should handle critique-based refinement with previousResult', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Improved prompt based on critique', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.refinePrompt('original prompt', {
        dimension: 'what',
        previousResult: {
          prompt: 'previous refined prompt',
          clipScore: 0.75,
          aestheticScore: 6.5,
          caption: 'A dog sitting in grass'
        }
      });

      assert.ok(capturedBody.prompt.includes('CLIP score: 0.75'));
      assert.ok(capturedBody.prompt.includes('previous refined prompt'));
      assert.ok(capturedBody.prompt.includes('A dog sitting in grass'));
    });

    test('should handle critique-based refinement for how dimension', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Improved style prompt', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.refinePrompt('original prompt', {
        dimension: 'how',
        previousResult: {
          prompt: 'previous style prompt',
          clipScore: 0.8,
          aestheticScore: 5.5,
          caption: 'An image'
        }
      });

      assert.ok(capturedBody.prompt.includes('Aesthetic score: 5.5'));
      assert.ok(capturedBody.prompt.includes('VISUAL STYLE'));
    });

    test('should trim whitespace from result', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: '  result with whitespace  \n\n', finish_reason: 'stop' }],
          usage: {}
        });

      const result = await provider.refinePrompt('test');

      assert.strictEqual(result.refinedPrompt, 'result with whitespace');
    });

    test('should throw error on API failure', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(500, { error: 'Internal server error' });

      await assert.rejects(
        provider.refinePrompt('test'),
        /Failed to refine prompt/
      );
    });
  });

  describe('combinePrompts', () => {
    test('should combine what and how prompts', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{
            text: 'A majestic golden retriever in a sunlit meadow, soft golden hour lighting, shallow depth of field, cinematic composition',
            finish_reason: 'stop'
          }],
          usage: { total_tokens: 60 }
        });

      const result = await provider.combinePrompts(
        'A golden retriever in a meadow',
        'Golden hour lighting, shallow depth of field'
      );

      assert.ok(capturedBody.prompt.includes('WHAT prompt'));
      assert.ok(capturedBody.prompt.includes('HOW prompt'));
      assert.ok(result.combinedPrompt.includes('golden'));
      assert.ok(result.metadata, 'Should include metadata');
    });

    test('should handle null what prompt', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Style-only prompt result', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.combinePrompts(null, 'Some style description');

      assert.ok(capturedBody.prompt.includes('(none)'));
    });

    test('should handle null how prompt', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Content-only prompt result', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.combinePrompts('Some content description', null);

      assert.ok(capturedBody.prompt.includes('(none)'));
    });

    test('should throw error on API failure', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(500, { error: 'Server error' });

      await assert.rejects(
        provider.combinePrompts('what', 'how'),
        /Failed to combine prompts/
      );
    });
  });

  describe('generateText', () => {
    test('should generate text from prompt', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Generated text response', finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        });

      const result = await provider.generateText('Tell me a story');

      assert.strictEqual(result, 'Generated text response');
    });

    test('should pass custom options to API', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Response', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.generateText('prompt', {
        max_tokens: 100,
        temperature: 0.5,
        top_p: 0.8
      });

      assert.strictEqual(capturedBody.max_tokens, 100);
      assert.strictEqual(capturedBody.temperature, 0.5);
      assert.strictEqual(capturedBody.top_p, 0.8);
    });

    test('should use default options when not specified', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Response', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.generateText('prompt');

      assert.strictEqual(capturedBody.max_tokens, 500);
      assert.strictEqual(capturedBody.temperature, 0.7);
      assert.strictEqual(capturedBody.top_p, 0.9);
      assert.strictEqual(capturedBody.stream, false);
    });

    test('should throw error on API failure', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(503, { error: 'Service unavailable' });

      await assert.rejects(
        provider.generateText('prompt'),
        /Failed to generate text/
      );
    });
  });

  describe('_generate (internal)', () => {
    test('should handle empty response text', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: '', finish_reason: 'stop' }],
          usage: {}
        });

      const result = await provider.generateText('prompt');

      assert.strictEqual(result, '');
    });

    test('should handle missing text in response', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ finish_reason: 'stop' }],
          usage: {}
        });

      const result = await provider.generateText('prompt');

      assert.strictEqual(result, '');
    });

    test('should throw descriptive error on HTTP error response', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(400, { error: 'Bad request', details: 'Invalid prompt' });

      await assert.rejects(
        provider.generateText('prompt'),
        /HTTP 400/
      );
    });

    test('should throw descriptive error when service unreachable', async () => {
      const provider = new LocalLLMProvider({ apiUrl: 'http://localhost:9999' });

      // Don't mock - let it fail to connect
      nock.enableNetConnect('localhost:9999');

      // Service should reject when unreachable (actual error varies with test infrastructure)
      await assert.rejects(
        provider.generateText('prompt'),
        /Failed to generate text|Cannot reach local LLM service/
      );
    });

    test('should send correct model in request', async () => {
      const provider = new LocalLLMProvider({ model: 'test-model' });

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Response', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.generateText('prompt');

      assert.strictEqual(capturedBody.model, 'test-model');
    });
  });

  describe('healthCheck', () => {
    test('should return healthy status when service is running', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'mistralai/Mistral-7B-Instruct-v0.2',
          device: 'cuda',
          model_loaded: true
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.status, 'healthy');
      assert.ok(health.model);
      assert.strictEqual(health.device, 'cuda');
      assert.strictEqual(health.model_loaded, true);
    });

    test('should return model info from health check', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
          model_file: '*Q4_K_M.gguf',
          device: 'cuda',
          model_loaded: false
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.model, 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF');
      assert.strictEqual(health.model_loaded, false);
    });

    test('should throw error when service returns non-200', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .get('/health')
        .reply(503, { status: 'unhealthy' });

      await assert.rejects(
        provider.healthCheck(),
        /Service unavailable/
      );
    });

    test('should throw error when service is unreachable', async () => {
      const provider = new LocalLLMProvider({ apiUrl: 'http://localhost:9999' });

      nock.enableNetConnect('localhost:9999');

      await assert.rejects(
        provider.healthCheck(),
        /Service unavailable/
      );
    });

    test('should use 30 second timeout for health check', async () => {
      const provider = new LocalLLMProvider();

      // Create a delayed response that exceeds timeout (30s + buffer)
      nock('http://localhost:8003')
        .get('/health')
        .delay(31000)
        .reply(200, { status: 'healthy' });

      await assert.rejects(
        provider.healthCheck(),
        /Service unavailable/
      );
    });
  });

  describe('GPU verification', () => {
    test('should return gpu_layers in health check for GPU usage verification', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_repo: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
          model_file: '*Q4_K_M.gguf',
          gpu_layers: 32,
          context_size: 2048,
          model_loaded: true,
          device: 'cuda'
        });

      const health = await provider.healthCheck();

      assert.ok(health.gpu_layers !== undefined, 'Should include gpu_layers');
      assert.strictEqual(health.gpu_layers, 32, 'Should return correct gpu_layers value');
      assert.ok(health.gpu_layers !== 0, 'Should use GPU (gpu_layers > 0)');
      assert.strictEqual(health.device, 'cuda', 'Should indicate CUDA device');
      assert.strictEqual(health.model_loaded, true, 'Model should be loaded');
    });

    test('should indicate GPU usage when gpu_layers is set to all (-1)', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .get('/health')
        .reply(200, {
          status: 'healthy',
          model_repo: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
          model_file: '*Q4_K_M.gguf',
          gpu_layers: -1,
          context_size: 2048,
          model_loaded: true,
          device: 'cuda'
        });

      const health = await provider.healthCheck();

      assert.strictEqual(health.gpu_layers, -1, 'Should indicate all layers on GPU');
      assert.ok(health.device === 'cuda', 'Should use CUDA device');
    });
  });

  describe('_cleanLLMResponse', () => {
    test('should strip "Improved WHAT tags:" preamble', () => {
      const provider = new LocalLLMProvider();
      const input = 'Improved WHAT tags: "tag1, tag2, tag3"';
      assert.strictEqual(provider._cleanLLMResponse(input), 'tag1, tag2, tag3');
    });

    test('should strip "Improved comma-separated WHAT tags:" preamble', () => {
      const provider = new LocalLLMProvider();
      const input = 'Improved comma-separated WHAT tags: "lithe_nymph, college_woman, naked"';
      assert.strictEqual(provider._cleanLLMResponse(input), 'lithe_nymph, college_woman, naked');
    });

    test('should strip trailing Explanation block', () => {
      const provider = new LocalLLMProvider();
      const input = 'tag1, tag2, tag3\n\nExplanation: The critique suggests addressing weaknesses to improve content alignment.';
      assert.strictEqual(provider._cleanLLMResponse(input), 'tag1, tag2, tag3');
    });

    test('should strip trailing Note block', () => {
      const provider = new LocalLLMProvider();
      const input = 'tag1, tag2, tag3\n\nNote: There are duplicate tags due to both WHAT and HOW lists containing them.';
      assert.strictEqual(provider._cleanLLMResponse(input), 'tag1, tag2, tag3');
    });

    test('should strip both preamble and explanation (real-world case)', () => {
      const provider = new LocalLLMProvider();
      const input = 'Improved WHAT tags: "college_woman, nymph-like, lithe_build, naked"\n\nExplanation: The revised WHAT tags focus on content that aligns with the user request.';
      assert.strictEqual(provider._cleanLLMResponse(input), 'college_woman, nymph-like, lithe_build, naked');
    });

    test('should strip "The combined tags" trailing commentary', () => {
      const provider = new LocalLLMProvider();
      const input = 'masterpiece, tag1, tag2\n\nThe combined tags are ordered based on the given hierarchy.';
      assert.strictEqual(provider._cleanLLMResponse(input), 'masterpiece, tag1, tag2');
    });

    test('should strip "Additionally" trailing commentary', () => {
      const provider = new LocalLLMProvider();
      const input = 'tag1, tag2\n\nAdditionally, the tags have been restructured for improved readability.';
      assert.strictEqual(provider._cleanLLMResponse(input), 'tag1, tag2');
    });

    test('should strip "I removed" trailing commentary', () => {
      const provider = new LocalLLMProvider();
      const input = 'tag1, tag2\n\nI removed "gorgeous" as it is subjective.';
      assert.strictEqual(provider._cleanLLMResponse(input), 'tag1, tag2');
    });

    test('should strip "Refined HOW prompt:" preamble', () => {
      const provider = new LocalLLMProvider();
      const input = 'Refined HOW prompt: "dramatic lighting, oil painting style"';
      assert.strictEqual(provider._cleanLLMResponse(input), 'dramatic lighting, oil painting style');
    });

    test('should strip "Here are the tags:" preamble', () => {
      const provider = new LocalLLMProvider();
      const input = 'Here are the tags: tag1, tag2, tag3';
      assert.strictEqual(provider._cleanLLMResponse(input), 'tag1, tag2, tag3');
    });

    test('should strip "Here is the prompt:" preamble', () => {
      const provider = new LocalLLMProvider();
      const input = 'Here is the prompt: A golden retriever in a meadow';
      assert.strictEqual(provider._cleanLLMResponse(input), 'A golden retriever in a meadow');
    });

    test('should pass through clean text unchanged', () => {
      const provider = new LocalLLMProvider();
      const input = 'masterpiece, best_quality, 1girl, dramatic_lighting';
      assert.strictEqual(provider._cleanLLMResponse(input), 'masterpiece, best_quality, 1girl, dramatic_lighting');
    });

    test('should handle whitespace-only input', () => {
      const provider = new LocalLLMProvider();
      assert.strictEqual(provider._cleanLLMResponse('  \n  '), '');
    });

    test('should strip surrounding quotes without preamble', () => {
      const provider = new LocalLLMProvider();
      const input = '"tag1, tag2, tag3"';
      assert.strictEqual(provider._cleanLLMResponse(input), 'tag1, tag2, tag3');
    });

    test('should apply cleanup in refinePrompt responses', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Improved WHAT tags: "tag1, tag2"\n\nExplanation: I improved the tags.', finish_reason: 'stop' }],
          usage: { total_tokens: 50 }
        });

      const result = await provider.refinePrompt('test', { dimension: 'what' });
      assert.strictEqual(result.refinedPrompt, 'tag1, tag2');
    });

    test('should apply cleanup in combinePrompts responses', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'masterpiece, tag1, tag2\n\nNote: Duplicates were removed.', finish_reason: 'stop' }],
          usage: { total_tokens: 50 }
        });

      const result = await provider.combinePrompts('what content', 'how style');
      assert.strictEqual(result.combinedPrompt, 'masterpiece, tag1, tag2');
    });
  });

  describe('OpenAI compatibility', () => {
    test('should format request as OpenAI completions API', async () => {
      const provider = new LocalLLMProvider();

      let capturedBody;
      nock('http://localhost:8003')
        .post('/v1/completions', (body) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          choices: [{ text: 'Response', finish_reason: 'stop' }],
          usage: {}
        });

      await provider.generateText('Test prompt');

      assert.ok(capturedBody.model, 'Should include model');
      assert.ok(capturedBody.prompt, 'Should include prompt');
      assert.strictEqual(typeof capturedBody.max_tokens, 'number', 'max_tokens should be number');
      assert.strictEqual(typeof capturedBody.temperature, 'number', 'temperature should be number');
      assert.strictEqual(typeof capturedBody.top_p, 'number', 'top_p should be number');
      assert.strictEqual(capturedBody.stream, false, 'stream should be false');
    });
  });
});
