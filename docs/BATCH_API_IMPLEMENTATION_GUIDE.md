# Batch API Implementation Guide

## Overview

This guide covers the implementation of OpenAI Batch API support to reduce costs by 50% on non-time-sensitive operations in the image generation pipeline.

**Key Context:**
- Flex pricing (50% savings) NOT available for gpt-4o-mini (current vision model)
- Batch API available at 50% cost reduction for all models
- Pipeline already async - can support batching architecture
- Operations are non-time-sensitive (acceptable to wait 24 hours)

---

## Cost Opportunity

### Current Costs (Per Typical Session)
- **N=9, M=3, 3 iterations**
- 18 LLM calls + 27 vision calls = 45 API calls
- Cost: ~$6.75 per session
- With ensemble voting (3x): ~$20.25

### With Batch API (50% reduction)
- Same operations, half the cost
- Cost: ~$3.38 per session
- With ensemble: ~$10.13

### Annual Projections (1,000 sessions/year)
- **Without batch: $20,250**
- **With batch: $10,125**
- **Annual savings: $10,125**

---

## Architecture Overview

### Components

#### 1. Batch Request Builder
**Purpose:** Convert API requests to OpenAI Batch format

**Responsibility:**
- Format individual chat completions as JSONL
- Assign unique custom IDs for tracking
- Handle model-specific normalization (gpt-5 vs others)
- Validate request format

**Files:**
- `src/batch/batch-request-builder.js`
- `test/batch/batch-request-builder.test.js`

**Example Usage:**
```javascript
const builder = new BatchRequestBuilder();
builder.addChatCompletionRequest(
  'critique-001',
  [{ role: 'system', content: '...' }],
  { model: 'gpt-5-mini', temperature: 0.3 }
);
const batch = builder.buildBatch('batch-2025-12-08');
```

#### 2. Batch Job Manager
**Purpose:** Manage batch lifecycle and OpenAI API integration

**Responsibility:**
- Submit batches to OpenAI Batch API
- Poll for completion (exponential backoff)
- Persist batch state to disk
- Retrieve completed results
- Map results back to original requests

**Files:**
- `src/batch/batch-job-manager.js`
- `test/batch/batch-job-manager.test.js`

**Example Usage:**
```javascript
const manager = new BatchJobManager({ outputDir: 'output/' });
const batchId = await manager.submitBatch(batchData);
// Later: retrieve results
const results = await manager.retrieveResults(batchId);
```

#### 3. Batch Request Queue
**Purpose:** Accumulate requests during session, assemble into batches

**Responsibility:**
- Queue incoming requests
- Track request metadata for result mapping
- Assemble into valid batches
- Split if exceeds OpenAI limits (10K requests)
- Manage result retrieval

**Files:**
- `src/batch/batch-request-queue.js`
- `test/batch/batch-request-queue.js`

**Example Usage:**
```javascript
const queue = new BatchRequestQueue(jobManager);
queue.enqueue('vision-compare', { imageA, imageB, prompt, options });
queue.enqueue('critique', { feedback, prompts });
// Submit when ready
await queue.submit();
// Wait for results
const result = await queue.getResultForRequest(requestId);
```

#### 4. Batch Providers (Adapters)
**Purpose:** Transparent batch wrappers for existing providers

**Responsibility:**
- Implement same interface as real providers
- Queue requests instead of executing
- Return request IDs immediately
- Support result retrieval when complete

**Files:**
- `src/providers/openai-llm-provider-batch.js`
- `src/providers/openai-vision-provider-batch.js`
- Tests for each

**Key Design:**
- No changes to orchestrator code needed
- Swappable via provider factory
- Fallback to real providers if batch disabled

#### 5. Enhanced Job Infrastructure
**Purpose:** Integrate batch support into existing job system

**Modifications:**
- `src/api/beam-search-worker.js` - Add batch mode handling
- `src/api/server.js` - Add batch status endpoints
- `src/factory/provider-factory.js` - Add batch provider creation

---

## Implementation Phases

### Phase 1: Core Infrastructure (No Orchestrator Changes)

**Goal:** Foundation for batch support

**Tasks:**
1. `BatchRequestBuilder` - Request formatting
2. `BatchJobManager` - OpenAI integration & persistence
3. `server.js` updates - Batch status endpoints
4. `batch-config.js` - Configuration constants

**Deliverables:**
- Submit batches to OpenAI
- Poll for completion
- Persist state to disk
- Test: 50+ unit tests

**Effort:** 1-2 weeks

### Phase 2: Queue System (Deferred Batching)

**Goal:** Request accumulation & intelligent batching

**Tasks:**
1. `BatchRequestQueue` - Accumulation logic
2. Batch providers (LLM & Vision)
3. Provider factory updates
4. Configuration loading

