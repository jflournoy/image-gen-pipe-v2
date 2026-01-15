# Settings UI Refactor Plan

## Current Problems

### Confusion & Redundancy
1. **Duplicate Actions**: "Quick Local" button + Local Mode card both do same thing
2. **Nested Complexity**: Flux model config hidden inside Image Provider dropdown in Advanced section
3. **Scattered Information**: Service status, quick start, and model management are disconnected
4. **Unclear Hierarchy**: Mode cards vs Advanced config - when to use which?
5. **Hidden Context**: Flux config only appears when you select Flux, but users don't know it exists

### User Mental Model Issues
- Users want to: "Use local models" → Current UI makes them navigate multiple sections
- Unclear what "Advanced Configuration" means vs mode selection
- Service management split between multiple sections
- Model source (HF vs Local) buried three levels deep

## Proposed Solution

### 3-Section Layout

#### Section 1: Mode Selection (Simplified)
**Goal**: One-click decision for most users

```
┌─────────────────────────────────────────────────┐
│ Choose Your Setup                               │
│                                                 │
│  ┌──────────────┐  ┌──────────────┐           │
│  │  ☁️ OpenAI   │  │  🖥️ Local     │           │
│  │              │  │              │           │
│  │ • Fast       │  │ • Private    │           │
│  │ • Reliable   │  │ • Free       │           │
│  │ • $$ costs   │  │ • GPU needed │           │
│  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────┘
```

**Actions**:
- Click OpenAI → Sets all providers to OpenAI, done
- Click Local → Shows Section 2 (Local Configuration)

#### Section 2: Configuration (Context-Aware)
**Goal**: Only show relevant settings based on mode

**If OpenAI Mode**:
- Just show API key status (if needed)
- No other settings needed

**If Local Mode**:
```
┌─────────────────────────────────────────────────┐
│ Local Configuration                             │
│                                                 │
│ Services to Use:                                │
│  ☑ LLM (Prompt refinement)      [Status: 🟢]   │
│  ☑ Flux (Image generation)      [Status: 🟢]   │
│    └─ Model: [HuggingFace ▼] [Local File]      │
│       └─ FLUX.1-dev OR /path/to/model.safetensors
│  ☑ Vision (Image scoring)       [Status: 🟢]   │
│  ☑ VLM (Tournament ranking)     [Status: 🟡]   │
│                                                 │
│ [🚀 Start All Services]                         │
└─────────────────────────────────────────────────┘
```

**If Mixed Mode** (Advanced users):
- Show granular dropdowns for each provider
- Collapsed by default

#### Section 3: Model & Service Management
**Goal**: One place for downloads, paths, and service control

```
┌─────────────────────────────────────────────────┐
│ 📦 Models & Services                            │
│                                                 │
│ Available Models:                               │
│  • Flux FLUX.1-dev       [Downloaded] [↻ Load] │
│  • LLM Mistral-7B        [Download]            │
│  • Vision CLIP+Aesthetic [Installed]           │
│                                                 │
│ Custom Model Paths:                             │
│  • Flux: [Browse...] [/path/to/model.safetensors]
│                                                 │
│ Service Status:                                 │
│  • Flux:  🟢 Running (12GB GPU)                │
│  • LLM:   🟢 Running                           │
│  • Vision: 🟢 Running                          │
│  • VLM:   ⚪ Not started                       │
└─────────────────────────────────────────────────┘
```

## Key Improvements

### 1. Clear Hierarchy
```
Mode Selection → Configuration → Management
(What?)        (How?)          (Details)
```

### 2. Progressive Disclosure
- Simple choice first (OpenAI vs Local)
- Relevant settings appear based on choice
- Advanced options hidden but accessible

### 3. Unified Model Management
- All model operations in one place
- See what's downloaded
- Set custom paths
- View service status

### 4. Remove Redundancy
- Delete "Quick Local" button (use mode card instead)
- Combine service status and quick start
- Flux model source inline with provider selection

### 5. Context-Aware UI
```javascript
if (mode === 'openai') {
  // Hide local service stuff
  // Just show API key if needed
} else if (mode === 'local') {
  // Show service checkboxes
  // Show model management
  // Inline Flux model source
} else {
  // Mixed mode: show advanced dropdowns
}
```

