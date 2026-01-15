/**
 * Rate Limiter - Controls concurrent API request execution
 *
 * Limits the number of concurrent promises to a specified maximum.
 * Queues additional tasks and executes them as slots become available.
 */

class RateLimiter {
  constructor(concurrencyLimit) {
    if (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1) {
      throw new Error('Concurrency limit must be a positive integer');
    }
    this.concurrencyLimit = concurrencyLimit;
    this.currentConcurrency = 0;
    this.queue = [];
  }

  /**
   * Execute a task with concurrency limiting
   * @param {Function} taskFn - Async function to execute
   * @returns {Promise} Promise that resolves with task result
   */
  execute(taskFn) {
    return new Promise((resolve, reject) => {
      const task = { taskFn, resolve, reject };

      if (this.currentConcurrency < this.concurrencyLimit) {
        // Slot available, execute immediately
        this._executeTask(task);
      } else {
        // Queue task for later execution
        this.queue.push(task);
      }
    });
  }

  /**
   * Get current rate limiter metrics
   * @returns {Object} Metrics object with active, queued, and limit counts
   */
  getMetrics() {
    return {
      active: this.currentConcurrency,
      queued: this.queue.length,
      limit: this.concurrencyLimit
    };
  }

  /**
   * Update the concurrency limit
   * Takes effect for new tasks; currently running tasks continue
   * @param {number} newLimit - New concurrency limit (positive integer)
   */
  setConcurrencyLimit(newLimit) {
    if (!Number.isInteger(newLimit) || newLimit < 1) {
      throw new Error('Concurrency limit must be a positive integer');
    }
    const oldLimit = this.concurrencyLimit;
    this.concurrencyLimit = newLimit;

    // If we increased the limit and have queued tasks, start more
    if (newLimit > oldLimit && this.queue.length > 0) {
      const slotsToFill = Math.min(
        newLimit - this.currentConcurrency,
        this.queue.length
      );
      for (let i = 0; i < slotsToFill; i++) {
        const task = this.queue.shift();
        if (task) {
          this._executeTask(task);
        }
      }
    }
  }

  /**
   * Execute a task and handle concurrency
   * @private
   * @param {Object} task - Task object with taskFn, resolve, reject
   */
  async _executeTask(task) {
    this.currentConcurrency++;

    try {
      const result = await task.taskFn();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      this.currentConcurrency--;

      // Process queued tasks
      if (this.queue.length > 0) {
        const nextTask = this.queue.shift();
        this._executeTask(nextTask);
      }
    }
  }
}

module.exports = {
  RateLimiter
};
