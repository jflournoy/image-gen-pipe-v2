# Cloud Deployment (Linode / Production)

*Last updated: 2026-02-26*

## Overview

When deployed to a cloud server (Linode or similar), the app automatically restricts itself to **OpenAI-only providers**. Users bring their own OpenAI API key, entered in the browser — no API key is stored on the server.

Local GPU services (Flux, Chroma, local LLM, VLM) are unavailable in this mode and are hidden from the UI.

---

## How It Works

### Detection

The server detects cloud mode when **either** condition is true:

- `NODE_ENV=production`
- Request hostname is not `localhost` / `127.0.0.1`

This is evaluated per-request in `GET /api/providers/status` ([src/api/provider-routes.js](../src/api/provider-routes.js)):

```js
const isLocal = process.env.NODE_ENV === 'development' ||
                req.hostname === 'localhost' ||
                req.hostname === '127.0.0.1';
```

### Backend enforcement

`POST /api/providers/switch` rejects non-OpenAI providers with `403` when `NODE_ENV=production`:

```js
if (providerConfig.isProduction) {
  if ((llm && llm !== 'openai') || (image && image !== 'openai') || (vision && vision !== 'openai')) {
    return res.status(403).json({ error: 'Cloud mode: only OpenAI providers are available' });
  }
}
```

Provider defaults are also locked at config load time in [src/config/provider-config.js](../src/config/provider-config.js):

```js
const isProduction = process.env.NODE_ENV === 'production';

llm:    { provider: isProduction ? 'openai'      : (process.env.LLM_PROVIDER    || 'openai') }
image:  { provider: isProduction ? 'dalle'        : (process.env.IMAGE_PROVIDER  || 'dalle')  }
vision: { provider: isProduction ? 'gpt-vision'   : (process.env.VISION_PROVIDER || 'gpt-vision') }
```

### Frontend enforcement

On page load, `loadProviderStatus()` calls `applyCloudMode()` ([public/demo.js](../public/demo.js)) when `isLocal === false`:

- Removes all non-OpenAI options from the three provider dropdowns and disables them
- Hides local/third-party settings sections: `fluxSettings`, `chromaSettings`, `bflSettings`, `modalSettings`, `localLLMSettings`, `localVisionSettings`
- Highlights the API key input with a blue border

The environment badge in the sidebar changes from green "Local Development" to blue "Linode Server".

---

## Deployment Steps

### 1. Set the environment variable

```bash
NODE_ENV=production
```

Set this in your systemd unit, Docker env, or `.env` file on the server. This is the only required variable for cloud mode to activate.

### 2. Optionally pre-configure OpenAI models

```bash
OPENAI_LLM_MODEL=gpt-5-mini
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_VISION_MODEL=gpt-5-nano
```

If omitted, sensible defaults are used (see [MODEL_SELECTION_GUIDE.md](MODEL_SELECTION_GUIDE.md)).

### 3. Start the server

```bash
NODE_ENV=production node src/api/server.js
# or
NODE_ENV=production npm start
```

---

## User Experience in Cloud Mode

1. User visits the app URL
2. Sidebar shows **"Linode Server — Using OpenAI providers"** (blue badge)
3. Provider dropdowns show only "OpenAI" and are disabled (no switching)
4. API key field has a blue border and **"sk-... (required)"** placeholder
5. User enters their `sk-...` OpenAI key
6. Beam search runs using OpenAI for LLM, image generation, and vision scoring
7. API key is stored in `sessionStorage` only — cleared when the browser tab closes

---

## What's Not Available in Cloud Mode

| Feature | Status |
|---|---|
| Flux (local GPU) | Hidden |
| Chroma (local GPU) | Hidden |
| BFL API | Hidden |
| Modal (cloud GPU) | Hidden |
| Local LLM (Qwen3) | Hidden |
| Local Vision (CLIP) | Hidden |
| VLM pairwise ranking | Hidden |
| Service start/stop controls | Hidden |

OpenAI-based pairwise ranking (`ImageRanker`) remains available.

---

## Security Notes

- The OpenAI API key is sent via `X-OpenAI-API-Key` request header and used only for the duration of the beam search job
- Keys are never logged, written to disk, or stored server-side
- `sessionStorage` (browser tab scope) is used on the client — not `localStorage`
- The `POST /api/providers/switch` endpoint actively rejects non-OpenAI providers at the HTTP layer when in production mode

---

## Related Docs

- [API_SETUP.md](API_SETUP.md) — OpenAI API key setup
- [PROVIDER_SWITCHING.md](PROVIDER_SWITCHING.md) — Full provider switching system
- [MODEL_SELECTION_GUIDE.md](MODEL_SELECTION_GUIDE.md) — Which OpenAI models are used and why
