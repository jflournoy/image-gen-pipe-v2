# Image Generation Pipeline - Architecture

## System Overview

```mermaid
flowchart TB
    subgraph Frontend["Frontend (Browser)"]
        demo["demo.html/demo.js"]
        eval["evaluation.html"]
        ls["localStorage<br/>(job history)"]
    end

    subgraph Server["Node.js Server (port 3000)"]
        express["server.js<br/>Express App"]
        ws["WebSocket Server"]

        subgraph Routes["API Routes"]
            beam["/api/beam-search"]
            jobs["/api/jobs"]
            providers["/api/providers"]
            images["/api/images"]
        end
    end

    subgraph Worker["Beam Search Worker"]
        bsw["beam-search-worker.js"]
        abort["AbortController"]
    end

    subgraph Orchestrator["Orchestrator"]
        bs["beam-search.js"]
        meta["MetadataTracker"]
        token["TokenTracker"]
    end

    subgraph Factory["Provider Factory"]
        pf["provider-factory.js"]
        config["provider-config.js"]
        runtime["provider-routes.js<br/>(runtime switching)"]
    end

    subgraph Providers["Providers"]
        subgraph OpenAI["OpenAI Providers"]
            ollm["OpenAI LLM<br/>(gpt-5-mini)"]
            oimg["OpenAI Image<br/>(gpt-image-1)"]
            ovis["OpenAI Vision<br/>(gpt-5-nano)"]
        end

        subgraph Local["Local Providers"]
            lllm["Local LLM Provider"]
            limg["Flux Image Provider"]
            lvis["Local Vision Provider"]
        end

        subgraph Mock["Mock Providers"]
            mllm["Mock LLM"]
            mimg["Mock Image"]
            mvis["Mock Vision"]
        end
    end

    subgraph Services["Core Services"]
        critique["CritiqueGenerator"]
        ranker["ImageRanker"]
        bundler["PromptBundler"]
        refiner["PromptRefiner"]
    end

    subgraph Python["Python Services"]
        llmsvc["llm_service.py<br/>(port 8003)<br/>Mistral 7B"]
        fluxsvc["flux_service.py<br/>(port 8001)<br/>Flux/SDXL"]
        vissvc["vision_service.py<br/>(port 8002)<br/>CLIP + Aesthetic"]
    end

    subgraph Storage["Storage"]
        output["output/<br/>YYYY-MM-DD/<br/>ses-HHMMSS/"]
    end

    %% Frontend connections
    demo -->|"POST /api/beam-search"| beam
    demo <-->|"WebSocket"| ws
    demo --> ls
    eval --> ls

    %% Server connections
    express --> Routes
    beam --> bsw
    providers --> runtime

    %% Worker connections
    bsw --> bs
    bsw --> abort
    bsw -->|"emitProgress()"| ws

    %% Orchestrator connections
    bs --> meta
    bs --> token
    bs --> pf

    %% Factory connections
    pf --> config
    runtime --> pf
    pf --> OpenAI
    pf --> Local
    pf --> Mock

    %% Local provider to Python service
    lllm -->|"HTTP :8003"| llmsvc
    limg -->|"HTTP :8001"| fluxsvc
    lvis -->|"HTTP :8002"| vissvc

    %% Orchestrator to services
    bs --> critique
    bs --> ranker
    bs --> bundler
    bs --> refiner

    %% Storage
    meta --> output
    images --> output

    classDef frontend fill:#e1f5fe,stroke:#01579b
    classDef server fill:#fff3e0,stroke:#e65100
    classDef worker fill:#fce4ec,stroke:#880e4f
    classDef provider fill:#e8f5e9,stroke:#1b5e20
    classDef python fill:#f3e5f5,stroke:#4a148c
    classDef storage fill:#efebe9,stroke:#3e2723

    class demo,eval,ls frontend
    class express,ws,beam,jobs,providers,images server
    class bsw,abort,bs,meta,token worker
    class ollm,oimg,ovis,lllm,limg,lvis,mllm,mimg,mvis provider
    class llmsvc,fluxsvc,vissvc python
    class output storage
```

## Beam Search Algorithm Flow

