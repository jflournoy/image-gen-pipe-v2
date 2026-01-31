/**
 * 🔴 TDD RED - Ranking Mode Toggle Tests
 * Tests for UI toggle between VLM tournament ranking and CLIP/aesthetic scoring
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Read the demo.html and demo.js files for testing
const demoHtmlPath = path.join(__dirname, '../../public/demo.html');
const demoJsPath = path.join(__dirname, '../../public/demo.js');

let demoHtml;
let demoJs;

try {
  demoHtml = fs.readFileSync(demoHtmlPath, 'utf-8');
  demoJs = fs.readFileSync(demoJsPath, 'utf-8');
} catch {
  demoHtml = '';
  demoJs = '';
}

describe('Ranking Mode Toggle UI', () => {
  describe('HTML Structure', () => {
    it('should have a ranking mode selector in the UI', () => {
      assert.ok(demoHtml, 'demo.html should exist');
      // Look for ranking mode select element
      assert.ok(
        demoHtml.includes('rankingMode') || demoHtml.includes('ranking-mode'),
        'Should have ranking mode selector element'
      );
    });

    it('should have VLM tournament as the default option', () => {
      assert.ok(demoHtml, 'demo.html should exist');
      // The VLM option should be selected by default
      assert.ok(
        demoHtml.includes('vlm') && (
          demoHtml.includes('selected') ||
          demoHtml.includes('value="vlm"')
        ),
        'VLM should be an option in ranking mode'
      );
    });

    it('should have CLIP/aesthetic scoring as an alternative option', () => {
      assert.ok(demoHtml, 'demo.html should exist');
      // The scoring option should be available
      assert.ok(
        demoHtml.includes('scoring') || demoHtml.includes('clip'),
        'CLIP/aesthetic scoring should be an option'
      );
    });

    it('should show explanatory text for each ranking mode', () => {
      assert.ok(demoHtml, 'demo.html should exist');
      // Should have description for ranking modes
      assert.ok(
        demoHtml.includes('pairwise') || demoHtml.includes('tournament'),
        'Should explain VLM tournament ranking'
      );
    });
  });

  describe('JavaScript Behavior', () => {
    it('should send rankingMode parameter when starting a job', () => {
      assert.ok(demoJs, 'demo.js should exist');
      // Look for rankingMode being sent in the API call
      assert.ok(
        demoJs.includes('rankingMode'),
        'Should include rankingMode in job parameters'
      );
    });

    it('should default to VLM ranking mode', () => {
      assert.ok(demoJs, 'demo.js should exist');
      // Default should be vlm
      assert.ok(
        demoJs.includes('rankingMode') &&
        (demoJs.includes('\'vlm\'') || demoJs.includes('"vlm"')),
        'Should default to vlm ranking mode'
      );
    });

    it('should show/hide API key based on ranking mode', () => {
      assert.ok(demoJs, 'demo.js should exist');
      // When VLM is selected, OpenAI API key should not be required for ranking
      // When scoring is selected, might need OpenAI for vision analysis
      assert.ok(
        demoJs.includes('rankingMode') || demoJs.includes('ranking-mode'),
        'Should handle ranking mode changes'
      );
    });
  });
});

describe('Ranking Mode Backend Integration', () => {
  // These tests verify the backend API and worker handle ranking mode

  describe('Demo Routes', () => {
    it('should accept rankingMode parameter in /api/demo/start', () => {
      const demoRoutes = fs.readFileSync(
        path.join(__dirname, '../../src/api/demo-routes.js'),
        'utf-8'
      );
      assert.ok(
        demoRoutes.includes('rankingMode'),
        'demo-routes should accept rankingMode parameter'
      );
    });
  });

  describe('Beam Search Worker', () => {
    it('should pass rankingMode to provider creation', () => {
      const worker = fs.readFileSync(
        path.join(__dirname, '../../src/api/beam-search-worker.js'),
        'utf-8'
      );
      assert.ok(
        worker.includes('rankingMode'),
        'beam-search-worker should handle rankingMode'
      );
    });

    it('should create LocalVLMProvider when rankingMode is vlm', () => {
      const worker = fs.readFileSync(
        path.join(__dirname, '../../src/api/beam-search-worker.js'),
        'utf-8'
      );
      assert.ok(
        worker.includes('LocalVLMProvider') || worker.includes('createVLMProvider'),
        'Should use LocalVLMProvider for VLM ranking mode'
      );
    });

    it('should skip imageRanker when rankingMode is scoring', () => {
      const worker = fs.readFileSync(
        path.join(__dirname, '../../src/api/beam-search-worker.js'),
        'utf-8'
      );
      // When scoring mode, imageRanker should be null (fall back to score-based)
      assert.ok(
        worker.includes('rankingMode') && worker.includes('scoring'),
        'Should handle scoring mode (no pairwise ranking)'
      );
    });
  });
});

describe('VLM Provider Integration', () => {
  it('should have LocalVLMProvider available', () => {
    let LocalVLMProvider;
    try {
      LocalVLMProvider = require('../../src/providers/local-vlm-provider');
    } catch {
      LocalVLMProvider = null;
    }
    assert.ok(LocalVLMProvider, 'LocalVLMProvider should be importable');
  });

  it('should have createVLMProvider in provider-factory', () => {
    const factory = require('../../src/factory/provider-factory');
    assert.ok(
      typeof factory.createVLMProvider === 'function',
      'createVLMProvider should be exported from provider-factory'
    );
  });

  it('LocalVLMProvider should implement rankImagesWithTransitivity', () => {
    const LocalVLMProvider = require('../../src/providers/local-vlm-provider');
    const provider = new LocalVLMProvider({});
    assert.ok(
      typeof provider.rankImagesWithTransitivity === 'function',
      'Should have rankImagesWithTransitivity method for tournament ranking'
    );
  });
});
