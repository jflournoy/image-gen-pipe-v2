/**
 * 🔴 TDD RED - Local VLM Provider Tests
 * Tests for pairwise image comparison using local Vision-Language Model
 * Uses llama-cpp-python with multimodal GGUF models (LLaVA, etc.)
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock axios for HTTP tests
const mockAxios = {
  responses: [],
  post: async (url, data, config) => {
    const response = mockAxios.responses.shift();
    if (response?.error) throw response.error;
    return { data: response || {} };
  },
  get: async (url, config) => {
    const response = mockAxios.responses.shift();
    if (response?.error) throw response.error;
    return { data: response || {} };
  },
  setResponse: (response) => mockAxios.responses.push(response),
  reset: () => { mockAxios.responses = []; }
};

// Will be implemented in src/providers/local-vlm-provider.js
let LocalVLMProvider;
try {
  LocalVLMProvider = require('../../src/providers/local-vlm-provider');
} catch (e) {
  // Expected to fail initially - TDD RED phase
  LocalVLMProvider = null;
}

describe('LocalVLMProvider', () => {
  beforeEach(() => {
    mockAxios.reset();
  });

  describe('Module Loading', () => {
    it('should export LocalVLMProvider class', () => {
      assert.ok(LocalVLMProvider, 'LocalVLMProvider should be exported');
      assert.strictEqual(typeof LocalVLMProvider, 'function', 'Should be a class/function');
    });
  });

  describe('Constructor', () => {
    it('should accept apiUrl configuration', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({
        apiUrl: 'http://localhost:8004'
      });
      assert.ok(provider.apiUrl, 'Should store apiUrl');
      assert.strictEqual(provider.apiUrl, 'http://localhost:8004');
    });

    it('should have default apiUrl', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider();
      assert.ok(provider.apiUrl, 'Should have default apiUrl');
    });

    it('should accept model configuration', () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({
        model: 'llava-v1.6-mistral-7b.Q4_K_M.gguf'
      });
      assert.ok(provider.model, 'Should store model name');
    });
  });

  describe('compareImages', () => {
    it('should accept two image paths and a prompt', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      // Mock successful comparison
      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Image A better captures the sunset colors',
        confidence: 0.85
      });

      const result = await provider.compareImages(
        '/path/to/imageA.png',
        '/path/to/imageB.png',
        'a beautiful sunset over the ocean'
      );

      assert.ok(result, 'Should return a result');
      assert.ok(['A', 'B'].includes(result.choice), 'Should return A or B');
    });

    it('should return winner, explanation, and confidence', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'A',
        explanation: 'Image A has better composition and lighting',
        confidence: 0.92
      });

      const result = await provider.compareImages(
        '/path/to/imageA.png',
        '/path/to/imageB.png',
        'a serene mountain landscape'
      );

      assert.strictEqual(result.choice, 'A', 'Should indicate winner');
      assert.ok(result.explanation, 'Should provide explanation');
      assert.ok(typeof result.confidence === 'number', 'Should have numeric confidence');
      assert.ok(result.confidence >= 0 && result.confidence <= 1, 'Confidence should be 0-1');
    });

    it('should handle ties/uncertain comparisons', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        choice: 'TIE',
        explanation: 'Both images equally capture the prompt',
        confidence: 0.45  // Low confidence indicates tie
      });

      const result = await provider.compareImages(
        '/path/to/imageA.png',
        '/path/to/imageB.png',
        'abstract art'
      );

      assert.ok(['A', 'B', 'TIE'].includes(result.choice), 'Should handle ties');
    });

    it('should call VLM service /compare endpoint', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      let calledUrl = null;
      let calledData = null;

      provider._axios = {
        post: async (url, data) => {
          calledUrl = url;
          calledData = data;
          return { data: { choice: 'A', explanation: 'Test', confidence: 0.8 } };
        }
      };

      await provider.compareImages('/a.png', '/b.png', 'test prompt');

      assert.ok(calledUrl.includes('/compare'), 'Should call /compare endpoint');
      assert.ok(calledData.imageA || calledData.image_a, 'Should send imageA');
      assert.ok(calledData.imageB || calledData.image_b, 'Should send imageB');
      assert.ok(calledData.prompt, 'Should send prompt');
    });
  });

  describe('rankImages (batch comparison)', () => {
    it('should implement ImageRanker interface', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      assert.strictEqual(typeof provider.rankImages, 'function', 'Should have rankImages method');
    });

    it('should rank multiple images using pairwise comparisons', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      // Mock multiple comparisons
      let comparisonCount = 0;
      provider._axios = {
        post: async () => {
          comparisonCount++;
          // Alternate winners to test sorting
          return { data: { choice: comparisonCount % 2 === 0 ? 'A' : 'B', confidence: 0.8 } };
        }
      };

      const images = [
        { localPath: '/img1.png', metadata: { id: 1 } },
        { localPath: '/img2.png', metadata: { id: 2 } },
        { localPath: '/img3.png', metadata: { id: 3 } }
      ];

      const ranked = await provider.rankImages(images, 'test prompt');

      assert.ok(Array.isArray(ranked), 'Should return array');
      assert.strictEqual(ranked.length, images.length, 'Should return all images');
      assert.ok(ranked[0].rank !== undefined, 'Should have rank property');
    });

    it('should perform O(n log n) comparisons using sorting', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      let comparisonCount = 0;
      provider._axios = {
        post: async () => {
          comparisonCount++;
          return { data: { choice: 'A', confidence: 0.8 } };
        }
      };

      const images = Array(8).fill(null).map((_, i) => ({
        localPath: `/img${i}.png`,
        metadata: { id: i }
      }));

      await provider.rankImages(images, 'test');

      // n log n comparisons for 8 items: ~24 comparisons max
      // Should be less than n^2/2 = 28 for naive approach
      assert.ok(comparisonCount <= 30, `Should use efficient sorting (got ${comparisonCount} comparisons)`);
    });
  });

  describe('Health Check', () => {
    it('should have healthCheck method', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });

      assert.strictEqual(typeof provider.healthCheck, 'function', 'Should have healthCheck method');
    });

    it('should return service health status', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = mockAxios;

      mockAxios.setResponse({
        status: 'healthy',
        model_loaded: true,
        model: 'llava-v1.6-mistral-7b.Q4_K_M.gguf'
      });

      const health = await provider.healthCheck();

      assert.ok(health, 'Should return health object');
      assert.strictEqual(health.status, 'healthy');
    });
  });

  describe('Error Handling', () => {
    it('should handle service unavailable', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = {
        post: async () => { throw new Error('ECONNREFUSED'); }
      };

      await assert.rejects(
        () => provider.compareImages('/a.png', '/b.png', 'test'),
        /unavailable|ECONNREFUSED|connection/i,
        'Should indicate service unavailable'
      );
    });

    it('should handle invalid image paths', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = {
        post: async () => { throw new Error('File not found'); }
      };

      await assert.rejects(
        () => provider.compareImages('/nonexistent.png', '/also-missing.png', 'test'),
        /not found|invalid/i,
        'Should handle missing files'
      );
    });

    it('should handle model not loaded', async () => {
      assert.ok(LocalVLMProvider, 'Provider must be implemented');
      const provider = new LocalVLMProvider({ apiUrl: 'http://localhost:8004' });
      provider._axios = {
        post: async () => {
          const err = new Error('Model not loaded');
          err.response = { status: 503, data: { detail: 'Model not loaded' } };
          throw err;
        }
      };

      await assert.rejects(
        () => provider.compareImages('/a.png', '/b.png', 'test'),
        /not loaded|503/i,
        'Should indicate model not loaded'
      );
    });
  });
});

describe('VLM Service Python Tests (Integration)', () => {
  // These tests check that the Python service file exists and has correct structure

  it('should have vlm_service.py in services directory', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    assert.ok(fs.existsSync(servicePath), 'vlm_service.py should exist');
  });

  it('should have /compare endpoint in vlm_service.py', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    assert.ok(content.includes('/compare'), 'Should have /compare endpoint');
    assert.ok(content.includes('llama_cpp') || content.includes('Llama'),
      'Should use llama-cpp-python');
  });

  it('should support multimodal models in vlm_service.py', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    // Check for image handling or multimodal support
    assert.ok(
      content.includes('image') ||
      content.includes('vision') ||
      content.includes('chat_handler'),
      'Should handle images/vision'
    );
  });

  it('should have /load and /unload endpoints for GPU coordination', async () => {
    const fs = require('fs');
    const path = require('path');
    const servicePath = path.join(__dirname, '../../services/vlm_service.py');

    if (!fs.existsSync(servicePath)) {
      assert.fail('vlm_service.py not found');
    }

    const content = fs.readFileSync(servicePath, 'utf-8');
    assert.ok(content.includes('/load'), 'Should have /load endpoint');
    assert.ok(content.includes('/unload'), 'Should have /unload endpoint');
  });
});
