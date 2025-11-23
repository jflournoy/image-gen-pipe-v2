# Provider Interfaces

The Image Generation Pipeline uses a provider-based architecture that allows swapping implementations while maintaining consistent interfaces.

## Provider Types

### LLM Provider

Handles text generation and prompt refinement.

```javascript
class LLMProvider {
  // Expand or refine a prompt
  async refinePrompt(prompt, options) {
    // options.dimension: 'what' | 'how'
    // options.operation: 'expand' | 'refine'
    // options.critique: string (for refinement)
    return {
      refinedPrompt: string,
      explanation: string,
      metadata: { dimension, operation, model, tokensUsed }
    };
  }

  // Combine WHAT and HOW prompts
  async combinePrompts(whatPrompt, howPrompt) {
    return string; // Combined prompt
  }
}
```

**Implementations:**

- `OpenAILLMProvider` - Uses GPT-4 for production
- `MockLLMProvider` - Deterministic responses for testing

### Image Provider

Generates images from prompts.

```javascript
class ImageProvider {
  async generateImage(prompt, options) {
    // options.size: '1024x1024' | '1024x1792' | '1792x1024'
    // options.quality: 'standard' | 'hd'
    // options.style: 'vivid' | 'natural'
    // options.iteration: number
    // options.candidateId: number
    return {
      url: string,           // Temporary URL
      localPath: string,     // Persistent local path
      revisedPrompt: string, // DALL-E's revised prompt
      metadata: { model, size, quality, style, timestamp }
    };
  }
}
```

**Implementations:**

- `OpenAIImageProvider` - Uses DALL-E 3 with local storage
- `MockImageProvider` - Returns test image URLs

### Vision Provider

Analyzes images for alignment and aesthetic quality.

```javascript
class VisionProvider {
  async analyzeImage(imageUrl, prompt) {
    return {
      alignmentScore: number,  // 0-100
      aestheticScore: number,  // 0-10
      analysis: string,        // Detailed feedback
      strengths: string[],     // What works well
      weaknesses: string[],    // Areas for improvement
      metadata: { model, tokensUsed, timestamp }
    };
  }
}
```

**Implementations:**

- `OpenAIVisionProvider` - Uses GPT-4V (gpt-4o)
- `MockVisionProvider` - Deterministic scoring

### Scoring Provider

Calculates combined scores from alignment and aesthetic evaluations.

```javascript
class ScoringProvider {
  async scoreCandidate(data) {
    // data.alignmentScore: number (0-100)
    // data.aestheticScore: number (0-10)
    // data.alpha: number (default 0.7)
    return {
      totalScore: number,
      breakdown: { alignment, aesthetic },
      timestamp: string
    };
  }
}
```

**Formula:** `totalScore = alpha * alignment + (1-alpha) * aesthetic * 10`

**Implementations:**

- `MockScoringProvider` - Standard weighted calculation

### Critique Generator

Generates feedback for prompt refinement.

```javascript
class CritiqueGenerator {
  async generateCritique(evaluation, prompts, options) {
    // evaluation: { alignmentScore, aestheticScore, analysis }
    // prompts: { what, how, combined }
    // options: { dimension, iteration }
    return {
      critique: string,
      recommendation: string,
      reason: string
    };
  }
}
```

**Implementations:**

- `CritiqueGenerator` (service) - LLM-based critique
- `MockCritiqueGenerator` - Rule-based responses

## Provider Factory

Use the factory to create providers based on mode:

```javascript
const { createLLMProvider, createImageProvider, createVisionProvider }
  = require('./src/factory/provider-factory');

// Production mode
const llm = createLLMProvider({ mode: 'real', apiKey: process.env.OPENAI_API_KEY });
const image = createImageProvider({ mode: 'real', apiKey: process.env.OPENAI_API_KEY });
const vision = createVisionProvider({ mode: 'real', apiKey: process.env.OPENAI_API_KEY });

// Test mode
const mockLLM = createLLMProvider({ mode: 'mock' });
const mockImage = createImageProvider({ mode: 'mock' });
const mockVision = createVisionProvider({ mode: 'mock' });
```

## Configuration

### OpenAI Provider Options

```javascript
const provider = new OpenAILLMProvider(apiKey, {
  model: 'gpt-4',        // Model to use
  maxRetries: 3,         // Retry attempts
  timeout: 60000         // Timeout in ms
});
```

### Image Provider Options

```javascript
const provider = new OpenAIImageProvider(apiKey, {
  saveLocally: true,           // Save images to disk
  outputDir: './output',       // Output directory
  sessionId: 'my-session'      // Custom session ID
});
```

## See Also

- [REST API](rest-api.md)
- [WebSocket API](websocket-api.md)
- [Storage Specification](provider-storage-spec.md)
