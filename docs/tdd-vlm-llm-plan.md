# TDD Refactoring Plan: VLM/LLM Pipeline Verification

**Goal**: Ensure VLM and LLM services work correctly for generation, ranking, and refining steps with proper GPU utilization.

---

## Architecture Overview

| Service | Port | GPU Usage | Purpose |
|---------|------|-----------|---------|
| LLM | 8003 | ~2-3GB (32 layers) | Prompt expansion, combination, critique-based refinement |
| VLM | 8004 | ~5-7GB (all layers) | Pairwise image comparison for ranking |
| Flux | 8001 | ~10GB | Image generation |

**Constraint**: 12GB GPU - VLM and Flux cannot run simultaneously. Model coordinator manages switching.

---

## Pipeline Steps to Test

1. **Generation (LLM)**: `refinePrompt(dimension='what'/'how')` → `combinePrompts()`
2. **Ranking (VLM)**: `compareImages()` → `rankImages()` with tournament/transitive inference
3. **Refining (LLM)**: `generateCritique()` → `refinePrompt(critique)`

---

## Implementation Sprints

### Sprint 1: Model Coordinator Tests (NEW FILE)
**File**: `test/utils/model-coordinator.test.js`

| Test | Description |
|------|-------------|
| 🔴 `prepareForLLM unloads flux` | Verify POST to flux `/unload` |
| 🔴 `prepareForVLM unloads flux` | Verify POST to flux `/unload` |
| 🔴 `prepareForImageGen unloads llm` | Verify POST to llm `/unload` |
| 🔴 `handles service unavailable` | Graceful degradation, no throw |
| 🔴 `getModelStates returns accurate state` | Track loaded models |

**Mock Strategy**: nock for HTTP mocking

### Sprint 2: LLM Provider Tests (EXTEND)
**File**: `test/providers/local-llm-provider.test.js`

| Test | Description |
|------|-------------|
| 🔴 `refinePrompt dimension=what sends CONTENT guidance` | Verify system prompt |
| 🔴 `refinePrompt dimension=how sends STYLE guidance` | Verify system prompt |
| 🔴 `combinePrompts merges WHAT+HOW` | Verify combined output |
| 🔴 `refinePrompt with critique includes feedback` | clipScore, aestheticScore in prompt |
| 🔴 `healthCheck returns GPU info` | device, gpu_layers, model_loaded |

### Sprint 3: VLM Provider Tests (COMPLETE GREEN)
**File**: `test/providers/local-vlm-provider.test.js`

Existing RED tests to complete:

| Test | Description |
|------|-------------|
| 🟢 `compareImages returns choice/explanation/confidence` | Basic pairwise comparison |
| 🟢 `compareImages calls /compare endpoint correctly` | Request body structure |
| 🟢 `rankImages implements ImageRanker interface` | Returns `{candidateId, rank, reason}[]` |
| 🟢 `transitive inference reduces API calls` | A>B, B>C → infer A>C |
| 🟢 `tournament strategy for N>8` | Efficient large set ranking |
| 🔴 `healthCheck returns GPU info` | gpu_layers, model_loaded (NEW) |

### Sprint 4: GPU Coordination Integration (NEW FILE)
**File**: `test/integration/gpu-coordination.test.js`

Gate: `ENABLE_GPU_TESTS=1`

| Test | Description |
|------|-------------|
| 🔴 `LLM→VLM switching works` | VLM loads after LLM used GPU |
| 🔴 `VLM→LLM switching works` | LLM responds after VLM unloaded |
| 🔴 `Flux→VLM switching works` | Critical: 10GB→5GB transition |
| 🔴 `health check confirms GPU usage` | model_loaded=true, gpu_layers>0 |

### Sprint 5: End-to-End Pipeline (NEW FILE)
**File**: `test/integration/pipeline-vlm-llm.test.js`

| Test | Description |
|------|-------------|
| 🔴 `generation phase: what→how→combine` | LLM produces valid prompt |
| 🔴 `ranking phase: compareImages × N` | VLM ranks 4 candidates |
| 🔴 `refining phase: critique→refine` | LLM improves prompt |
| 🔴 `full pipeline: gen→rank→refine` | Complete iteration |

---

## Critical Files

### Source Files
- `src/utils/model-coordinator.js` - GPU memory coordination
- `src/providers/local-llm-provider.js` - LLM provider
- `src/providers/local-vlm-provider.js` - VLM provider
- `src/orchestrator/beam-search.js` - Pipeline orchestrator
- `src/services/critique-generator.js` - Critique generation

### Test Files to Modify/Create
- `test/utils/model-coordinator.test.js` (NEW)
- `test/providers/local-llm-provider.test.js` (EXTEND)
- `test/providers/local-vlm-provider.test.js` (COMPLETE GREEN)
- `test/integration/gpu-coordination.test.js` (NEW)
- `test/integration/pipeline-vlm-llm.test.js` (NEW)

### Python Services
- `services/llm_service.py` - Endpoints: `/health`, `/load`, `/unload`, `/v1/completions`
- `services/vlm_service.py` - Endpoints: `/health`, `/load`, `/unload`, `/compare`

---

## Mocking Patterns

### Unit Tests (nock)
```javascript
const nock = require('nock');

nock('http://localhost:8004')
  .post('/compare')
  .reply(200, { choice: 'A', explanation: '...', confidence: 0.85 });
```

### Integration Tests (gated)
```javascript
test('GPU integration', { skip: !process.env.ENABLE_GPU_TESTS }, async () => {
  const health = await provider.healthCheck();
  assert.strictEqual(health.model_loaded, true);
  assert.ok(health.gpu_layers !== 0, 'Should use GPU');
});
```

---

## GPU Verification Approach

Health check responses contain GPU info:

```json
// LLM /health
{ "gpu_layers": 32, "model_loaded": true, "device": "cuda" }

// VLM /health
{ "gpu_layers": -1, "model_loaded": true }  // -1 = all layers on GPU
```

**Assertions**:
- `model_loaded === true` → model ready
- `gpu_layers !== 0` → using GPU (0 = CPU only)
- `-1` for VLM means all layers offloaded to GPU

---

## Error Scenarios to Cover

| Scenario | Expected Behavior |
|----------|-------------------|
| Service unavailable (ECONNREFUSED) | Throw with clear message |
| Model not loaded (503) | Throw or trigger load |
| Comparison timeout (>60s) | Throw timeout error |
| GPU OOM during load | Throw memory error |

---

## Verification Commands

```bash
# Run unit tests (mocked, fast)
npm test -- test/utils/model-coordinator.test.js
npm test -- test/providers/local-llm-provider.test.js
npm test -- test/providers/local-vlm-provider.test.js

# Run integration tests (requires GPU + services)
ENABLE_GPU_TESTS=1 npm test -- test/integration/gpu-coordination.test.js
ENABLE_GPU_TESTS=1 npm test -- test/integration/pipeline-vlm-llm.test.js

# Start services for integration tests
npm run service:start llm
npm run service:start vlm
```

---

## TDD Cycle Order

1. **Sprint 1**: Model coordinator (foundation for GPU switching)
2. **Sprint 2**: LLM provider (generation + refining)
3. **Sprint 3**: VLM provider (ranking - complete existing RED tests)
4. **Sprint 4**: GPU coordination integration
5. **Sprint 5**: End-to-end pipeline

Each sprint follows: 🔴 RED → 🟢 GREEN → 🔄 REFACTOR → ✓ COMMIT
