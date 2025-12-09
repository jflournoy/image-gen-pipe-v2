/**
 * TDD GREEN Phase: Content Moderation Handler
 *
 * Handles content policy violations from AI models with automatic retry and prompt refinement.
 *
 * Features:
 * - Detects content moderation errors (400 status with policy violation message)
 * - Retries up to maxRetries times (default 3)
 * - Refines prompts using PromptRefiner
 * - Tracks violations and successful refinements
 */

class ContentModerationHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
    this.promptRefiner = options.promptRefiner || null;
    this.violationTracker = options.violationTracker || null;
  }

  /**
   * Check if an error is a content moderation violation
   * @param {Error} error - The error to check
   * @returns {boolean} True if error is a content violation
   */
  isContentViolation(error) {
    if (error.status !== 400) {
      return false;
    }

    const message = error.message.toLowerCase();
    return message.includes('content policy violation') ||
           message.includes('content_policy_violation') ||
           message.includes('inappropriate');
  }

  /**
   * Execute a function with automatic retry on content violations
   * @param {Function} fn - Function to execute (receives refined prompt)
   * @param {string} originalPrompt - The original prompt
   * @returns {Promise<any>} The result from the function
   */
  async executeWithRetry(fn, originalPrompt) {
    let currentPrompt = originalPrompt;
    const refinements = [];
    let attempts = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      attempts++;

      try {
        const result = await fn(currentPrompt);

        // Success! Track if this was a retry
        if (attempt > 0 && this.violationTracker) {
          this.violationTracker.trackSuccess({
            original: originalPrompt,
            refined: currentPrompt,
            attempts: attempt
          });
        }

        return result;
      } catch (error) {
        // Check if this is a content violation
        if (!this.isContentViolation(error)) {
          throw error; // Not a content violation, rethrow
        }

        // If this was the last attempt, track failure and throw
        if (attempt === this.maxRetries) {
          if (this.violationTracker) {
            this.violationTracker.trackFailure({
              original: originalPrompt,
              attempts,
              refinements
            });
          }

          throw new Error(`Max retries (${this.maxRetries}) exceeded for content moderation`);
        }

        // Refine the prompt for next attempt
        if (this.promptRefiner) {
          currentPrompt = this.promptRefiner.refinePrompt(currentPrompt, {
            error,
            attempt,
            originalPrompt
          });
          refinements.push(currentPrompt);
        }
      }
    }
  }
}

module.exports = ContentModerationHandler;