## Implementation Plan

### Phase 1: Structure (TDD)
1. **Test**: UI has 3 clear sections
2. **Test**: Mode selection cards trigger configuration display
3. **Test**: Configuration section is context-aware
4. **Implement**: New HTML structure

### Phase 2: Flux Integration (TDD)
1. **Test**: Flux model source toggle appears inline with Flux service
2. **Test**: Custom path input appears when "Local File" selected
3. **Test**: No nested dropdowns - flat hierarchy
4. **Implement**: Inline Flux model configuration

### Phase 3: Service Management (TDD)
1. **Test**: Unified service status display
2. **Test**: Model download status integrated
3. **Test**: Start/stop actions clear and accessible
4. **Implement**: Combined management section

### Phase 4: Cleanup (TDD)
1. **Test**: No duplicate "Quick Local" button
2. **Test**: Advanced configuration collapsed by default
3. **Test**: Consistent visual hierarchy
4. **Implement**: Remove redundant elements

## Success Criteria

### User Can:
1. ✅ Choose mode with one click
2. ✅ See relevant settings only (no clutter)
3. ✅ Find model source toggle easily (not buried)
4. ✅ See all service status in one place
5. ✅ Download/configure models without hunting

### Technical:
1. ✅ All existing tests pass
2. ✅ New tests cover all interactions
3. ✅ No breaking changes to API
4. ✅ JavaScript event handlers cleanly organized

## Wire Sketches

### Mobile/Narrow View
```
┌──────────────────────┐
│ Choose Your Setup    │
│                      │
│ [OpenAI] [Local]     │
├──────────────────────┤
│ Local Configuration  │
│                      │
│ ☑ LLM     🟢         │
│ ☑ Flux    🟢         │
│   HF / Local File    │
│ ☑ Vision  🟢         │
│ ☑ VLM     ⚪         │
│                      │
│ [Start All Services] │
├──────────────────────┤
│ Models & Services    │
│                      │
│ Flux: Downloaded     │
│ LLM:  Download       │
│                      │
│ Custom Paths:        │
│ [Browse...]          │
└──────────────────────┘
```

### Desktop/Wide View
```
┌─────────────────────────────────────────────────────────┐
│ Choose Your Setup                                       │
│                                                         │
│  [OpenAI Card]        [Local Card]                      │
├─────────────────────────────────────────────────────────┤
│ Local Configuration                                     │
│                                                         │
│  ☑ LLM (Prompt)      🟢  ☑ Flux (Images)    🟢         │
│                          HF / Local: /path/to/model     │
│  ☑ Vision (Score)    🟢  ☑ VLM (Ranking)    ⚪         │
│                                                         │
│  [🚀 Start All Services]                                │
├─────────────────────────────────────────────────────────┤
│ 📦 Models & Services                                    │
│                                                         │
│  Flux: [Downloaded]  LLM: [Download]  Vision: [✓]      │
│  Custom: [Browse...] [/path/to/custom.safetensors]     │
└─────────────────────────────────────────────────────────┘
```

## Migration Notes

### Backward Compatibility
- Keep all existing IDs for form elements
- Maintain API endpoints unchanged
- JavaScript functions get new organization but same signatures
- Tests extended, not replaced

### Removed Elements
- "Quick Local" button (redundant with mode card)
- Nested Flux config inside dropdown (now inline)
- Separate "Advanced Provider Configuration" section (merged into context-aware config)

### Added Elements
- Service checkboxes with inline status
- Inline Flux model source toggle
- Unified model management section
- Context-aware configuration display

## Timeline

- **Planning**: ✅ Complete (this document)
- **Phase 1**: ~30 min (structure tests + implementation)
- **Phase 2**: ~20 min (Flux integration)
- **Phase 3**: ~20 min (service management)
- **Phase 4**: ~15 min (cleanup)
- **Total**: ~90 minutes

## Next Steps

1. Create test file: `test/ui/settings-ui-refactor.test.js`
2. Write RED tests for Phase 1 (structure)
3. Implement GREEN (make tests pass)
4. Verify all existing tests still pass
5. Move to Phase 2

---

**Review Date**: 2026-01-14
**Status**: Draft → Ready for TDD implementation
