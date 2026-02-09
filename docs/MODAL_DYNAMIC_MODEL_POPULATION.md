# Modal Dynamic Model Population

This document describes how modal models are dynamically populated in the UI, allowing users to select from available models provided by the Modal service.

## Overview

The modal provider UI includes a dynamic model selector that fetches available models from the Modal service API and populates a dropdown menu. This is implemented in the `loadModalModels()` function which:

1. Fetches available models from `/api/providers/modal/models` endpoint
2. Groups models by type (builtin vs custom) and pipeline (flux, sdxl, sd3)
3. Organizes models into optgroups for better UX
4. Preserves user's previous selection when updating
5. Provides graceful fallback with hardcoded models if fetch fails

## Implementation Details

### loadModalModels() Function

**Location**: [public/demo.js:707-804](../public/demo.js#L707-L804)

```javascript
async function loadModalModels() {
  const modalSelect = document.getElementById('modalModel');
  if (!modalSelect) return;

  try {
    console.log('[Modal Models] Fetching available models...');

    const response = await fetch('/api/providers/modal/models');

    if (!response.ok) {
      console.warn(`[Modal Models] Failed to fetch models (${response.status}), using hardcoded list`);
      return;
    }

    const data = await response.json();
    const models = data.models || [];

    if (models.length === 0) {
      console.warn('[Modal Models] No models returned, using hardcoded list');
      return;
    }

    // Group models by type
    const builtinModels = models.filter(m => m.type === 'builtin');
    const customModels = models.filter(m => m.type === 'custom');

    // Save current selection
    const currentValue = modalSelect.value;

    // Clear existing options
    modalSelect.innerHTML = '';

    // Add built-in models grouped by pipeline
    const fluxBuiltin = builtinModels.filter(m => m.pipeline === 'flux');
    const sdxlBuiltin = builtinModels.filter(m => m.pipeline === 'sdxl');
    const sd3Builtin = builtinModels.filter(m => m.pipeline === 'sd3');

    // Create optgroups for each pipeline type...
    // [Implementation continues with optgroup creation]

    // Restore previous selection if it still exists
    if (currentValue && Array.from(modalSelect.options).some(opt => opt.value === currentValue)) {
      modalSelect.value = currentValue;
    }

    console.log(`[Modal Models] Loaded ${models.length} models (${builtinModels.length} built-in, ${customModels.length} custom)`);

  } catch (error) {
    console.warn('[Modal Models] Error fetching models:', error.message);
    console.log('[Modal Models] Using hardcoded model list as fallback');
  }
}
```

### API Endpoint

**Route**: `GET /api/providers/modal/models`

**Location**: [src/routes/provider-routes.js:1552-1578](../src/routes/provider-routes.js#L1552-L1578)

**Response Format**:
```json
{
  "models": [
    {
      "name": "flux-dev",
      "type": "builtin",
      "pipeline": "flux"
    },
    {
      "name": "custom-model",
      "type": "custom",
      "pipeline": "flux"
    }
  ],
  "endpoint": "https://user--models.modal.run/"
}
```

### Model Data Structure

Models returned from the API have the following structure:

```javascript
{
  name: string,        // Model identifier (e.g., "flux-dev", "custom-model")
  type: string,        // 'builtin' or 'custom'
  pipeline: string     // 'flux', 'sdxl', or 'sd3'
}
```

### UI Organization

Models are organized into optgroups by pipeline type:

- **Flux Models** - All flux-based models (builtin and custom)
  - flux-dev
  - flux-schnell
  - custom-flux-variant (if custom)

- **SDXL Models** - All sdxl-based models
  - sdxl-turbo
  - sdxl-base
  - custom-sdxl-variant (if custom)

- **SD3 Models** - All sd3-based models
  - sd3-medium
  - custom-sd3-variant (if custom)

- **Custom Models** - All custom-trained models (separate group)

### formatModelName() Helper

**Location**: [public/demo.js:810-822](../public/demo.js#L810-L822)

Converts model names to user-friendly display format:
- Converts underscores to spaces
- Converts dashes to spaces
- Capitalizes first letter

Example: `flux-dev` → `Flux Dev`

## Initialization and Timing

### Page Load Initialization

**Location**: [public/demo.js:1385](../public/demo.js#L1385)

```javascript
// Initialize BFL, Modal, and Flux settings on page load
loadModalModels().then(() => loadModalSettings()); // Load models first, then restore settings
```

The models are loaded during initial page load, followed by restoration of user settings from localStorage.

### Provider Change Handler

**Location**: [public/demo.js:1400-1401](../public/demo.js#L1400-L1401)

```javascript
if (this.value === 'modal') {
  loadModalModels().then(() => loadModalSettings());
}
```

When user switches to the modal provider, models are fetched fresh from the API and settings are restored.

## Error Handling

The function implements graceful fallback:

1. **Network Error**: If fetch fails, logs warning and uses hardcoded model list
2. **Empty Models**: If API returns no models, logs warning and uses hardcoded list
3. **Selection Preservation**: If previous selection no longer exists, first available model is selected

### Hardcoded Fallback Models

**Location**: [public/demo.html:1584-1618](../public/demo.html#L1584-L1618)

Default models provided as fallback:
- flux-dev (25 steps, default)
- flux-schnell (4 steps)
- sdxl-turbo (4 steps)

## Settings Persistence

Modal model selection is persisted to localStorage:

**Storage Key**: `modalModel`

Related functions:
- [saveModalSettings()](../public/demo.js#L612) - Saves current selection
- [loadModalSettings()](../public/demo.js#L677) - Restores previous selection

### Model Selection Flow

1. User selects model from dropdown
2. `updateModalModelDefaults()` updates steps/guidance based on model choice
3. `saveModalSettings()` persists selection to localStorage
4. On next page load, `loadModalSettings()` restores user's choice

## Testing

Comprehensive tests are provided in: [test/ui/modal-dynamic-model-population.test.js](../test/ui/modal-dynamic-model-population.test.js)

Test coverage includes:
- Function definition and API endpoint fetching
- Model grouping by type and pipeline
- UI population with optgroups
- Selection preservation
- Error handling and fallback behavior
- Function initialization and timing
- Modal settings container structure
- Hardcoded fallback options
- Model name formatting
- Clear and repopulate behavior

Run tests with:
```bash
node --test test/ui/modal-dynamic-model-population.test.js
```

## Model Defaults

Each model has associated defaults for steps and guidance:

**Location**: [public/demo.js:634-639](../public/demo.js#L634-L639)

```javascript
const MODAL_MODEL_DEFAULTS = {
  'flux-dev': { steps: 25, guidance: 3.5 },
  'flux-schnell': { steps: 4, guidance: 0.0 },
  'sdxl-turbo': { steps: 4, guidance: 0.0 },
  'sdxl-base': { steps: 30, guidance: 7.5 },
  'sd3-medium': { steps: 28, guidance: 7.0 }
};
```

When user selects a model, these defaults are applied to the steps and guidance sliders.

## Related Components

- **Modal Settings Container**: [public/demo.html:1584-1618](../public/demo.html#L1584-L1618)
- **Model Dropdown**: `id="modalModel"` with `onchange="updateModalModelDefaults(); saveModalSettings();"`
- **GPU Selection**: `id="modalGpu"` - Independent of model selection
- **Steps Control**: `id="modalSteps"` (1-50 range, default 25)
- **Guidance Control**: `id="modalGuidance"` (0-20 range, default 3.5)

## Performance Considerations

- **Async Loading**: Models are fetched asynchronously to avoid blocking UI
- **Selection Preservation**: User's previous choice is restored, minimizing UX disruption
- **Fallback Provided**: Hardcoded models ensure functionality even if API is unavailable
- **Logging**: Debug logging helps troubleshoot model loading issues

## Future Enhancements

Potential improvements:
1. Cache model list for faster subsequent loads
2. Add model descriptions/tooltips
3. Add model performance benchmarks
4. Support filtering models by capability/performance tier
5. Add model preview images or descriptions

## See Also

- [Modal Provider Documentation](./MODAL_PROVIDER.md)
- [Provider Factory](../src/factory/provider-factory.js)
- [Provider Routes](../src/routes/provider-routes.js)
