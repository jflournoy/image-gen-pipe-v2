/**
 * Tests for applyTwoStageRefinement() helper in beam-search.js
 *
 * The two-stage cartoon→photoreal technique:
 *   Stage 1: generate with stylized/cartoon model (fast, good composition)
 *   Stage 2: resample via img2img at ~0.6 denoise (shifts to photoreal, preserves structure)
 *
 * TDD RED phase: tests are written before implementation.
 * These tests will FAIL until applyTwoStageRefinement is added to beam-search.js
 * and exported in module.exports.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// applyTwoStageRefinement must be exported from beam-search.js.
// In RED phase this will be undefined → tests fail.
const { applyTwoStageRefinement } = require('../../src/orchestrator/beam-search.js');

// ---- Helpers ----

function makeTempImage(content = 'fake PNG data') {
  const tmpPath = path.join(os.tmpdir(), `two-stage-test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(tmpPath, Buffer.from(content));
  return tmpPath;
}

function makeMockProvider(result = null) {
  const calls = [];
  const provider = {
    generateImage: async (prompt, options) => {
      calls.push({ prompt, options });
      if (result instanceof Error) throw result;
      return result || {
        localPath: makeTempImage('fake refined image'),
        metadata: { model: options.model || 'sdxl-base', seed: 99 }
      };
    },
    _calls: calls
  };
  return provider;
}

// ---- Tests ----

test('applyTwoStageRefinement', async (t) => {

  await t.test('is exported from beam-search.js', () => {
    assert.strictEqual(
      typeof applyTwoStageRefinement,
      'function',
      'applyTwoStageRefinement must be a function exported from beam-search.js'
    );
  });

  await t.test('returns original image when twoStageOptions is not provided', async () => {
    const image = { localPath: '/tmp/some-image.png', metadata: { model: 'anime' } };
    const provider = makeMockProvider();

    const result = await applyTwoStageRefinement(image, 'test prompt', provider, undefined, {});

    assert.strictEqual(result, image, 'Should return original image unchanged');
    assert.strictEqual(provider._calls.length, 0, 'Should not call generateImage');
  });

  await t.test('returns original image when twoStageOptions.enabled is false', async () => {
    const image = { localPath: '/tmp/some-image.png', metadata: { model: 'anime' } };
    const provider = makeMockProvider();

    const result = await applyTwoStageRefinement(
      image, 'test prompt', provider,
      { enabled: false, stageTwoModel: 'sdxl-base', denoiseStrength: 0.6 },
      {}
    );

    assert.strictEqual(result, image, 'Should return original image unchanged');
    assert.strictEqual(provider._calls.length, 0, 'Should not call generateImage');
  });

  await t.test('returns original image when image has no localPath', async () => {
    const image = { url: 'https://cdn.example.com/image.png', metadata: { model: 'anime' } };
    const provider = makeMockProvider();

    const result = await applyTwoStageRefinement(
      image, 'test prompt', provider,
      { enabled: true, stageTwoModel: 'sdxl-base', denoiseStrength: 0.6 },
      {}
    );

    assert.strictEqual(result, image, 'Should return original image unchanged when no localPath');
    assert.strictEqual(provider._calls.length, 0, 'Should not call generateImage when no localPath');
  });

  await t.test('reads localPath file and calls generateImage with inputImage when enabled', async () => {
    const tmpPath = makeTempImage('stage one PNG content');
    const image = { localPath: tmpPath, metadata: { model: 'anime-cartoon' } };
    const provider = makeMockProvider();

    const result = await applyTwoStageRefinement(
      image,
      'photorealistic portrait, studio lighting',
      provider,
      { enabled: true, stageTwoModel: 'sdxl-base', denoiseStrength: 0.6, steps: 20, guidance: 7.5 },
      { sessionId: 'test-session', iteration: 1, candidateId: 0 }
    );

    // Should have called generateImage
    assert.strictEqual(provider._calls.length, 1, 'Should call generateImage once');

    const call = provider._calls[0];
    assert.strictEqual(call.prompt, 'photorealistic portrait, studio lighting', 'Should pass the prompt through');

    // inputImage should be the base64-encoded content of the stage-1 file
    assert.ok(call.options.inputImage, 'Should pass inputImage option');
    const expectedBase64 = Buffer.from('stage one PNG content').toString('base64');
    assert.strictEqual(call.options.inputImage, expectedBase64, 'inputImage should be base64 of the stage-1 file');

    // denoiseStrength should be forwarded
    assert.strictEqual(call.options.denoiseStrength, 0.6, 'Should pass denoiseStrength');

    // model should be stageTwoModel
    assert.strictEqual(call.options.model, 'sdxl-base', 'Should use stageTwoModel');

    // Should return the refined image (not the original)
    assert.notStrictEqual(result, image, 'Should return refined image, not original');
    assert.ok(result.localPath, 'Refined result should have a localPath');

    fs.unlinkSync(tmpPath);
  });

  await t.test('uses default denoiseStrength of 0.6 when not specified', async () => {
    const tmpPath = makeTempImage('PNG data');
    const image = { localPath: tmpPath, metadata: {} };
    const provider = makeMockProvider();

    await applyTwoStageRefinement(
      image, 'test', provider,
      { enabled: true, stageTwoModel: 'sdxl-base' /* denoiseStrength omitted */ },
      {}
    );

    assert.strictEqual(provider._calls[0].options.denoiseStrength, 0.6, 'Should default denoiseStrength to 0.6');
    fs.unlinkSync(tmpPath);
  });

  await t.test('attaches twoStage metadata to the refined image result', async () => {
    const tmpPath = makeTempImage('PNG data');
    const image = { localPath: tmpPath, metadata: { model: 'cartoon' } };
    const provider = makeMockProvider({
      localPath: '/tmp/refined.png',
      metadata: { model: 'sdxl-base', seed: 42 }
    });

    const result = await applyTwoStageRefinement(
      image, 'test prompt', provider,
      { enabled: true, stageTwoModel: 'sdxl-base', denoiseStrength: 0.6 },
      {}
    );

    assert.ok(result.metadata, 'Result should have metadata');
    assert.ok(result.metadata.twoStage, 'Result metadata should include twoStage key');
    assert.strictEqual(
      result.metadata.twoStage.stageOneLocalPath,
      tmpPath,
      'twoStage metadata should record the stage-1 image path'
    );
    assert.strictEqual(
      result.metadata.twoStage.model,
      'sdxl-base',
      'twoStage metadata should record the stage-2 model'
    );

    fs.unlinkSync(tmpPath);
  });

  await t.test('forwards steps and guidance from twoStageOptions', async () => {
    const tmpPath = makeTempImage('PNG data');
    const image = { localPath: tmpPath, metadata: {} };
    const provider = makeMockProvider();

    await applyTwoStageRefinement(
      image, 'test', provider,
      { enabled: true, stageTwoModel: 'sdxl-base', denoiseStrength: 0.7, steps: 30, guidance: 8.0 },
      {}
    );

    const call = provider._calls[0];
    assert.strictEqual(call.options.steps, 30, 'Should forward steps');
    assert.strictEqual(call.options.guidance, 8.0, 'Should forward guidance');

    fs.unlinkSync(tmpPath);
  });
});
