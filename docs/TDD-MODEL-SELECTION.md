# TDD: Front-End Model Selection

## Feature Overview

Allow users to override default models (from `.env`) via the frontend UI before starting a beam search job.

**Why?** Different use cases need different models:
- Want faster results? Use cheaper models (gpt-5-nano)
- Need better quality? Use gpt-5-mini or gpt-4
- Testing? Use cheap models
- Production? Use best models

## Current State (RED)

Models currently hardcoded from `.env`:
- `OPENAI_LLM_MODEL` - General LLM operations
- `OPENAI_LLM_MODEL_EXPAND` - Expansion phase
- `OPENAI_LLM_MODEL_REFINE` - Refinement phase
- `OPENAI_LLM_MODEL_COMBINE` - Combining candidates
- `OPENAI_IMAGE_MODEL` - Image generation
- `OPENAI_VISION_MODEL` - Vision/evaluation

## Implementation Plan

### Phase 1: Backend - Expose Available Models Endpoint

**Issue 1.1**: Create `/api/available-models` endpoint

**🔴 RED Test**:
```javascript
test('GET /api/available-models should return available models', async () => {
  const res = await fetch('/api/available-models');
  const data = await res.json();

  assert.deepStrictEqual(Object.keys(data), ['llm', 'imageGen', 'vision']);
  assert.ok(Array.isArray(data.llm.options), 'Should have llm options');
  assert.ok(data.llm.default, 'Should have llm default');
});
```

Expected Response:
```json
{
  "llm": {
    "default": "gpt-5-mini",
    "options": ["gpt-5-nano", "gpt-5-mini", "gpt-4-turbo"],
    "operations": {
      "expand": "gpt-5-nano",
      "refine": "gpt-5-mini",
      "combine": "gpt-5-nano"
    }
  },
  "imageGen": {
    "default": "gpt-image-1-mini",
    "options": ["gpt-image-1-mini", "gpt-image-1"]
  },
  "vision": {
    "default": "gpt-5-nano",
    "options": ["gpt-5-nano", "gpt-5-mini"]
  }
}
```

**🟢 GREEN Implementation**:
- Create `src/api/routes/models.js` with endpoint
- Read from config and serve as JSON

---

### Phase 2: Frontend - Add Model Selection UI

**Issue 2.1**: Add model selector dropdowns to form

**🔴 RED Test**:
```javascript
test('demo.html should have model selection controls', async () => {
  const res = await fetch('http://localhost:3000');
  const html = await res.text();

  assert.ok(html.includes('id="llmModel"'), 'Should have LLM model selector');
  assert.ok(html.includes('id="imageModel"'), 'Should have image model selector');
  assert.ok(html.includes('id="visionModel"'), 'Should have vision model selector');
});
```

**🟢 GREEN Implementation**:
- Add to `public/demo.html`:
  ```html
  <div class="form-group">
    <label for="llmModel">LLM Model:</label>
    <select id="llmModel">
      <option value="">Default (from server)</option>
      <!-- populated by JS -->
    </select>
  </div>
  ```

---

### Phase 3: Frontend - Load and Display Available Models

**Issue 3.1**: Fetch available models on page load

**🔴 RED Test**:
```javascript
test('demo.js should fetch available models on DOMContentLoaded', async () => {
  // Mock fetch
  let fetchCalled = false;
  window.fetch = () => {
    fetchCalled = true;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        llm: { options: ['gpt-5-nano', 'gpt-5-mini'] },
        imageGen: { options: ['gpt-image-1-mini'] },
        vision: { options: ['gpt-5-nano'] }
      })
    });
  };

  // Trigger DOMContentLoaded
  // Assert that select dropdowns are populated
  await sleep(100);
  assert.ok(fetchCalled, 'Should fetch models');
});
```

**🟢 GREEN Implementation**:
- In `public/demo.js` DOMContentLoaded:
  ```javascript
  async function loadAvailableModels() {
    const res = await fetch('/api/available-models');
    const models = await res.json();

    populateSelect('llmModel', models.llm.options, models.llm.default);
    populateSelect('imageModel', models.imageGen.options, models.imageGen.default);
    populateSelect('visionModel', models.vision.options, models.vision.default);
  }
  ```

---

### Phase 4: Frontend - Send Selected Models in Request

**Issue 4.1**: Include selected models in beam search request

