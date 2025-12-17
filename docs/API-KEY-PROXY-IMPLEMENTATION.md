# API Key Proxy Implementation - TDD Breakdown

## Overview

Implement user-provided API keys with no server fallback. Users must provide their own OpenAI API key via `X-OpenAI-API-Key` header.

---

## Phase 1: Backend API Route (Server)

### Issue 1.1: Reject requests without API key header

**🔴 RED - Write failing test first**

```javascript
// test/api-key-validation.test.js
describe('API Key Validation', () => {
  it('should reject POST /api/beam-search/start without X-OpenAI-API-Key header', async () => {
    const response = await fetch('http://localhost:3000/api/beam-search/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' })
    });

    assert.strictEqual(response.status, 401);
    const data = await response.json();
    assert.ok(data.error.includes('API key'));
  });
});
```

**🟢 GREEN - Implement validation middleware**

File: `src/api/server.js`
- Add middleware to extract `X-OpenAI-API-Key` header
- Return 401 if missing
- Store in `req.userApiKey` for downstream use

**🔄 REFACTOR**
- Extract validation to reusable middleware function

---

### Issue 1.2: Reject invalid API key format

**🔴 RED**

```javascript
it('should reject API key not starting with sk-', async () => {
  const response = await fetch('http://localhost:3000/api/beam-search/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenAI-API-Key': 'invalid-key-format'
    },
    body: JSON.stringify({ prompt: 'test' })
  });

  assert.strictEqual(response.status, 400);
  const data = await response.json();
  assert.ok(data.error.includes('Invalid API key format'));
});
```

**🟢 GREEN**

File: `src/api/server.js`
- Validate key starts with `sk-`
- Return 400 with descriptive error if invalid

---

### Issue 1.3: Accept valid API key and pass to worker

**🔴 RED**

```javascript
it('should accept valid API key and start job', async () => {
  const response = await fetch('http://localhost:3000/api/beam-search/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenAI-API-Key': 'sk-test-key-12345'
    },
    body: JSON.stringify({ prompt: 'test', n: 2, m: 1, iterations: 1 })
  });

  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.ok(data.jobId);
});
```

**🟢 GREEN**

File: `src/api/server.js`
- Pass `req.userApiKey` to `startBeamSearchJob()`
- Update function signature to accept API key parameter

---

## Phase 2: Backend Worker (Beam Search)

### Issue 2.1: Worker requires API key parameter

**🔴 RED**

```javascript
// test/beam-search-worker-apikey.test.js
describe('Beam Search Worker - API Key', () => {
  it('should throw error if userApiKey is not provided', async () => {
    await assert.rejects(
      () => startBeamSearchJob('job-123', { prompt: 'test' }, null),
      { message: /API key.*required/i }
    );
  });
});
```

**🟢 GREEN**

File: `src/api/beam-search-worker.js`
- Update `startBeamSearchJob(jobId, params, userApiKey)` signature
- Add validation: throw if `!userApiKey`

---

### Issue 2.2: Worker passes API key to provider factory

**🔴 RED**

```javascript
it('should pass userApiKey to provider factory', async () => {
  // Mock provider factory to capture apiKey
  let capturedApiKey = null;
  const mockCreateLLMProvider = (opts) => {
    capturedApiKey = opts.apiKey;
    return mockLLMProvider;
  };

  await startBeamSearchJob('job-123', { prompt: 'test' }, 'sk-user-key-123');

  assert.strictEqual(capturedApiKey, 'sk-user-key-123');
});
```

**🟢 GREEN**

File: `src/api/beam-search-worker.js`
- Update provider creation to pass `{ apiKey: userApiKey }`
- Apply to: llm, imageGen, vision, critiqueGen, imageRanker

---

### Issue 2.3: Worker does NOT use process.env.OPENAI_API_KEY

**🔴 RED**

```javascript
it('should NOT fall back to OPENAI_API_KEY env var', async () => {
  process.env.OPENAI_API_KEY = 'sk-server-key-should-not-use';

  let capturedApiKey = null;
  // ... mock provider factory

  await startBeamSearchJob('job-123', { prompt: 'test' }, 'sk-user-key-123');

  assert.strictEqual(capturedApiKey, 'sk-user-key-123');
  assert.notStrictEqual(capturedApiKey, 'sk-server-key-should-not-use');
});
```

**🟢 GREEN**

File: `src/api/beam-search-worker.js`
- Remove any `process.env.OPENAI_API_KEY` fallback
- Only use the passed `userApiKey`

---

## Phase 3: Provider Factory Updates

### Issue 3.1: LLM Provider accepts apiKey option

**🔴 RED**

