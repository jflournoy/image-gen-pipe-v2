/**
 * TDD RED Phase: Prompt Refiner Tests
 *
 * Feature: LLM-powered prompt refinement for content policy violations
 *
 * Requirements:
 * - Use LLM to refine prompts that triggered content violations
 * - Preserve original intent as much as possible
 * - Make minimal necessary changes
 * - Use ViolationTracker to find similar past violations for guidance
 * - Support fallback when ViolationTracker not available
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const PromptRefiner = require('../../src/services/prompt-refiner.js');

describe('PromptRefiner', () => {
  describe('constructor', () => {
    it('should initialize with API key', () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });
      assert.ok(refiner);
      assert.strictEqual(refiner.apiKey, 'test-key');
    });

    it('should use environment API key if not provided', () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'env-test-key';

      const refiner = new PromptRefiner();
      assert.strictEqual(refiner.apiKey, 'env-test-key');

      process.env.OPENAI_API_KEY = originalKey;
    });

    it('should accept optional ViolationTracker', () => {
      const tracker = { findSimilar: () => [] };
      const refiner = new PromptRefiner({
        apiKey: 'test-key',
        violationTracker: tracker
      });
      assert.strictEqual(refiner.violationTracker, tracker);
    });

    it('should accept model configuration', () => {
      const refiner = new PromptRefiner({
        apiKey: 'test-key',
        model: 'gpt-4o'
      });
      assert.strictEqual(refiner.model, 'gpt-4o');
    });

    it('should use default model from config if not specified', () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });
      assert.ok(refiner.model); // Should have a default model
    });
  });

  describe('refinePrompt', () => {
    it('should refine a prompt using LLM', async () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });

      // Mock the LLM client
      let llmCalled = false;
      refiner.client = {
        chat: {
          completions: {
            create: async (params) => {
              llmCalled = true;
              assert.ok(params.messages);
              assert.strictEqual(params.messages.length, 2); // system + user
              return {
                choices: [{
                  message: {
                    content: 'A safe refined prompt'
                  }
                }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 150 }
              };
            }
          }
        }
      };

      const result = await refiner.refinePrompt('unsafe prompt', {
        error: new Error('Content policy violation'),
        attempt: 1,
        originalPrompt: 'unsafe prompt'
      });

      assert.strictEqual(result, 'A safe refined prompt');
      assert.strictEqual(llmCalled, true);
    });

    it('should include error context in LLM prompt', async () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });

      let capturedUserMessage = null;
      refiner.client = {
        chat: {
          completions: {
            create: async (params) => {
              capturedUserMessage = params.messages[1].content;
              return {
                choices: [{
                  message: { content: 'refined' }
                }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 100 }
              };
            }
          }
        }
      };

      const error = new Error('Content policy violation: inappropriate content');
      await refiner.refinePrompt('problematic prompt', {
        error,
        attempt: 1,
        originalPrompt: 'problematic prompt'
      });

      assert.ok(capturedUserMessage);
      assert.ok(capturedUserMessage.includes('problematic prompt'));
      assert.ok(capturedUserMessage.includes('Content policy violation'));
    });

    it('should use ViolationTracker to find similar examples', async () => {
      const tracker = {
        findSimilar: (prompt) => {
          assert.strictEqual(prompt, 'current unsafe prompt');
          return [
            {
              original: 'previous unsafe prompt',
              refined: 'previous safe prompt',
              similarity: 0.85
            }
          ];
        }
      };

      const refiner = new PromptRefiner({
        apiKey: 'test-key',
        violationTracker: tracker
      });

      let capturedUserMessage = null;
      refiner.client = {
        chat: {
          completions: {
            create: async (params) => {
              capturedUserMessage = params.messages[1].content;
              return {
                choices: [{
                  message: { content: 'refined based on examples' }
                }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 200 }
              };
            }
          }
        }
      };

      await refiner.refinePrompt('current unsafe prompt', {
        error: new Error('Content violation'),
        attempt: 1,
        originalPrompt: 'current unsafe prompt'
      });

      assert.ok(capturedUserMessage);
      assert.ok(capturedUserMessage.includes('previous unsafe prompt'));
      assert.ok(capturedUserMessage.includes('previous safe prompt'));
    });

    it('should work without ViolationTracker', async () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });

      let llmCalled = false;
      refiner.client = {
        chat: {
          completions: {
            create: async (_params) => {
              llmCalled = true;
              return {
                choices: [{
                  message: { content: 'refined without examples' }
                }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 120 }
              };
            }
          }
        }
      };

      const result = await refiner.refinePrompt('unsafe prompt', {
        error: new Error('Content violation'),
        attempt: 1,
        originalPrompt: 'unsafe prompt'
      });

      assert.strictEqual(result, 'refined without examples');
      assert.strictEqual(llmCalled, true);
    });

    it('should include attempt number in context', async () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });

      let capturedUserMessage = null;
      refiner.client = {
        chat: {
          completions: {
            create: async (params) => {
              capturedUserMessage = params.messages[1].content;
              return {
                choices: [{
                  message: { content: 'refined' }
                }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 100 }
              };
            }
          }
        }
      };

      await refiner.refinePrompt('prompt', {
        error: new Error('violation'),
        attempt: 2,
        originalPrompt: 'original'
      });

      assert.ok(capturedUserMessage.includes('2')); // Attempt number
    });

    it('should handle LLM errors gracefully', async () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });

      refiner.client = {
        chat: {
          completions: {
            create: async () => {
              throw new Error('LLM API error');
            }
          }
        }
      };

      await assert.rejects(
        async () => refiner.refinePrompt('prompt', {
          error: new Error('violation'),
          attempt: 1,
          originalPrompt: 'prompt'
        }),
        /LLM API error|Failed to refine prompt/
      );
    });

    it('should respect model-specific parameters (gpt-5 vs others)', async () => {
      const refiner = new PromptRefiner({
        apiKey: 'test-key',
        model: 'gpt-5-mini'
      });

      let capturedParams = null;
      refiner.client = {
        chat: {
          completions: {
            create: async (params) => {
              capturedParams = params;
              return {
                choices: [{
                  message: { content: 'refined' }
                }],
                model: 'gpt-5-mini',
                usage: { total_tokens: 100 }
              };
            }
          }
        }
      };

      await refiner.refinePrompt('prompt', {
        error: new Error('violation'),
        attempt: 1,
        originalPrompt: 'prompt'
      });

      // gpt-5 models should use max_completion_tokens, not max_tokens
      assert.ok(capturedParams.max_completion_tokens !== undefined ||
                capturedParams.max_tokens !== undefined);

      // gpt-5 models should NOT have custom temperature
      if (refiner.model.includes('gpt-5')) {
        assert.strictEqual(capturedParams.temperature, undefined);
      }
    });

    it('should limit token usage appropriately', async () => {
      const refiner = new PromptRefiner({ apiKey: 'test-key' });

      let capturedParams = null;
      refiner.client = {
        chat: {
          completions: {
            create: async (params) => {
              capturedParams = params;
              return {
                choices: [{
                  message: { content: 'refined' }
                }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 100 }
              };
            }
          }
        }
      };

      await refiner.refinePrompt('prompt', {
        error: new Error('violation'),
        attempt: 1,
        originalPrompt: 'prompt'
      });

      // Should have reasonable token limit
      const tokenLimit = capturedParams.max_tokens || capturedParams.max_completion_tokens;
      assert.ok(tokenLimit > 0);
      assert.ok(tokenLimit <= 1000); // Refinement shouldn't need huge responses
    });
  });

  describe('integration', () => {
    it('should refine prompt preserving intent', async () => {
      // This is a conceptual test - in reality we'd need real LLM
      const refiner = new PromptRefiner({ apiKey: 'test-key' });

      refiner.client = {
        chat: {
          completions: {
            create: async (params) => {
              // Simulate LLM that understands the task
              const userMessage = params.messages[1].content;

              // If prompt contains "battle", refine to "competition"
              if (userMessage.includes('epic battle')) {
                return {
                  choices: [{
                    message: {
                      content: 'A dynamic competitive sports scene between two teams'
                    }
                  }],
                  model: 'gpt-4o-mini',
                  usage: { total_tokens: 150 }
                };
              }

              return {
                choices: [{
                  message: { content: 'A safe generic scene' }
                }],
                model: 'gpt-4o-mini',
                usage: { total_tokens: 100 }
              };
            }
          }
        }
      };

      const result = await refiner.refinePrompt('An epic battle scene', {
        error: new Error('Content policy violation: violence'),
        attempt: 1,
        originalPrompt: 'An epic battle scene'
      });

      assert.ok(result);
      assert.ok(result.length > 0);
      // Should not contain the violating word
      assert.ok(!result.toLowerCase().includes('battle'));
    });
  });
});