**Deliverables:**
- Queue requests during session
- Auto-assemble into batches
- Map results back to requests
- Test: 60+ unit tests

**Effort:** 1-2 weeks

### Phase 3: Orchestrator Integration (Minimal Changes)

**Goal:** Use batch providers transparently

**Tasks:**
1. ImageRanker - Optional batch queue injection
2. CritiqueGenerator - Optional batch queue injection
3. BeamSearch orchestrator - Batch mode detection
4. BeamSearchWorker - Batch status reporting

**Deliverables:**
- Orchestrator works with batch or real providers
- Automatic result retrieval
- Batch status in job callbacks
- Test: 30+ integration tests

**Effort:** 1 week

### Phase 4: Advanced Features (Optional)

**Goal:** Optimization & reliability

**Tasks:**
1. Batch resumption - Resume incomplete batches
2. Cost tracking - Report savings
3. Hybrid mode - Smart mode selection
4. Observability - Progress tracking

**Deliverables:**
- Resume from checkpoints
- Cost analysis reports
- Automatic mode selection
- WebSocket progress updates

**Effort:** 1-2 weeks (optional)

---

## Configuration

### Environment Variables

```bash
# Enable/disable batch mode
BATCH_API_ENABLED=false          # Default: disabled for safety
BATCH_API_MODE=deferred          # "deferred" (default) or "immediate"
BATCH_MAX_WAIT_HOURS=24          # Max hours to wait
BATCH_POLL_INTERVAL_MS=30000     # How often to poll OpenAI

# Operation-specific toggles
BATCH_VISION_ENABLED=true        # Batch vision comparisons
BATCH_LLM_ENABLED=true           # Batch LLM calls
BATCH_FALLBACK_TO_STANDARD=true  # Fallback if batch fails

# Feature flags
BATCH_COST_TRACKING=true         # Track cost savings
BATCH_HYBRID_MODE=false          # Smart provider selection
```

### Code Configuration

```javascript
// In provider-config.js
batch: {
  enabled: process.env.BATCH_API_ENABLED === 'true',
  mode: process.env.BATCH_API_MODE || 'deferred',
  maxBatchSize: 10000,
  pollIntervalMs: 30000,
  maxWaitHours: 24,
  fallbackToStandard: true,
  enableForOperations: {
    visionRanking: true,
    critique: true,
    refinement: false
  }
}
```

---

## API Changes

### New Endpoints

```bash
# Start batch mode session
POST /api/beam-search
{
  prompt: "...",
  useBatch: true,
  batchWaitMode: "deferred"  # or "poll"
}
Response: { jobId, batchId, estimatedWaitHours: 24 }

# Check batch status
GET /api/job/:jobId
Response: { status, batchId, progress, estimatedCompletionTime }

# Retrieve batch results
GET /api/batch/:batchId/results
Response: { status, results: [...] }
```

---

## Testing Strategy

### Unit Tests (TDD)
- **BatchRequestBuilder:** 20 tests (formatting, validation)
- **BatchJobManager:** 15 tests (API integration, polling)
- **BatchRequestQueue:** 25 tests (accumulation, splitting)
- **Batch Providers:** 20 tests each (interface compliance)
- **Configuration:** 10 tests

**Total:** 90+ unit tests

### Integration Tests
- Full session with batch mode
- Result retrieval and mapping
- Hybrid mode (batch + standard)
- Error handling and fallback
- Cost tracking validation

### Mock Strategy
- Mock OpenAI API responses
- Mock file system
- Test incomplete batches
- Test network failures

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Batch API latency (24h wait) | High | Opt-in via config, document trade-offs |
| Invalid batch format | High | Comprehensive validation, unit tests |
| Result retrieval fails | Medium | Persist state, retry logic, resume capability |
| Rate limiting | Low | Validate batch size, auto-split if needed |
| Provider interface mismatch | Medium | Identical interfaces, comprehensive tests |

---

## Success Criteria

✅ All phases complete
✅ Batch cost reduction: 50% savings achieved
✅ Zero regressions: Existing tests pass
✅ Integration proven: Full session with batch mode
✅ Documentation: Clear user guidance on trade-offs
✅ Monitoring: Cost savings tracked and reported

---

## Future Enhancements

1. **Flex Tier Support** - When models gain Flex support
2. **Advanced Batching** - Group related operations
3. **Cost Optimization** - Intelligent tier selection per operation
4. **Job Queue Persistence** - Resume across server restarts
5. **Real-time Monitoring** - Dashboard for batch status

---

## References

- [OpenAI Batch API Documentation](https://platform.openai.com/docs/api-reference/batch)
- [Streaming Parallel Architecture](./streaming-parallel-architecture.md)
- [Provider Configuration](../src/config/provider-config.js)
- GitHub Issues: #17, #18, #19, #20