```javascript
// test/provider-apikey.test.js
describe('Provider Factory - API Key', () => {
  it('createLLMProvider should use provided apiKey', () => {
    const provider = createLLMProvider({ apiKey: 'sk-custom-key' });
    // Verify internal client uses custom key
    assert.strictEqual(provider._client.apiKey, 'sk-custom-key');
  });
});
```

**🟢 GREEN**

File: `src/factory/provider-factory.js`
- Update `createLLMProvider(options)` to accept `apiKey`
- Pass to OpenAI client constructor

---

### Issue 3.2: Image Provider accepts apiKey option

**🔴 RED**

```javascript
it('createImageProvider should use provided apiKey', () => {
  const provider = createImageProvider({ apiKey: 'sk-custom-key' });
  assert.strictEqual(provider._client.apiKey, 'sk-custom-key');
});
```

**🟢 GREEN**

File: `src/factory/provider-factory.js`
- Update `createImageProvider(options)` to accept `apiKey`

---

### Issue 3.3: Vision Provider accepts apiKey option

**🔴 RED**

```javascript
it('createVisionProvider should use provided apiKey', () => {
  const provider = createVisionProvider({ apiKey: 'sk-custom-key' });
  assert.strictEqual(provider._client.apiKey, 'sk-custom-key');
});
```

**🟢 GREEN**

File: `src/factory/provider-factory.js`
- Update `createVisionProvider(options)` to accept `apiKey`

---

### Issue 3.4: Critique Generator accepts apiKey option

**🔴 RED**

```javascript
it('createCritiqueGenerator should use provided apiKey', () => {
  const provider = createCritiqueGenerator({ apiKey: 'sk-custom-key' });
  assert.strictEqual(provider._client.apiKey, 'sk-custom-key');
});
```

**🟢 GREEN**

File: `src/factory/provider-factory.js`
- Update `createCritiqueGenerator(options)` to accept `apiKey`

---

### Issue 3.5: Image Ranker accepts apiKey option

**🔴 RED**

```javascript
it('createImageRanker should use provided apiKey', () => {
  const provider = createImageRanker({ apiKey: 'sk-custom-key' });
  assert.strictEqual(provider._client.apiKey, 'sk-custom-key');
});
```

**🟢 GREEN**

File: `src/factory/provider-factory.js`
- Update `createImageRanker(options)` to accept `apiKey`

---

## Phase 4: Frontend (Demo UI)

### Issue 4.1: Add API key input field to form

**🔴 RED** (Manual UI test)

- Load demo.html
- Verify NO API key input field exists
- Test fails

**🟢 GREEN**

File: `public/demo.html`
- Add password input with id="apiKey"
- Add required attribute
- Add helper text explaining key is not stored
- Add link to OpenAI API keys page

---

### Issue 4.2: Frontend validates API key before submission

**🔴 RED**

```javascript
// test/demo-apikey-validation.test.js (browser test or manual)
it('should show error if API key is empty', async () => {
  // Clear API key field
  document.getElementById('apiKey').value = '';
  // Click start
  document.getElementById('startBtn').click();
  // Should show error message
  const messages = document.getElementById('messages');
  assert.ok(messages.textContent.includes('API key is required'));
});
```

**🟢 GREEN**

