# Encoder Path Resolution Fix

## Issue
When selecting a local Flux model from the UI dropdown, the application was storing relative encoder paths in localStorage but not converting them to absolute paths before passing them to the Python service. This caused the encoder_loading.py module to fail to find the encoder files and fall back to downloading them from HuggingFace, which resulted in shape mismatches for custom models like CustomModel.

Error example:
```
[Flux Service] Attempting fallback 1/2 for CLIP-L...
mat1 and mat2 shapes cannot be multiplied (512x768 and 4096x3072)
```

## Root Cause
1. UI stores relative paths in localStorage: `services/encoders/clip_l.safetensors`
2. API receives relative paths and passes them to ServiceManager
3. ServiceManager was passing relative paths directly as environment variables
4. Python service spawned with relative paths couldn't find files (cwd mismatch)
5. encoder_loading.py fell back to HuggingFace encoders

## Solution
Modified `src/utils/service-manager.js` to resolve relative encoder paths to absolute paths before spawning the Python service:

```javascript
// In startService() when serviceName === 'flux':
const projectRoot = path.join(__dirname, '../../');

if (options.textEncoderPath !== undefined) {
  const encoderPath = path.resolve(projectRoot, options.textEncoderPath);
  serviceEnv.FLUX_TEXT_ENCODER_PATH = encoderPath;
}
```

This ensures the Python service always receives absolute paths regardless of the working directory.

## Debug Improvements
Added logging in:
1. **flux_service.py** - Logs custom encoder paths at startup
2. **encoder_loading.py** - Checks if path exists before loading and logs verification

## Testing

### Browser Console (demo.html)
When selecting a model:
```
[UI] Set encoder paths in localStorage: {clip: 'services/encoders/clip_l.safetensors', ...}
[UI Modal] Encoder settings: useLocalEncoders=true, CLIP=services/encoders/clip_l.safetensors, ...
```

### Service Logs (/tmp/beam-search-services/flux.log)
Should see:
```
[ServiceManager] Using custom CLIP-L encoder path: /home/jflournoy/code/image-gen-pipe-v2/services/encoders/clip_l.safetensors
[ServiceManager] Using custom T5-XXL encoder path: /home/jflournoy/code/image-gen-pipe-v2/services/encoders/model.safetensors
[ServiceManager] Using custom VAE encoder path: /home/jflournoy/code/image-gen-pipe-v2/services/encoders/ae.safetensors
```

Then:
```
[Flux Service] Custom encoder paths configured:
  - CLIP-L: /home/jflournoy/code/image-gen-pipe-v2/services/encoders/clip_l.safetensors
  - T5-XXL: /home/jflournoy/code/image-gen-pipe-v2/services/encoders/model.safetensors
  - VAE: /home/jflournoy/code/image-gen-pipe-v2/services/encoders/ae.safetensors

[Flux Service] Loading CLIP-L from local path: /home/jflournoy/code/image-gen-pipe-v2/services/encoders/clip_l.safetensors
[Flux Service] Path verified to exist, loading CLIP-L...
[Flux Service] Successfully loaded local CLIP-L encoder
```

### Success Criteria
- ✅ Encoder paths logged as absolute paths in service logs
- ✅ "Path verified to exist" message appears (file found)
- ✅ "Successfully loaded local CLIP-L/T5-XXL encoder" messages appear
- ✅ Image generation completes without shape mismatch errors
- ✅ No "Attempting fallback" messages appear

### Test Steps
1. Open demo.html in browser
2. Go to Settings > Local Configuration
3. Click "Load Models" in the Flux Model section
4. Select a local model from the dropdown
5. Start the Flux service
6. Check service logs for absolute paths and successful loading
7. Generate an image to verify no shape mismatches occur

## Files Changed
- `src/utils/service-manager.js` - Path resolution for encoder/model/lora paths
- `services/flux_service.py` - Debug logging for encoder configuration
- `services/encoder_loading.py` - Path existence check before loading

## Related Issues
- [Previous conversations] Local encoders not being used with custom Flux models
- Addresses the CustomModel model encoder mismatch issue
