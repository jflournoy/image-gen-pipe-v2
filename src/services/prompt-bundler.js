/**
 * Prompt Bundler
 * Bundles multiple LLM operations (expand, combine, refine) for efficient batch submission
 * Reduces latency by grouping similar operations and submitting them together
 */

class PromptBundler {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize || 10;
    this.results = new Map();
  }

  /**
   * Bundle operations into batches by type and dimension
   * @param {Array<Object>} operations - Operations to bundle
   * @returns {Object} Bundle with batches and metadata
   */
  bundle(operations) {
    if (!operations || operations.length === 0) {
      return {
        batches: [],
        metadata: {
          totalOperations: 0,
          totalBatches: 0,
          bundledAt: new Date().toISOString()
        }
      };
    }

    // Group operations by type and dimension
    const grouped = this._groupOperations(operations);

    // Split groups into batches respecting maxBatchSize
    const batches = [];
    for (const [key, ops] of Object.entries(grouped)) {
      const batchesForGroup = this._createBatches(ops, key);
      batches.push(...batchesForGroup);
    }

    return {
      batches,
      metadata: {
        totalOperations: operations.length,
        totalBatches: batches.length,
        bundledAt: new Date().toISOString()
      }
    };
  }

  /**
   * Group operations by type and dimension
   * @private
   */
  _groupOperations(operations) {
    const grouped = {};

    for (const op of operations) {
      let key;

      if (op.type === 'expand') {
        key = `expand:${op.dimension}`;
      } else if (op.type === 'combine') {
        key = 'combine';
      } else if (op.type === 'refine') {
        key = `refine:${op.dimension}`;
      } else if (op.type === 'critique') {
        key = `critique:${op.dimension || 'any'}`;
      } else {
        key = op.type;
      }

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(op);
    }

    return grouped;
  }

  /**
   * Create batches from grouped operations
   * @private
   */
  _createBatches(ops, groupKey) {
    const batches = [];
    const [type, ...dimensionParts] = groupKey.split(':');
    const dimension = dimensionParts.join(':') || null;

    // Split into chunks of maxBatchSize
    for (let i = 0; i < ops.length; i += this.maxBatchSize) {
      const chunk = ops.slice(i, i + this.maxBatchSize);

      batches.push({
        id: `batch-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        dimension,
        operations: chunk,
        size: chunk.length
      });
    }

    return batches;
  }

  /**
   * Record result for a completed operation
   * @param {string} operationId - Operation ID
   * @param {Object} result - Result data with id and other fields
   */
  recordResult(operationId, result) {
    this.results.set(operationId, {
      id: operationId,
      ...result
    });
  }

  /**
   * Get result for a single operation
   * @param {string} operationId - Operation ID
   * @returns {Object|null} Result or null if not found
   */
  getResult(operationId) {
    return this.results.get(operationId) || null;
  }

  /**
   * Get results for multiple operations
   * @param {Array<string>} operationIds - Operation IDs
   * @returns {Array<Object>} Results in same order as IDs
   */
  getResults(operationIds) {
    return operationIds.map(id => this.getResult(id)).filter(r => r !== null);
  }

  /**
   * Clear all recorded results
   */
  clearResults() {
    this.results.clear();
  }

  /**
   * Get bundling statistics
   * @returns {Object} Statistics about bundled operations
   */
  getStats() {
    return {
      recordedResults: this.results.size,
      maxBatchSize: this.maxBatchSize
    };
  }
}

module.exports = PromptBundler;
