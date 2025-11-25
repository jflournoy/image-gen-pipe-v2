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
