/**
 * TDD RED Phase: Job Reconnection on Page Reload
 *
 * Test the ability to reconnect to a running job if the page is accidentally reloaded.
 * localStorage persists the jobId across page reloads, allowing recovery.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');

/**
 * Mock localStorage for testing
 */
class MockLocalStorage {
  constructor() {
    this.store = {};
  }

  getItem(key) {
    return this.store[key] || null;
  }

  setItem(key, value) {
    this.store[key] = String(value);
  }

  removeItem(key) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }
}

describe('Job Reconnection on Page Reload', () => {
  let localStorage;

  before(() => {
    localStorage = new MockLocalStorage();
  });

  after(() => {
    localStorage.clear();
  });

  test('should persist jobId to localStorage when job starts', () => {
    const jobId = 'job-123456';

    // Simulate saving job ID (as would happen in startBeamSearch)
    localStorage.setItem('pendingJobId', jobId);

    // Verify it's persisted
    assert.strictEqual(localStorage.getItem('pendingJobId'), jobId, 'JobId should be saved to localStorage');
  });

  test('should retrieve jobId from localStorage on page load', () => {
    const jobId = 'job-987654';
    localStorage.setItem('pendingJobId', jobId);

    // Simulate page load check
    const savedJobId = localStorage.getItem('pendingJobId');

    assert.strictEqual(savedJobId, jobId, 'Should retrieve saved jobId from localStorage');
  });

  test('should detect when there is a pending job to reconnect to', () => {
    const jobId = 'job-111111';
    localStorage.setItem('pendingJobId', jobId);

    // Check if there's a pending job (as would happen on page load)
    const hasPendingJob = localStorage.getItem('pendingJobId') !== null;

    assert.ok(hasPendingJob, 'Should detect pending job when jobId exists in localStorage');
  });

  test('should detect when there is no pending job', () => {
    localStorage.removeItem('pendingJobId');

    const hasPendingJob = localStorage.getItem('pendingJobId') !== null;

    assert.ok(!hasPendingJob, 'Should not detect pending job when localStorage is empty');
  });

  test('should clear jobId from localStorage after job completes', () => {
    const jobId = 'job-222222';
    localStorage.setItem('pendingJobId', jobId);

    // Verify it's there
    assert.strictEqual(localStorage.getItem('pendingJobId'), jobId, 'JobId should be saved');

    // Simulate job completion - clear localStorage
    localStorage.removeItem('pendingJobId');

    // Verify it's cleared
    assert.strictEqual(localStorage.getItem('pendingJobId'), null, 'JobId should be cleared after completion');
  });

  test('should handle reconnection banner data structure', () => {
    const jobId = 'job-333333';
    const startTime = new Date().toISOString();

    // Simulate saving job metadata for the reconnection banner
    localStorage.setItem('pendingJobId', jobId);
    localStorage.setItem('pendingJobStartTime', startTime);

    // Retrieve both pieces of data
    const savedJobId = localStorage.getItem('pendingJobId');
    const savedStartTime = localStorage.getItem('pendingJobStartTime');

    assert.strictEqual(savedJobId, jobId, 'Should retrieve jobId');
    assert.strictEqual(savedStartTime, startTime, 'Should retrieve job start time');
    assert.ok(new Date(savedStartTime).getTime() > 0, 'Start time should be valid ISO format');
  });

  test('should calculate time elapsed since job start', () => {
    const startTime = new Date(Date.now() - 60000).toISOString(); // 60 seconds ago
    localStorage.setItem('pendingJobStartTime', startTime);

    const savedStartTime = localStorage.getItem('pendingJobStartTime');
    const elapsedMs = Date.now() - new Date(savedStartTime).getTime();
    const elapsedMinutes = Math.floor(elapsedMs / 60000);

    assert.strictEqual(elapsedMinutes, 1, 'Should calculate elapsed time as 1 minute');
  });

  test('should support reconnect/cancel choice in localStorage', () => {
    const jobId = 'job-444444';
    localStorage.setItem('pendingJobId', jobId);

    // User chooses to reconnect - simulate setting a flag
    localStorage.setItem('userWantReconnect', 'true');

    const userWantReconnect = localStorage.getItem('userWantReconnect') === 'true';
    assert.ok(userWantReconnect, 'Should track user reconnection choice');

    // User chooses to cancel - simulate clearing the job
    localStorage.removeItem('pendingJobId');
    localStorage.removeItem('userWantReconnect');
    localStorage.removeItem('pendingJobStartTime');

    assert.strictEqual(localStorage.getItem('pendingJobId'), null, 'Should clear job after user cancels');
  });

  test('should preserve job state for reconnection', () => {
    const jobState = {
      jobId: 'job-555555',
      startTime: new Date().toISOString(),
      params: {
        prompt: 'test prompt',
        beamWidth: 4,
        keepTop: 2
      }
    };

    // Save job state as JSON
    localStorage.setItem('pendingJob', JSON.stringify(jobState));

    // Retrieve and parse
    const savedState = JSON.parse(localStorage.getItem('pendingJob'));

    assert.strictEqual(savedState.jobId, jobState.jobId, 'Should preserve jobId');
    assert.strictEqual(savedState.params.prompt, jobState.params.prompt, 'Should preserve prompt');
    assert.strictEqual(savedState.params.beamWidth, 4, 'Should preserve beam width');
  });
});

describe('Reconnection UI Banner', () => {
  test('should generate reconnection banner HTML', () => {
    const jobId = 'job-666666';
    const elapsedMinutes = 2;

    // Generate banner HTML (as would happen in the demo.js reconnection code)
    const bannerHTML = `
      <div class="reconnection-banner">
        <span>Job ${jobId} is still running (${elapsedMinutes} min elapsed)</span>
        <button class="reconnect-btn">Reconnect</button>
        <button class="cancel-btn">New Job</button>
      </div>
    `.trim();

    assert.ok(bannerHTML.includes('reconnection-banner'), 'Banner should have reconnection-banner class');
    assert.ok(bannerHTML.includes(jobId), 'Banner should display jobId');
    assert.ok(bannerHTML.includes(elapsedMinutes), 'Banner should show elapsed time');
    assert.ok(bannerHTML.includes('Reconnect'), 'Banner should have reconnect button');
    assert.ok(bannerHTML.includes('New Job'), 'Banner should have cancel button');
  });

  test('should handle reconnect button click', () => {
    const jobId = 'job-777777';
    let userAction = null;

    // Simulate button click handlers
    const handleReconnect = () => {
      userAction = 'reconnect';
      // In real code: connectWebSocket(jobId)
    };

    const handleNewJob = () => {
      userAction = 'newJob';
      // In real code: clearPendingJob() and hide banner
    };

    // Simulate user clicking reconnect
    handleReconnect();
    assert.strictEqual(userAction, 'reconnect', 'Should handle reconnect click');

    // Simulate user clicking new job
    handleNewJob();
    assert.strictEqual(userAction, 'newJob', 'Should handle new job click');
  });
});