```mermaid
flowchart TD
    start([User Prompt]) --> expand

    subgraph iter0["Iteration 0: Expansion"]
        expand["Generate N candidates<br/>from user prompt"]
        expand --> eval0["Evaluate each:<br/>CLIP + Aesthetic"]
        eval0 --> rank0["Rank & keep top M"]
    end

    rank0 --> refine

    subgraph iterN["Iteration 1+: Refinement"]
        refine["For each top M parent"]
        refine --> what["Refine WHAT<br/>(content)"]
        refine --> how["Refine HOW<br/>(style)"]
        what --> combine["Combine prompts"]
        how --> combine
        combine --> gen["Generate image"]
        gen --> evalN["Evaluate image"]
        evalN --> lineage["Track lineage<br/>(parent → child)"]
        lineage --> rankN["Comparative ranking<br/>(ImageRanker)"]
    end

    rankN --> check{More iterations?}
    check -->|Yes| refine
    check -->|No| final

    subgraph complete["Completion"]
        final["Global ranking"]
        final --> winner["Select winner"]
        winner --> save["Save metadata<br/>& images"]
    end

    save --> done([Return Results])

    classDef expansion fill:#e3f2fd,stroke:#1565c0
    classDef refinement fill:#fff8e1,stroke:#f9a825
    classDef completion fill:#e8f5e9,stroke:#2e7d32

    class expand,eval0,rank0 expansion
    class refine,what,how,combine,gen,evalN,lineage,rankN refinement
    class final,winner,save completion
```

## Provider Selection Flow

```mermaid
flowchart LR
    subgraph Config["Configuration"]
        env["Environment Variables"]
        file["provider-config.js"]
        ui["UI Provider Settings"]
    end

    subgraph Runtime["Runtime State"]
        rp["runtimeProviders<br/>(in-memory)"]
    end

    subgraph Factory["Provider Factory"]
        create["createLLMProvider()<br/>createImageProvider()<br/>createVisionProvider()"]
    end

    subgraph Decision{"Provider Type?"}
        mode{mode?}
    end

    subgraph Providers["Provider Instances"]
        openai["OpenAI Provider"]
        local["Local Provider"]
        mock["Mock Provider"]
    end

    env --> file
    file --> rp
    ui -->|"POST /api/providers/switch"| rp

    rp --> create
    create --> mode

    mode -->|"mock"| mock
    mode -->|"real + openai"| openai
    mode -->|"real + local"| local

    local -->|"HTTP"| python["Python Service"]

    classDef config fill:#fff3e0,stroke:#e65100
    classDef runtime fill:#e8eaf6,stroke:#3f51b5
    classDef provider fill:#e8f5e9,stroke:#2e7d32

    class env,file,ui config
    class rp,create runtime
    class openai,local,mock,python provider
```

