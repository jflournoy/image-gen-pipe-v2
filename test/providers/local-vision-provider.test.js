/**
 * @file Local Vision Provider Tests (TDD RED)
 * Tests for local CLIP + aesthetic scoring vision provider
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const nock = require('nock');
const LocalVisionProvider = require('../../src/providers/local-vision-provider.js');

describe('🔴 RED: LocalVisionProvider', () => {
  const testApiUrl = 'http://localhost:8002';
  let provider;

  before(() => {
    provider = new LocalVisionProvider({
      apiUrl: testApiUrl,
      clipModel: 'openai/clip-vit-base-patch32',
      aestheticModel: 'aesthetic_predictor_v2_5'
    });
  });

  after(() => {
    nock.cleanAll();
  });

  describe('Constructor', () => {
    it('should initialize with API URL and model configuration', () => {
      assert.ok(provider, 'Provider should be instantiated');
      assert.strictEqual(provider.apiUrl, testApiUrl);
      assert.strictEqual(provider.clipModel, 'openai/clip-vit-base-patch32');
      assert.strictEqual(provider.aestheticModel, 'aesthetic_predictor_v2_5');
    });

    it('should use default API URL if not provided', () => {
      const defaultProvider = new LocalVisionProvider({});
      assert.strictEqual(defaultProvider.apiUrl, 'http://localhost:8002');
    });
  });

  describe('analyzeImage', () => {
    it('should analyze image and return alignment + aesthetic scores', async () => {
      const mockResponse = {
        alignmentScore: 85.5,
        aestheticScore: 7.8,
        analysis: 'A vibrant fantasy scene with magical elements',
        strengths: [
          'Strong composition',
          'Vivid colors',
          'Clear subject matter'
        ],
        weaknesses: [
          'Minor perspective issues',
          'Could use more detail in background'
        ]
      };

      nock(testApiUrl)
        .post('/analyze', body => {
          return body.imageUrl === 'https://example.com/test.png' &&
                 body.prompt === 'a magical forest scene';
        })
        .reply(200, mockResponse);

      const result = await provider.analyzeImage(
        'https://example.com/test.png',
        'a magical forest scene'
      );

      assert.strictEqual(result.alignmentScore, 85.5);
      assert.strictEqual(result.aestheticScore, 7.8);
      assert.strictEqual(result.analysis, 'A vibrant fantasy scene with magical elements');
      assert.strictEqual(result.strengths.length, 3);
      assert.strictEqual(result.weaknesses.length, 2);
    });

    it('should support local file paths', async () => {
      const mockResponse = {
        alignmentScore: 90.0,
        aestheticScore: 8.5,
        analysis: 'High quality image',
        strengths: ['Excellent composition'],
        weaknesses: []
      };

      nock(testApiUrl)
        .post('/analyze', body => {
          return body.imagePath === '/local/path/image.png';
        })
        .reply(200, mockResponse);

      const result = await provider.analyzeImage(
        '/local/path/image.png',
        'test prompt'
      );

      assert.strictEqual(result.alignmentScore, 90.0);
    });

    it('should handle API errors gracefully', async () => {
      nock(testApiUrl)
        .post('/analyze')
        .reply(500, { error: 'Internal server error' });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('https://example.com/test.png', 'prompt');
        },
        {
          name: 'Error',
          message: /Failed to analyze image/
        }
      );
    });

    it('should validate alignment score is between 0-100', async () => {
      const mockResponse = {
        alignmentScore: 85.5,
        aestheticScore: 7.8,
        analysis: 'Test analysis',
        strengths: [],
        weaknesses: []
      };

      nock(testApiUrl)
        .post('/analyze')
        .reply(200, mockResponse);

      const result = await provider.analyzeImage(
        'https://example.com/test.png',
        'prompt'
      );

      assert.ok(result.alignmentScore >= 0 && result.alignmentScore <= 100);
    });

    it('should validate aesthetic score is between 0-10', async () => {
      const mockResponse = {
        alignmentScore: 85.5,
        aestheticScore: 7.8,
        analysis: 'Test analysis',
        strengths: [],
        weaknesses: []
      };

      nock(testApiUrl)
        .post('/analyze')
        .reply(200, mockResponse);

      const result = await provider.analyzeImage(
        'https://example.com/test.png',
        'prompt'
      );

      assert.ok(result.aestheticScore >= 0 && result.aestheticScore <= 10);
    });

    it('should support optional parameters', async () => {
      const mockResponse = {
        alignmentScore: 85.5,
        aestheticScore: 7.8,
        analysis: 'Test analysis',
        strengths: [],
        weaknesses: []
      };

      nock(testApiUrl)
        .post('/analyze', body => {
          return body.options && body.options.detailedAnalysis === true;
        })
        .reply(200, mockResponse);

      const result = await provider.analyzeImage(
        'https://example.com/test.png',
        'prompt',
        { detailedAnalysis: true }
      );

      assert.ok(result);
    });
  });

  describe('Health Check', () => {
    it('should provide a health check endpoint', async () => {
      nock(testApiUrl)
        .get('/health')
        .reply(200, { status: 'healthy', models: ['clip', 'aesthetic'] });

      const health = await provider.healthCheck();

      assert.strictEqual(health.status, 'healthy');
      assert.ok(Array.isArray(health.models));
    });

    it('should handle unhealthy service', async () => {
      nock(testApiUrl)
        .get('/health')
        .reply(503, { status: 'unhealthy' });

      await assert.rejects(
        async () => {
          await provider.healthCheck();
        },
        {
          message: /Service unavailable/
        }
      );
    });
  });
});
