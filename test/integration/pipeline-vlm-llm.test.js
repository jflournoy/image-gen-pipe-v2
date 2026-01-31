/**
 * 🔴 RED: VLM/LLM Pipeline End-to-End Tests
 *
 * Tests complete pipeline flow: Generation (LLM) → Ranking (VLM) → Refining (LLM)
 * Validates data format compatibility and GPU coordination across pipeline steps
 *
 * Gate: ENABLE_GPU_TESTS=1 to run real services
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');

describe('Pipeline: VLM/LLM Integration', () => {
  let LocalLLMProvider;
  let LocalVLMProvider;
  let modelCoordinator;

  beforeEach(() => {
    // Clear caches for fresh instances
    delete require.cache[require.resolve('../../src/providers/local-llm-provider.js')];
    delete require.cache[require.resolve('../../src/providers/local-vlm-provider.js')];
    delete require.cache[require.resolve('../../src/utils/model-coordinator.js')];

    LocalLLMProvider = require('../../src/providers/local-llm-provider.js');
    LocalVLMProvider = require('../../src/providers/local-vlm-provider.js');
    modelCoordinator = require('../../src/utils/model-coordinator.js');

    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Generation Phase: LLM Expansion', () => {
    test('should expand prompt with WHAT dimension', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{
            text: 'A golden retriever sitting in a sunlit meadow with wildflowers',
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
        });

      const result = await provider.refinePrompt('a dog in a field', {
        dimension: 'what'
      });

      assert.ok(result.refinedPrompt, 'Should return refined prompt');
      assert.ok(result.refinedPrompt.length > 0, 'Refined prompt should not be empty');
      assert.ok(result.metadata.tokensUsed > 0, 'Should track token usage');
      assert.ok(result.metadata.model, 'Should include model metadata');
    });

    test('should expand prompt with HOW dimension', async () => {
      const provider = new LocalLLMProvider();

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{
            text: 'Golden hour lighting, soft focus background, warm color palette, professional photography',
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 40, completion_tokens: 18, total_tokens: 58 }
        });

      const result = await provider.refinePrompt('a dog in a field', {
        dimension: 'how'
      });

      assert.ok(result.refinedPrompt, 'Should return refined prompt');
      assert.ok(result.refinedPrompt.includes('light') || result.refinedPrompt.includes('color') || result.refinedPrompt.includes('professional'));
      assert.ok(result.metadata, 'Should include metadata');
    });

    test('should combine WHAT and HOW prompts', async () => {
      const provider = new LocalLLMProvider();

      const whatPrompt = 'A golden retriever sitting in a sunlit meadow';
      const howPrompt = 'Golden hour lighting, soft focus, warm color palette';

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{
            text: 'A golden retriever sitting in a sunlit meadow with wildflowers, golden hour lighting, soft focus background, warm color palette, professional photography',
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 50, completion_tokens: 35, total_tokens: 85 }
        });

      const result = await provider.combinePrompts(whatPrompt, howPrompt);

      assert.ok(result.combinedPrompt, 'Should return combined prompt');
      assert.ok(result.combinedPrompt.includes('retriever') || result.combinedPrompt.length > 50);
      assert.ok(result.metadata, 'Should include metadata');
      assert.ok(result.metadata.tokensUsed > 0, 'Should track tokens');
    });
  });

  describe('Ranking Phase: VLM Comparison', () => {
    test('should compare two images with VLM', async () => {
      const provider = new LocalVLMProvider();
      provider._axios = {
        post: async () => ({
          data: {
            choice: 'A',
            explanation: 'Image A better matches the prompt with warmer colors',
            confidence: 0.87
          }
        }),
        get: async () => ({ data: {} })
      };

      const result = await provider.compareImages(
        '/tmp/imageA.png',
        '/tmp/imageB.png',
        'A golden retriever in golden hour light'
      );

      assert.ok(['A', 'B'].includes(result.choice), 'Should return A or B');
      assert.ok(result.explanation, 'Should include explanation');
      assert.ok(typeof result.confidence === 'number', 'Should include confidence score');
      assert.ok(result.confidence >= 0 && result.confidence <= 1, 'Confidence should be 0-1');
    });

    test('should rank multiple images using pairwise comparisons', async () => {
      const provider = new LocalVLMProvider();

      // Mock multiple comparison responses (with ranks field required by VLM provider)
      const comparisons = [
        { choice: 'A', explanation: 'A better', confidence: 0.8, ranks: { A: { alignment: 1, aesthetics: 1 }, B: { alignment: 2, aesthetics: 2 } } },
        { choice: 'B', explanation: 'B better', confidence: 0.75, ranks: { A: { alignment: 2, aesthetics: 2 }, B: { alignment: 1, aesthetics: 1 } } },
        { choice: 'A', explanation: 'A better', confidence: 0.85, ranks: { A: { alignment: 1, aesthetics: 1 }, B: { alignment: 2, aesthetics: 2 } } }
      ];

      let comparisonIndex = 0;
      provider._axios = {
        post: async () => ({
          data: comparisons[comparisonIndex++]
        }),
        get: async () => ({ data: {} })
      };

      const candidates = [
        { candidateId: 'img1', localPath: '/tmp/img1.png' },
        { candidateId: 'img2', localPath: '/tmp/img2.png' },
        { candidateId: 'img3', localPath: '/tmp/img3.png' }
      ];

      const result = await provider.rankImages(candidates, 'test prompt', { ensembleSize: 1 });

      assert.ok(result.rankings && Array.isArray(result.rankings), 'Should return object with rankings array');
      assert.strictEqual(result.rankings.length, candidates.length, 'Should rank all candidates');

      // All candidates should be ranked
      const rankedIds = result.rankings.map(r => r.candidateId);
      for (const candidate of candidates) {
        assert.ok(rankedIds.includes(candidate.candidateId), `Should rank candidate ${candidate.candidateId}`);
      }
    });

    test('should include explanation with each ranking', async () => {
      const provider = new LocalVLMProvider();

      provider._axios = {
        post: async () => ({
          data: {
            choice: 'A',
            explanation: 'Better alignment with prompt',
            confidence: 0.9
          }
        }),
        get: async () => ({ data: {} })
      };

      const result = await provider.compareImages(
        '/tmp/img1.png',
        '/tmp/img2.png',
        'test prompt'
      );

      assert.ok(result.explanation, 'Ranking should include explanation');
      assert.strictEqual(typeof result.explanation, 'string', 'Explanation should be string');
      assert.ok(result.explanation.length > 0, 'Explanation should not be empty');
    });
  });

  describe('Refining Phase: Critique-based LLM Refinement', () => {
    test('should refine prompt based on critique with CLIP score', async () => {
      const provider = new LocalLLMProvider();

      const previousResult = {
        prompt: 'A dog in a field',
        clipScore: 0.65,
        aestheticScore: 5.2,
        caption: 'A brown dog'
      };

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{
            text: 'A golden retriever with better details matching the scene more closely',
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 70, completion_tokens: 20, total_tokens: 90 }
        });

      const result = await provider.refinePrompt('A dog in a field', {
        dimension: 'what',
        previousResult
      });

      assert.ok(result.refinedPrompt, 'Should return refined prompt');
      assert.ok(result.refinedPrompt.length > 0, 'Refined prompt should improve on original');
    });

    test('should refine HOW dimension based on aesthetic score', async () => {
      const provider = new LocalLLMProvider();

      const previousResult = {
        prompt: 'A golden retriever in a field',
        clipScore: 0.78,
        aestheticScore: 4.5,
        caption: 'A dog sitting in grass'
      };

      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{
            text: 'Professional studio lighting with shallow depth of field and vibrant colors',
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 70, completion_tokens: 22, total_tokens: 92 }
        });

      const result = await provider.refinePrompt('A golden retriever in a field', {
        dimension: 'how',
        previousResult
      });

      assert.ok(result.refinedPrompt, 'Should return refined how prompt');
      assert.ok(result.refinedPrompt.includes('light') || result.refinedPrompt.includes('color') || result.refinedPrompt.length > 30);
    });
  });

  describe('Complete Pipeline Flow', () => {
    test('should execute generation → ranking → refinement cycle', async () => {
      const llmProvider = new LocalLLMProvider();
      const vlmProvider = new LocalVLMProvider();

      // Mock LLM expansion (WHAT)
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'A golden retriever in a meadow', finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 }
        });

      // Mock LLM expansion (HOW)
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Golden hour lighting, soft focus', finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 }
        });

      // Mock LLM combination
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'A golden retriever in a meadow, golden hour lighting, soft focus', finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
        });

      // Step 1: Generation phase
      const whatResult = await llmProvider.refinePrompt('a dog', { dimension: 'what' });
      assert.ok(whatResult.refinedPrompt, 'WHAT prompt should be generated');

      const howResult = await llmProvider.refinePrompt('a dog', { dimension: 'how' });
      assert.ok(howResult.refinedPrompt, 'HOW prompt should be generated');

      const combinedResult = await llmProvider.combinePrompts(
        whatResult.refinedPrompt,
        howResult.refinedPrompt
      );
      assert.ok(combinedResult.combinedPrompt, 'Combined prompt should be generated');
      const finalPrompt = combinedResult.combinedPrompt;

      // Step 2: Ranking phase (mock VLM comparison with required ranks field)
      vlmProvider._axios = {
        post: async () => ({
          data: {
            choice: 'A',
            explanation: 'Better match',
            confidence: 0.85,
            ranks: { A: { alignment: 1, aesthetics: 1 }, B: { alignment: 2, aesthetics: 2 } }
          }
        }),
        get: async () => ({ data: {} })
      };

      const candidates = [
        { candidateId: 'img1', localPath: '/tmp/img1.png' },
        { candidateId: 'img2', localPath: '/tmp/img2.png' }
      ];

      const result = await vlmProvider.rankImages(candidates, finalPrompt, { ensembleSize: 1 });
      assert.ok(result.rankings && Array.isArray(result.rankings), 'Should return object with rankings array');
      assert.ok(result.rankings.length > 0, 'Should have ranked candidates');

      // Step 3: Refining phase
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Improved prompt based on feedback', finish_reason: 'stop' }],
          usage: { prompt_tokens: 70, completion_tokens: 15, total_tokens: 85 }
        });

      const refinedResult = await llmProvider.refinePrompt(finalPrompt, {
        dimension: 'what',
        previousResult: {
          prompt: finalPrompt,
          clipScore: 0.72,
          aestheticScore: 6.1,
          caption: 'Generated image'
        }
      });

      assert.ok(refinedResult.refinedPrompt, 'Should refine based on critique');

      // Verify complete flow
      assert.ok(whatResult.refinedPrompt, 'Generation step completed');
      assert.ok(result.rankings.length > 0, 'Ranking step completed');
      assert.ok(refinedResult.refinedPrompt, 'Refining step completed');
    });

    test('should maintain data format compatibility across pipeline stages', async () => {
      const llmProvider = new LocalLLMProvider();

      // LLM refine returns {refinedPrompt, metadata}
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(200, {
          choices: [{ text: 'Refined prompt', finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 }
        });

      const result = await llmProvider.refinePrompt('test', { dimension: 'what' });

      // Verify structure
      assert.ok(Object.hasOwn(result, 'refinedPrompt'), 'Should have refinedPrompt field');
      assert.ok(Object.hasOwn(result, 'metadata'), 'Should have metadata field');

      // Verify metadata structure
      assert.ok(result.metadata.tokensUsed, 'Metadata should have tokensUsed');
      assert.ok(result.metadata.model, 'Metadata should have model');
      assert.ok(result.metadata.promptTokens !== undefined, 'Metadata should have promptTokens');
      assert.ok(result.metadata.completionTokens !== undefined, 'Metadata should have completionTokens');
    });

    test('should handle errors gracefully in pipeline', async () => {
      const llmProvider = new LocalLLMProvider();

      // Simulate service unavailable
      nock('http://localhost:8003')
        .post('/v1/completions')
        .reply(503, { error: 'Service unavailable' });

      await assert.rejects(
        () => llmProvider.refinePrompt('test'),
        /Failed to refine prompt/i,
        'Should throw error on service failure'
      );
    });
  });

  describe('GPU Memory Management in Pipeline', () => {
    test('should prepare for LLM before generation phase', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForLLM();

      assert.ok(fluxUnload.isDone(), 'Should unload Flux before LLM operations');
    });

    test('should prepare for image generation after ranking', async () => {
      const llmUnload = nock('http://localhost:8003')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForImageGen();

      assert.ok(llmUnload.isDone(), 'Should unload LLM before image generation');
    });

    test('should prepare for VLM before ranking phase', async () => {
      const fluxUnload = nock('http://localhost:8001')
        .post('/unload')
        .reply(200, { status: 'unloaded' });

      await modelCoordinator.prepareForVLM();

      assert.ok(fluxUnload.isDone(), 'Should unload Flux before VLM operations');
    });
  });
});