**🔴 RED Test**:
```javascript
test('startBeamSearch should send selected models', async () => {
  let capturedRequest;
  window.fetch = (url, opts) => {
    capturedRequest = opts;
    return Promise.resolve({ ok: true, json: () => ({jobId: 'test'}) });
  };

  // Set model selections
  document.getElementById('llmModel').value = 'gpt-4-turbo';
  document.getElementById('imageModel').value = 'gpt-image-1';
  document.getElementById('visionModel').value = 'gpt-5-mini';

  await startBeamSearch();

  const body = JSON.parse(capturedRequest.body);
  assert.deepStrictEqual(body.models, {
    llm: 'gpt-4-turbo',
    imageGen: 'gpt-image-1',
    vision: 'gpt-5-mini'
  });
});
```

**🟢 GREEN Implementation**:
- In `startBeamSearch()`:
  ```javascript
  const models = {
    llm: document.getElementById('llmModel').value || undefined,
    imageGen: document.getElementById('imageModel').value || undefined,
    vision: document.getElementById('visionModel').value || undefined
  };

  const body = JSON.stringify({
    ...params,
    models
  });
  ```

---

### Phase 5: Backend - Accept and Validate Models

**Issue 5.1**: Accept models in `/api/beam-search` request

**🔴 RED Test**:
```javascript
test('POST /api/beam-search should accept models parameter', async () => {
  const res = await fetch('/api/beam-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenAI-API-Key': 'sk-test'
    },
    body: JSON.stringify({
      prompt: 'test',
      models: {
        llm: 'gpt-4-turbo',
        imageGen: 'gpt-image-1'
      }
    })
  });

  assert.ok(res.ok, 'Should accept request with models');
});
```

**🟢 GREEN Implementation**:
- In `src/api/server.js` `/api/beam-search`:
  ```javascript
  const { models } = req.body;

  startBeamSearchJob(jobId, {
    ...req.body,
    models  // Pass models to worker
  }, userApiKey);
  ```

---

### Phase 6: Worker - Use User-Selected Models

**Issue 6.1**: Use models from params when creating providers

**🔴 RED Test**:
```javascript
test('startBeamSearchJob should use provided models', async () => {
  let capturedModel;
  const mockCreateLLM = (opts) => {
    capturedModel = opts.model;
    return mockProvider;
  };

  // Mock the provider factory
  await startBeamSearchJob('job-123', {
    prompt: 'test',
    models: { llm: 'gpt-4-turbo' }
  }, 'sk-key');

  assert.equal(capturedModel, 'gpt-4-turbo');
});
```

**🟢 GREEN Implementation**:
- In `src/api/beam-search-worker.js`:
  ```javascript
  const { models } = params;

  const providers = {
    llm: createLLMProvider({
      apiKey: userApiKey,
      model: models?.llm  // Use user-selected or undefined for default
    }),
    imageGen: createImageProvider({
      apiKey: userApiKey,
      model: models?.imageGen
    }),
    vision: createVisionProvider({
      apiKey: userApiKey,
      model: models?.vision
    })
    // ...
  };
  ```

---

### Phase 7: Provider Factories - Accept Model Option

**Issue 7.1**: Ensure all factories accept and use model option

**Test**: (already exists in Phase 3)

**🟢 GREEN Implementation**:
- Verify each factory respects `options.model`
- Update if needed (likely minimal changes needed since Phase 3 already tested apiKey option)

---

## Success Criteria

- [ ] `/api/available-models` endpoint works
- [ ] Frontend dropdown populated with available models
- [ ] Frontend validates model selections
- [ ] Models sent in beam search request
- [ ] Backend accepts models parameter
- [ ] Worker uses user-selected models
- [ ] Providers created with correct models
- [ ] If user doesn't select, uses env defaults
- [ ] UI shows current default for each model

## Testing Strategy

1. **Unit Tests**: Each phase has unit tests (test files)
2. **Integration Tests**: End-to-end test with model selection
3. **Manual Testing**: Try changing models and verify in logs

## Deployment Notes

- No breaking changes to existing API
- Backward compatible (models optional)
- Env vars still used as defaults
- Can be enabled/disabled via feature flag if needed

## Next Steps

1. Commit this document
2. Start Phase 1 implementation
3. Use TDD workflow: RED → GREEN → REFACTOR → COMMIT
