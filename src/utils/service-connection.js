/**
 * @file Service Connection Utility
 * Shared retry/restart logic for all local service providers.
 * PID-aware: checks if the process is alive before wasting retries.
 *
 * Smart retry flow:
 *   Connection error → check PID
 *     No process → restart immediately (skip retries)
 *     Process alive → 2 quick retries → restart if still failing
 *   Non-connection error → fail immediately
 */

// Quick retry delay when process is alive but not responding (ms)
const QUICK_RETRY_DELAY_MS = 500;
// Number of quick retries before escalating to restart
const QUICK_RETRIES = 2;
// Stabilization delay after restart before retrying (ms)
const POST_RESTART_DELAY_MS = 2000;

/**
 * Detect if an error is a connection error (service unreachable)
 * vs an application error (service responded with an error)
 */
function isConnectionError(error) {
  if (error.code === 'ECONNREFUSED') return true;
  if (error.message && error.message.includes('ECONNREFUSED')) return true;
  if (error.message && error.message.includes('Cannot reach')) return true;
  return false;
}

class ServiceConnection {
  /**
   * @param {Object} options
   * @param {string} options.serviceName - Service identifier ('llm', 'vlm', 'flux', 'vision')
   * @param {Object} options.serviceManager - ServiceManager instance (for isServiceRunning, getServiceUrl)
   * @param {Function|null} options.serviceRestarter - async () => { success, port?, error? }
   * @param {Function} options.onUrlChanged - (newUrl: string) => void
   */
  constructor(options = {}) {
    this.serviceName = options.serviceName;
    this._serviceManager = options.serviceManager;
    this._serviceRestarter = options.serviceRestarter || null;
    this._onUrlChanged = options.onUrlChanged || (() => {});
    // Restart dedup: only one restart per instance at a time
    this._restartPromise = null;
  }

  /**
   * Set/replace the service restarter (dependency injection)
   */
  setServiceRestarter(restarter) {
    this._serviceRestarter = restarter;
  }

  /**
   * Get the current API URL for this service (reads port file)
   */
  getApiUrl() {
    return this._serviceManager.getServiceUrl(this.serviceName);
  }

  /**
   * Execute an operation with smart retry/restart logic.
   *
   * @param {Function} operation - Async function to execute
   * @param {Object} options
   * @param {string} options.operationName - Name for logging
   * @param {boolean} options.attemptRestart - Whether restart is allowed (default true)
   * @returns {Promise<*>} Result of the operation
   */
  async withRetry(operation, options = {}) {
    const { operationName = 'operation', attemptRestart = true } = options;

    // Attempt 1: try the operation directly
    try {
      return await operation();
    } catch (error) {
      if (!isConnectionError(error)) {
        throw error;
      }

      console.warn(
        `[ServiceConnection:${this.serviceName}] ${operationName} failed: ${error.message}`
      );

      // Connection error — check if process is alive
      const processAlive = await this._serviceManager.isServiceRunning(this.serviceName);

      if (!processAlive) {
        // No process → restart immediately (skip retries)
        return await this._restartAndRetry(operation, operationName, attemptRestart);
      }

      // Process is alive but not responding → quick retries
      return await this._quickRetryThenRestart(operation, operationName, attemptRestart);
    }
  }

  /**
   * Restart the service and retry the operation once.
   * Respects STOP_LOCK - if lock exists, restart is blocked.
   * Deduplicates concurrent restart attempts: if a restart is already in
   * progress, subsequent callers wait for it instead of spawning another.
   */
  async _restartAndRetry(operation, operationName, attemptRestart) {
    if (!attemptRestart || !this._serviceRestarter) {
      throw new Error(
        `[${this.serviceName}] Service is not running and no restarter available. ` +
        'Start the service manually or check configuration.'
      );
    }

    // Check for STOP_LOCK - if it exists, don't auto-restart
    const hasStopLock = await this._serviceManager.hasStopLock(this.serviceName);
    if (hasStopLock) {
      console.log(
        `[ServiceConnection:${this.serviceName}] STOP_LOCK exists - skipping auto-restart`
      );
      throw new Error(
        `[${this.serviceName}] Service is stopped by user (STOP_LOCK exists). ` +
        'Restart manually or remove STOP_LOCK to allow auto-restart.'
      );
    }

    // Deduplicate: if restart already in progress, wait for it
    if (this._restartPromise) {
      console.log(
        `[ServiceConnection:${this.serviceName}] Restart already in progress, waiting...`
      );
      await this._restartPromise;
      this._updateUrl();
      return await operation();
    }

    // Start the restart and store the promise so concurrent callers can wait
    console.log(
      `[ServiceConnection:${this.serviceName}] Process not running, attempting restart...`
    );
    this._restartPromise = this._doRestart();
    try {
      await this._restartPromise;
    } finally {
      this._restartPromise = null;
    }

    // Update URL from port file after restart
    this._updateUrl();

    // Wait for service to stabilize
    await new Promise(resolve => setTimeout(resolve, POST_RESTART_DELAY_MS));

    // Single retry after restart
    console.log(
      `[ServiceConnection:${this.serviceName}] Service restarted, retrying ${operationName}...`
    );
    return await operation();
  }

  /**
   * Perform the actual restart (called once, awaited by all concurrent callers).
   * @private
   */
  async _doRestart() {
    const restartResult = await this._serviceRestarter();
    if (!restartResult.success) {
      throw new Error(
        `[${this.serviceName}] Service restart failed: ${restartResult.error || 'unknown error'}`
      );
    }
  }

  /**
   * Quick retries for when the process is alive but not responding.
   * After quick retries are exhausted, escalate to restart.
   */
  async _quickRetryThenRestart(operation, operationName, attemptRestart) {
    for (let i = 0; i < QUICK_RETRIES; i++) {
      console.log(
        `[ServiceConnection:${this.serviceName}] Process alive, quick retry ${i + 1}/${QUICK_RETRIES}...`
      );
      await new Promise(resolve => setTimeout(resolve, QUICK_RETRY_DELAY_MS));

      try {
        return await operation();
      } catch (retryError) {
        if (!isConnectionError(retryError)) {
          throw retryError;
        }
        // Still a connection error, continue retrying
      }
    }

    // Quick retries exhausted — escalate to restart
    console.warn(
      `[ServiceConnection:${this.serviceName}] Quick retries exhausted, escalating to restart...`
    );
    return await this._restartAndRetry(operation, operationName, attemptRestart);
  }

  /**
   * Read current URL from port file and notify provider
   */
  _updateUrl() {
    const newUrl = this._serviceManager.getServiceUrl(this.serviceName);
    this._onUrlChanged(newUrl);
  }
}

module.exports = ServiceConnection;