File: `public/demo.js`
- In `startBeamSearch()`, validate `apiKey` is not empty
- Show error via `addMessage()` if empty
- Return early (don't submit)

---

### Issue 4.3: Frontend validates API key format

**🔴 RED**

```javascript
it('should show error if API key format is invalid', async () => {
  document.getElementById('apiKey').value = 'invalid-key';
  document.getElementById('startBtn').click();
  const messages = document.getElementById('messages');
  assert.ok(messages.textContent.includes('Invalid API key format'));
});
```

**🟢 GREEN**

File: `public/demo.js`
- Check `apiKey.startsWith('sk-')`
- Show descriptive error if invalid

---

### Issue 4.4: Frontend sends API key in request header

**🔴 RED**

```javascript
it('should include X-OpenAI-API-Key header in request', async () => {
  // Mock fetch to capture headers
  let capturedHeaders = null;
  window.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return { ok: true, json: () => ({ jobId: 'test' }) };
  };

  document.getElementById('apiKey').value = 'sk-test-key';
  document.getElementById('prompt').value = 'test prompt';
  await startBeamSearch();

  assert.strictEqual(capturedHeaders['X-OpenAI-API-Key'], 'sk-test-key');
});
```

**🟢 GREEN**

File: `public/demo.js`
- In fetch call, add `'X-OpenAI-API-Key': apiKey` to headers

---

### Issue 4.5: Frontend persists API key in sessionStorage

**🔴 RED**

```javascript
it('should save API key to sessionStorage for session persistence', () => {
  document.getElementById('apiKey').value = 'sk-test-key';
  // Trigger save (on input or on submit)
  // ...
  assert.strictEqual(sessionStorage.getItem('openaiApiKey'), 'sk-test-key');
});

it('should restore API key from sessionStorage on page load', () => {
  sessionStorage.setItem('openaiApiKey', 'sk-saved-key');
  // Simulate page load / DOMContentLoaded
  // ...
  assert.strictEqual(document.getElementById('apiKey').value, 'sk-saved-key');
});
```

**🟢 GREEN**

File: `public/demo.js`
- Save to `sessionStorage` on input change
- Restore from `sessionStorage` on `DOMContentLoaded`
- Note: sessionStorage clears on tab close (more secure than localStorage)

---

## Phase 5: Security & Logging

### Issue 5.1: API key is never logged on server

**🔴 RED**

```javascript
it('should not log API key in server logs', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  await startBeamSearchJob('job-123', { prompt: 'test' }, 'sk-secret-key-12345');

  console.log = originalLog;

  const allLogs = logs.join('\n');
  assert.ok(!allLogs.includes('sk-secret-key-12345'));
});
```

**🟢 GREEN**

File: `src/api/beam-search-worker.js`
- Audit all `console.log` calls
- Remove any that might include API key
- Use generic messages like "user-provided API key"

---

### Issue 5.2: API key is never included in WebSocket messages

**🔴 RED**

```javascript
it('should not include API key in emitted progress messages', async () => {
  const emittedMessages = [];
  // Mock emitProgress

  await startBeamSearchJob('job-123', { prompt: 'test' }, 'sk-secret-key-12345');

  const allEmissions = JSON.stringify(emittedMessages);
  assert.ok(!allEmissions.includes('sk-secret-key-12345'));
});
```

**🟢 GREEN**

File: `src/api/beam-search-worker.js`
- Audit all `emitProgress` calls
- Ensure API key is never included in payload

---

## Phase 6: Integration Testing

### Issue 6.1: End-to-end test with user API key

**🔴 RED**

```javascript
// test/e2e-apikey.test.js
describe('E2E: User-provided API Key', () => {
  it('should complete beam search with user-provided API key', async () => {
    // Start server
    // POST to /api/beam-search/start with X-OpenAI-API-Key header
    // Connect to WebSocket
    // Wait for 'complete' message
    // Verify job completed successfully
  });
});
```

**🟢 GREEN**

- Ensure all phases work together
- Use test API key or mock

---

### Issue 6.2: Verify server has no OPENAI_API_KEY in .env

**🔴 RED**

```javascript
it('should not have OPENAI_API_KEY set in production .env', () => {
  const envContent = fs.readFileSync('.env', 'utf8');
  // Should be commented out or not present
  assert.ok(!envContent.match(/^OPENAI_API_KEY=sk-/m));
});
```

**🟢 GREEN**

- Ensure .env template has key commented out
- Add check to deployment script

---

## Implementation Order

Execute in this order for minimal merge conflicts:

1. **Phase 3** - Provider Factory (3.1-3.5) - Foundation
2. **Phase 2** - Worker (2.1-2.3) - Uses providers
3. **Phase 1** - Server Route (1.1-1.3) - Uses worker
4. **Phase 4** - Frontend (4.1-4.5) - Uses API
5. **Phase 5** - Security Audit (5.1-5.2)
6. **Phase 6** - Integration Tests (6.1-6.2)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/factory/provider-factory.js` | Accept `apiKey` option in all factory functions |
| `src/api/beam-search-worker.js` | Accept `userApiKey` param, pass to providers |
| `src/api/server.js` | Add API key validation middleware |
| `public/demo.html` | Add API key input field |
| `public/demo.js` | Validate and send API key header |
| `test/api-key-validation.test.js` | New test file |
| `test/beam-search-worker-apikey.test.js` | New test file |
| `test/provider-apikey.test.js` | New test file |

---

## Estimated Effort

| Phase | Tests | Implementation | Total |
|-------|-------|----------------|-------|
| Phase 1 (Server) | 15 min | 20 min | 35 min |
| Phase 2 (Worker) | 15 min | 15 min | 30 min |
| Phase 3 (Providers) | 20 min | 25 min | 45 min |
| Phase 4 (Frontend) | 15 min | 30 min | 45 min |
| Phase 5 (Security) | 10 min | 10 min | 20 min |
| Phase 6 (Integration) | 20 min | 15 min | 35 min |
| **Total** | **~95 min** | **~115 min** | **~3.5 hours** |

---

## Success Criteria

- [ ] All new tests pass
- [ ] Existing tests still pass
- [ ] No API key in server logs
- [ ] No API key in WebSocket messages
- [ ] Frontend validates before sending
- [ ] Server rejects missing/invalid keys
- [ ] Beam search works with user-provided key
- [ ] `.env` has no `OPENAI_API_KEY` set
