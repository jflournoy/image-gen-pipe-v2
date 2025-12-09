/**
 * TDD RED Phase: Prompt Bundler Tests
 *
 * Bundles multiple prompt operations for batch submission to reduce latency
 * and improve throughput during beam search expansion phase
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const PromptBundler = require('../../src/services/prompt-bundler.js');

describe('🔴 Prompt Bundler - Bundle Operations for Efficient Submission', () => {

  describe('Basic Bundling', () => {
    it('should bundle multiple expand operations with same dimension', () => {
      const bundler = new PromptBundler();

      const operations = [
        { id: 'op1', type: 'expand', dimension: 'what', prompt: 'initial prompt' },
        { id: 'op2', type: 'expand', dimension: 'what', prompt: 'initial prompt' },
        { id: 'op3', type: 'expand', dimension: 'what', prompt: 'initial prompt' }
      ];

      const bundle = bundler.bundle(operations);

      assert.strictEqual(bundle.batches.length, 1, 'Should create 1 batch for same operation type');
      assert.strictEqual(bundle.batches[0].operations.length, 3, 'Batch should contain 3 operations');
      assert.strictEqual(bundle.batches[0].type, 'expand', 'Batch type should be expand');
      assert.strictEqual(bundle.batches[0].dimension, 'what', 'Batch dimension should be what');
    });

    it('should separate operations by type and dimension', () => {
      const bundler = new PromptBundler();

      const operations = [
        { id: 'op1', type: 'expand', dimension: 'what', prompt: 'initial prompt' },
        { id: 'op2', type: 'expand', dimension: 'how', prompt: 'initial prompt' },
        { id: 'op3', type: 'combine', whatPrompt: 'what', howPrompt: 'how' },
        { id: 'op4', type: 'expand', dimension: 'what', prompt: 'initial prompt' }
      ];

      const bundle = bundler.bundle(operations);

      assert.strictEqual(bundle.batches.length, 3, 'Should create 3 separate batches');

      // Verify batches are grouped correctly
      const whatExpandBatch = bundle.batches.find(b => b.type === 'expand' && b.dimension === 'what');
      const howExpandBatch = bundle.batches.find(b => b.type === 'expand' && b.dimension === 'how');
      const combineBatch = bundle.batches.find(b => b.type === 'combine');

      assert.ok(whatExpandBatch, 'Should have WHAT expand batch');
      assert.ok(howExpandBatch, 'Should have HOW expand batch');
      assert.ok(combineBatch, 'Should have combine batch');

      assert.strictEqual(whatExpandBatch.operations.length, 2, 'WHAT expand batch should have 2 ops');
      assert.strictEqual(howExpandBatch.operations.length, 1, 'HOW expand batch should have 1 op');
      assert.strictEqual(combineBatch.operations.length, 1, 'Combine batch should have 1 op');
    });

    it('should maintain operation order within batches', () => {
      const bundler = new PromptBundler();

      const operations = [
        { id: 'first', type: 'expand', dimension: 'what', prompt: 'initial' },
        { id: 'second', type: 'expand', dimension: 'what', prompt: 'initial' },
        { id: 'third', type: 'expand', dimension: 'what', prompt: 'initial' }
      ];

      const bundle = bundler.bundle(operations);
      const operationIds = bundle.batches[0].operations.map(op => op.id);

      assert.deepStrictEqual(operationIds, ['first', 'second', 'third'], 'Operations should maintain order');
    });
  });

  describe('Bundle Limits', () => {
    it('should split batch if it exceeds max size', () => {
      const bundler = new PromptBundler({ maxBatchSize: 2 });

      const operations = Array(5).fill(null).map((_, i) => ({
        id: `op${i}`,
        type: 'expand',
        dimension: 'what',
        prompt: 'initial prompt'
      }));

      const bundle = bundler.bundle(operations);

      assert.strictEqual(bundle.batches.length, 3, 'Should create 3 batches (2+2+1)');
      assert.strictEqual(bundle.batches[0].operations.length, 2);
      assert.strictEqual(bundle.batches[1].operations.length, 2);
      assert.strictEqual(bundle.batches[2].operations.length, 1);
    });

    it('should return bundle metadata with submission info', () => {
      const bundler = new PromptBundler();

      const operations = [
        { id: 'op1', type: 'expand', dimension: 'what', prompt: 'prompt' },
        { id: 'op2', type: 'expand', dimension: 'what', prompt: 'prompt' }
      ];

      const bundle = bundler.bundle(operations);

      assert.ok(bundle.metadata, 'Bundle should have metadata');
      assert.strictEqual(bundle.metadata.totalOperations, 2, 'Should track total operations');
      assert.strictEqual(bundle.metadata.totalBatches, 1, 'Should track total batches');
      assert.ok(bundle.metadata.bundledAt, 'Should have bundle timestamp');
    });
  });

  describe('Submission Tracking', () => {
    it('should track submitted operations and results', () => {
      const bundler = new PromptBundler();

      const operation = { id: 'op1', type: 'expand', dimension: 'what', prompt: 'prompt' };
      bundler.bundle([operation]);

      // Simulate submission
      const result = { id: 'op1', refinedPrompt: 'expanded prompt' };
      bundler.recordResult('op1', result);

      const tracked = bundler.getResult('op1');
      assert.deepStrictEqual(tracked, result, 'Should retrieve recorded result');
    });

    it('should batch retrieve results for operations', () => {
      const bundler = new PromptBundler();

      const operations = [
        { id: 'op1', type: 'expand', dimension: 'what', prompt: 'prompt' },
        { id: 'op2', type: 'expand', dimension: 'what', prompt: 'prompt' }
      ];

      bundler.bundle(operations);

      // Record results
      bundler.recordResult('op1', { refinedPrompt: 'expanded1' });
      bundler.recordResult('op2', { refinedPrompt: 'expanded2' });

      // Get all results
      const results = bundler.getResults(['op1', 'op2']);

      assert.strictEqual(results.length, 2, 'Should return all results');
      assert.strictEqual(results[0].id, 'op1');
      assert.strictEqual(results[1].id, 'op2');
    });
  });

  describe('Integration with Beam Search', () => {
    it('should support bundling initial expansion phase operations', () => {
      const bundler = new PromptBundler();

      // Simulate N=4 expansion (4 WHAT ops + 4 HOW ops)
      const operations = [
        // WHAT expand operations
        ...Array(4).fill(null).map((_, i) => ({
          id: `what-${i}`,
          type: 'expand',
          dimension: 'what',
          prompt: 'initial prompt',
          candidateId: i
        })),
        // HOW expand operations
        ...Array(4).fill(null).map((_, i) => ({
          id: `how-${i}`,
          type: 'expand',
          dimension: 'how',
          prompt: 'initial prompt',
          candidateId: i
        }))
      ];

      const bundle = bundler.bundle(operations);

      // Should have 2 batches: one for WHAT, one for HOW
      assert.strictEqual(bundle.batches.length, 2, 'Should have 2 batches (WHAT and HOW)');

      const whatBatch = bundle.batches.find(b => b.dimension === 'what');
      const howBatch = bundle.batches.find(b => b.dimension === 'how');

      assert.strictEqual(whatBatch.operations.length, 4, 'WHAT batch should have 4 ops');
      assert.strictEqual(howBatch.operations.length, 4, 'HOW batch should have 4 ops');
    });

    it('should support combining bundled WHAT+HOW pairs', () => {
      const bundler = new PromptBundler();

      // After expansion, combine WHAT+HOW pairs
      const operations = Array(4).fill(null).map((_, i) => ({
        id: `combine-${i}`,
        type: 'combine',
        whatPrompt: `expanded what ${i}`,
        howPrompt: `expanded how ${i}`,
        candidateId: i
      }));

      const bundle = bundler.bundle(operations);

      assert.strictEqual(bundle.batches.length, 1, 'Should have 1 combine batch');
      assert.strictEqual(bundle.batches[0].operations.length, 4, 'Batch should have 4 combine ops');
    });
  });

  describe('Empty and Edge Cases', () => {
    it('should handle empty operation list', () => {
      const bundler = new PromptBundler();
      const bundle = bundler.bundle([]);

      assert.strictEqual(bundle.batches.length, 0, 'Should return empty batches array');
      assert.strictEqual(bundle.metadata.totalOperations, 0);
    });

    it('should handle single operation', () => {
      const bundler = new PromptBundler();
      const operations = [{ id: 'op1', type: 'expand', dimension: 'what', prompt: 'prompt' }];

      const bundle = bundler.bundle(operations);

      assert.strictEqual(bundle.batches.length, 1);
      assert.strictEqual(bundle.batches[0].operations.length, 1);
    });
  });
});