## Data Flow: Job Lifecycle

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant S as Server
    participant WS as WebSocket
    participant W as Worker
    participant O as Orchestrator
    participant P as Providers
    participant D as Disk

    U->>S: POST /api/beam-search
    S->>S: Validate (API key if OpenAI)
    S->>S: Generate jobId
    S-->>U: {jobId, status: 'started'}

    S->>W: startBeamSearchJob(jobId, params)
    activate W

    U->>WS: Subscribe(jobId)
    WS-->>U: {type: 'subscribed'}

    W->>O: beamSearch(params, callbacks)
    activate O

    loop Each Iteration
        O->>P: Generate candidates
        P-->>O: Images
        O->>P: Evaluate (vision)
        P-->>O: Scores
        O->>W: onProgress(candidate)
        W->>WS: emitProgress()
        WS-->>U: Progress update
        O->>O: Rank & select top M
    end

    O->>D: Save metadata.json
    O->>D: Save images/*.png
    O-->>W: Results
    deactivate O

    W->>WS: emitProgress({type: 'complete'})
    WS-->>U: Final results
    deactivate W

    U->>S: GET /api/images/:sessionId/:file
    S->>D: Read image
    D-->>S: Image data
    S-->>U: image/png
```

## API Key Validation Flow

This diagram shows how **both frontend and backend** conditionally require an API key based on active providers.

### Frontend Validation (demo.js)

```mermaid
flowchart TD
    load([Page Load]) --> fetch["fetch('/api/providers/status')"]
    fetch --> update["updateMainFormForProviders(active)"]
    update --> calc["Calculate needsOpenAI:<br/>llm=openai OR image=dalle OR vision=openai"]
    calc --> setGlobal["needsOpenAIKey = needsOpenAI"]

    click([Click 'Start']) --> startFn["startBeamSearch()"]
    startFn --> checkGlobal{"needsOpenAIKey?"}
    checkGlobal -->|true| validateKey{"API key<br/>provided?"}
    validateKey -->|No| error["Error: API key required"]
    validateKey -->|Yes| checkFormat{"Starts with 'sk-'?"}
    checkFormat -->|No| errorFormat["Error: Invalid format"]
    checkFormat -->|Yes| proceed
    checkGlobal -->|false| proceed[Continue to POST]

    proceed --> post["POST /api/beam-search"]

    classDef init fill:#e3f2fd,stroke:#1565c0
    classDef check fill:#fff3e0,stroke:#e65100
    classDef error fill:#ffebee,stroke:#c62828
    classDef success fill:#e8f5e9,stroke:#2e7d32

    class load,fetch,update,calc,setGlobal init
    class checkGlobal,validateKey,checkFormat check
    class error,errorFormat error
    class proceed,post success
```

### Backend Validation (server.js)

```mermaid
flowchart TD
    req([POST /api/beam-search]) --> getProviders

    subgraph Validation["API Key Validation (server.js + beam-search-worker.js)"]
        getProviders["getRuntimeProviders()<br/>(from provider-routes.js)"]
        getProviders --> checkLLM{"llm === 'openai'?"}
        checkLLM -->|Yes| needsKey[needsOpenAI = true]
        checkLLM -->|No| checkImage{"image === 'openai'<br/>or 'dalle'?"}
        checkImage -->|Yes| needsKey
        checkImage -->|No| checkVision{"vision === 'openai'<br/>or 'gpt-vision'?"}
        checkVision -->|Yes| needsKey
        checkVision -->|No| noKey[needsOpenAI = false]
    end

    needsKey --> validateKey{"API key<br/>provided?"}
    validateKey -->|No| error401["401: Missing API key"]
    validateKey -->|Yes| validateFormat{"Starts with<br/>'sk-'?"}
    validateFormat -->|No| error400["400: Invalid format"]
    validateFormat -->|Yes| proceed

    noKey --> proceed[Start Job]

    proceed --> createProviders["Create providers<br/>via factory"]

    subgraph ProviderCreation["Provider Factory"]
        createProviders --> llmProv["LLM: local-llm or openai"]
        createProviders --> imgProv["Image: flux or dalle"]
        createProviders --> visProv["Vision: local or openai"]
        createProviders --> optServices{"needsOpenAI?"}
        optServices -->|Yes| createOpt["Create CritiqueGenerator<br/>+ ImageRanker"]
        optServices -->|No| nullOpt["CritiqueGen = null<br/>ImageRanker = null"]
    end

    classDef validation fill:#fff3e0,stroke:#e65100
    classDef error fill:#ffebee,stroke:#c62828
    classDef success fill:#e8f5e9,stroke:#2e7d32

    class getProviders,checkLLM,checkImage,checkVision,needsKey,noKey,validateKey,validateFormat validation
    class error401,error400 error
    class proceed,createProviders,llmProv,imgProv,visProv,createOpt,nullOpt success
```

## Service Communication Flow

Shows how the Node.js orchestrator communicates with local Python services.

```mermaid
sequenceDiagram
    participant O as Orchestrator<br/>(beam-search.js)
    participant LLM as LLM Service<br/>(port 8003)
    participant Flux as Flux Service<br/>(port 8001)
    participant Vision as Vision Service<br/>(port 8002)

    Note over O: For each candidate...

    O->>LLM: POST /v1/completions<br/>{prompt: "expand WHAT..."}
    LLM-->>O: {text: "expanded what prompt"}

    O->>LLM: POST /v1/completions<br/>{prompt: "expand HOW..."}
    LLM-->>O: {text: "expanded style prompt"}

    O->>O: Combine what + how prompts

    O->>Flux: POST /generate<br/>{prompt, height, width, steps}
    Note over Flux: Generate image<br/>(30-60 seconds)
    Flux-->>O: {localPath: "/path/to/image.png"}

    O->>Vision: POST /evaluate<br/>{image_path, prompt}
    Vision-->>O: {clip_score, aesthetic_score}

    O->>O: Calculate totalScore<br/>= α×clip + (1-α)×aesthetic
```

**Timeouts:**
- LLM: 180 seconds per completion (3 min - accounts for queue wait)
- Flux: 120 seconds per image
- Vision: 30 seconds per evaluation

**⚠️ Sequential Processing:** Local Python services process requests sequentially on a single GPU. With 4 parallel beam search candidates, later requests wait in queue. Example timing:
- Request 1: ~30s (immediate processing)
- Request 2: ~50s (waited ~20s in queue)
- Request 3: ~70s (waited ~40s in queue)
- Request 4: ~90s (waited ~60s in queue)

## Debug: Service Health Checks

```mermaid
flowchart LR
    subgraph HealthEndpoints["Health Check Endpoints"]
        main["GET /api/providers/status"]
        llmH["GET :8003/health"]
        fluxH["GET :8001/health"]
        visH["GET :8002/health"]
    end

    subgraph PythonServices["Python Services"]
        llm["llm_service.py<br/>Mistral 7B"]
        flux["flux_service.py<br/>Flux/SDXL"]
        vis["vision_service.py<br/>CLIP + Aesthetic"]
    end

    subgraph States["Possible States"]
        healthy["✓ available: true<br/>status: healthy"]
        loading["⏳ Timeout<br/>(model loading)"]
        down["✗ available: false<br/>ECONNREFUSED"]
    end

    main --> llmH
    main --> fluxH
    main --> visH

    llmH --> llm
    fluxH --> flux
    visH --> vis

    llm --> healthy
    llm --> loading
    llm --> down

    classDef endpoint fill:#e3f2fd,stroke:#1565c0
    classDef service fill:#f3e5f5,stroke:#4a148c
    classDef state fill:#fff8e1,stroke:#f9a825

    class main,llmH,fluxH,visH endpoint
    class llm,flux,vis service
    class healthy,loading,down state
```

## Debugging Notes

### Issue: API Key Required When Using Local Providers (FIXED)

**Root Cause:** ES Module vs CommonJS import mismatch

```
# Before (broken):
server.js (ES module) → require('./provider-routes.js') → getRuntimeProviders undefined

# After (fixed):
server.js (ES module) → import { getRuntimeProviders } from './provider-routes.js' → works
```

**Files Fixed (Backend):**
- `src/api/server.js:15` - Changed to ES module import
- `src/api/demo-routes.js:9` - Changed to ES module import

**Files Fixed (Frontend):**
- `public/demo.js:28` - Added global `needsOpenAIKey` variable
- `public/demo.js:2117` - `updateMainFormForProviders()` sets `needsOpenAIKey` global
- `public/demo.js:1297` - `startBeamSearch()` conditionally validates API key based on `needsOpenAIKey`

### Issue: LLM Service "Broken pipe" / OOM (FIXED)

**Symptom:** Job fails with `HTTP 500: {"detail":"[Errno 32] Broken pipe"}`

**Root Cause:** Mistral 7B needs ~14GB in float16, but GPU only has 12GB total

**Fix:** Enabled 8-bit quantization (reduces ~14GB → ~7GB)
- `services/llm_service.py` - Added `USE_8BIT` config and `BitsAndBytesConfig`
- `services/requirements.txt` - Uncommented `bitsandbytes>=0.41.0`

**Environment Variables:**
- `LLM_USE_8BIT=true` (default) - Use 8-bit quantization
- `LLM_USE_8BIT=false` - Use full precision (requires 14GB+ VRAM)

### Issue: LLM Request Timeout with Parallel Beam Search (FIXED)

**Symptom:** Some LLM requests fail with "Cannot reach local LLM service" while others succeed. Failures occur at exactly 60 seconds.

**Root Cause:** Beam search sends 4 parallel LLM requests, but local LLM processes them sequentially on single GPU. Each request takes ~20-30s, so request 4 waits ~60-90s total, exceeding the 60s timeout.

**Fix:** Increased timeout in `src/providers/local-llm-provider.js` from 60s to 180s (3 minutes).

### Improvement: Serial Processing + llama.cpp (IMPLEMENTED)

**Problem:** Multiple parallel LLM requests overwhelm single-GPU services, and HuggingFace transformers uses excessive memory.

**Solution (3 parts):**

1. **Serial Rate Limiting** - Local providers use concurrency=1
   - `src/config/rate-limits.js` - Added `local` limits section
   - `src/orchestrator/beam-search.js` - Added `configureRateLimitsForProviders()`
   - `src/api/beam-search-worker.js` - Configures limits based on provider type

2. **llama.cpp instead of Transformers** - Much more memory efficient
   - `services/llm_service.py` - Rewrote to use `llama-cpp-python`
   - Uses GGUF quantized models (Q4_K_M: ~4GB vs float16: ~14GB)
   - Supports HuggingFace Hub download or local path

3. **Model Load/Unload Endpoints** - For GPU coordination
   - All services now have `/load` and `/unload` endpoints
   - `src/utils/model-coordinator.js` - Helper for orchestrating model swaps

**Environment Variables (LLM Service):**
```bash
LLM_MODEL_REPO="TheBloke/Mistral-7B-Instruct-v0.2-GGUF"  # HuggingFace repo
LLM_MODEL_FILE="*Q4_K_M.gguf"  # Glob pattern for model file
LLM_MODEL_PATH="/path/to/local.gguf"  # Override for local file
LLM_GPU_LAYERS=32  # Number of layers on GPU (-1 = all)
LLM_CONTEXT_SIZE=2048
```

### Issue: LLM Service Health Check Timeout

**Symptom:** Health check times out, job fails with "Cannot reach local LLM service"

**Possible Causes:**
1. Model still loading (Mistral 7B = ~7GB with 8-bit, can take 1-2 min)
2. Service crashed during model load (check memory)
3. GPU memory exhaustion

**Debug Commands:**
```bash
# Check service ports
lsof -i :8001 -i :8002 -i :8003 | grep LISTEN

# Check service health with timeout
timeout 3 curl http://localhost:8003/health

# Check provider status
curl http://localhost:3000/api/providers/status | jq .health
```

---

## File Structure

```
image-gen-pipe-v2/
├── public/                     # Frontend
│   ├── demo.html              # Main UI
│   ├── demo.js                # UI logic, WebSocket client
│   └── evaluation.html        # A/B comparison UI
│
├── src/
│   ├── api/                   # HTTP/WebSocket layer
│   │   ├── server.js          # Express + WebSocket server
│   │   ├── beam-search-worker.js  # Job execution
│   │   ├── demo-routes.js     # Demo endpoints
│   │   ├── provider-routes.js # Provider management
│   │   └── evaluation-routes.js
│   │
│   ├── orchestrator/          # Core algorithm
│   │   └── beam-search.js     # Beam search implementation
│   │
│   ├── providers/             # Provider implementations
│   │   ├── openai-llm-provider.js
│   │   ├── openai-image-provider.js
│   │   ├── openai-vision-provider.js
│   │   ├── local-llm-provider.js
│   │   ├── flux-image-provider.js
│   │   ├── local-vision-provider.js
│   │   └── mock-*.js          # Mock providers
│   │
│   ├── factory/               # Provider factory
│   │   └── provider-factory.js
│   │
│   ├── services/              # Business logic
│   │   ├── critique-generator.js
│   │   ├── image-ranker.js
│   │   ├── prompt-bundler.js
│   │   ├── prompt-refiner.js
│   │   └── metadata-tracker.js
│   │
│   ├── config/                # Configuration
│   │   ├── provider-config.js
│   │   └── rate-limits.js
│   │
│   └── utils/                 # Utilities
│       ├── token-tracker.js
│       ├── rate-limiter.js
│       └── model-coordinator.js  # GPU model coordination
│
├── services/                  # Python local services
│   ├── llm_service.py         # llama.cpp LLM (port 8003)
│   ├── flux_service.py        # Flux/SDXL (port 8001)
│   ├── vision_service.py      # CLIP + Aesthetic (port 8002)
│   └── requirements.txt
│
└── output/                    # Generated content
    └── YYYY-MM-DD/
        └── ses-HHMMSS/
            ├── metadata.json
            └── *.png
```
