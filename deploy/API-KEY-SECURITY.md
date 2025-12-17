# API Key Security - Multiple Approaches

You're right to be concerned. Here are the secure options for allowing users to provide their own OpenAI keys:

## ⭐ Recommended: API Key Proxy Pattern

Users provide their key **at request time** (not stored on server).

```javascript
// Frontend
const response = await fetch('/api/beam-search/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-OpenAI-API-Key': userProvidedKey  // User's key in header
  },
  body: JSON.stringify({ prompt, n, m, iterations, alpha, temperature })
});
```

```javascript
// Backend (middleware)
app.use('/api/beam-search', (req, res, next) => {
  const apiKey = req.headers['x-openai-api-key'];

  if (!apiKey || !apiKey.startsWith('sk-')) {
    return res.status(400).json({ error: 'Invalid OpenAI API key format' });
  }

  // Store temporarily in request context (never in database)
  req.openaiKey = apiKey;
  next();
});

// Then in beam search:
const providers = {
  llm: createLLMProvider({ apiKey: req.openaiKey }),
  imageGen: createImageProvider({ apiKey: req.openaiKey }),
  // ... etc
};
```

**Pros:**
- ✅ Key never stored on server
- ✅ You can't misuse user's API
- ✅ Full user control
- ✅ No liability for key exposure
- ✅ Simple to implement

**Cons:**
- ❌ Key transmitted over HTTPS (must use HTTPS!)
- ❌ Slightly more UX friction
- ❌ Can't batch jobs without re-authenticating

---

## Option 2: Client-Side Only (Most Secure)

Run beam search **entirely in the browser** using OpenAI API directly.

```javascript
// No server needed for OpenAI calls!
const openai = new OpenAI({ apiKey: userKey });

// Your server only orchestrates WebSocket updates
// All image generation happens client-side
```

**Pros:**
- ✅ Key literally never leaves user's browser
- ✅ Maximum security
- ✅ No HTTPS requirement for key transmission
- ✅ User can see they're calling their own API

**Cons:**
- ❌ Significant refactoring required
- ❌ No long-running server-side state
- ❌ WebSocket just for real-time updates
- ❌ Can't resume interrupted jobs

---

## Option 3: Hybrid (Recommended for Production)

**Server-side:** Beam search orchestration + metadata
**Client-side:** Image generation calls (user's key)

1. User provides key and prompt
2. Server validates key format (not actual validity)
3. Server manages beam search state
4. Server tells client "generate image with this prompt"
5. Client uses own key to call OpenAI directly
6. Client sends result back to server
7. Server continues orchestration

```javascript
// Frontend listens for generation requests
socket.on('generateImage', async (prompt, options) => {
  const openai = new OpenAI({ apiKey: userKey });
  const image = await openai.images.generate({ prompt, ...options });
  socket.emit('imageGenerated', { image, options });
});
```

**Pros:**
- ✅ Key in browser, never on server
- ✅ Full beam search capabilities
- ✅ Most secure + most functional
- ✅ Can verify user has valid key

**Cons:**
- ❌ Requires browser to stay open
- ❌ Moderate refactoring
- ❌ More complex state management

---

## Implementation: API Key Proxy (Easiest First Step)

Here's the minimal change to support user-provided keys:

### 1. Frontend - Add Key Input

```html
<!-- In demo.html -->
<div class="api-key-section">
  <label>
    OpenAI API Key:
    <input type="password" id="apiKey" placeholder="sk-...">
    <small>Your key stays in your session only</small>
  </label>
</div>
```

### 2. Frontend - Send Key with Request

```javascript
// In demo.js
async function startBeamSearch() {
  const apiKey = document.getElementById('apiKey').value;

  if (!apiKey) {
    // Fall back to server's key if user doesn't provide one
    // (for backward compatibility)
  }

  const response = await fetch('/api/beam-search/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenAI-API-Key': apiKey  // Send user's key
    },
    body: JSON.stringify({ prompt, n, m, iterations, alpha, temperature })
  });

  // ... rest of code
}
```

### 3. Backend - Accept User Key

```javascript
// In beam-search-worker.js
export async function startBeamSearchJob(jobId, params, userApiKey) {
  const apiKey = userApiKey || process.env.OPENAI_API_KEY;

  // Create providers with user's key
  const providers = {
    llm: createLLMProvider({ apiKey }),
    imageGen: createImageProvider({ apiKey }),
    vision: createVisionProvider({ apiKey }),
    critiqueGen: createCritiqueGenerator({ apiKey }),
    imageRanker: createImageRanker({ apiKey })
  };

  // ... rest of beam search
}
```

### 4. Middleware - Extract & Validate Key

```javascript
// In src/api/routes/beam-search.js
app.post('/api/beam-search/start', (req, res) => {
  let apiKey = req.headers['x-openai-api-key'];

  // Validate format (basic check)
  if (apiKey && !apiKey.startsWith('sk-')) {
    return res.status(400).json({
      error: 'Invalid API key format. Should start with sk-'
    });
  }

  // Use user's key if provided, else server's
  apiKey = apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({
      error: 'No API key provided. Include X-OpenAI-API-Key header or set OPENAI_API_KEY env var'
    });
  }

  // Pass to beam search
  startBeamSearchJob(jobId, req.body, apiKey);
  res.json({ jobId });
});
```

---

## Security Best Practices

### ✅ DO:
- Always use **HTTPS** (never HTTP if transmitting keys)
- **Never log** the API key
- **Validate format** but not actual key validity on server
- **Inform users** their key stays in their session
- **Clear key** from memory after job completes
- **Never store** keys in database or logs

### ❌ DON'T:
- Store keys in server-side session storage
- Log keys in any form
- Use HTTP (only HTTPS)
- Email or backup keys
- Re-use one key for all users

### 🛡️ Extra Security (Optional):

```javascript
// Add rate limiting per IP
app.use('/api/beam-search', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10 // 10 requests per IP per 15 mins
}));

// Require HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Validate key isn't in logs
console.log('Job started'); // ✅ OK
console.log(`Job started with key ${apiKey}`); // ❌ NEVER DO THIS!
```

---

## My Recommendation for Your Setup

**Start with:** API Key Proxy (Option 1 above)
- Easiest to implement
- Secure enough for hobby/testing
- Users feel in control
- Can upgrade later

**Key points:**
1. Add API key input to the form
2. Send it in request header
3. Use it to create providers
4. Never store it
5. Add HTTPS requirement for production

This way:
- You're not doing their work with your key
- Users know exactly what API they're using
- You have no liability for key exposure
- They can rate-limit/monitor on their own dashboard

---

## Production Deployment Checklist

- [ ] Frontend form has API key input
- [ ] Backend accepts `X-OpenAI-API-Key` header
- [ ] Falls back to `OPENAI_API_KEY` env var if header empty
- [ ] HTTPS enforced (not HTTP)
- [ ] API key never logged or stored
- [ ] Rate limiting configured
- [ ] Privacy policy mentions key handling
- [ ] Tests pass with both user-provided and server keys

Would you like me to implement the API Key Proxy pattern in your code?
