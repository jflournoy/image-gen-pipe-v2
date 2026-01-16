/**
 * Test: CustomModel Model with Local Flux .1 Dev Encoders
 *
 * Validates that:
 * 1. Encoder files exist at expected paths
 * 2. Environment variables can be configured for local encoders
 * 3. Flux service can be started with these encoders
 * 4. Model generates images without shape mismatches
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const test = require('node:test');
const { spawn } = require('child_process');
const http = require('http');

const projectRoot = path.join(__dirname, '..');
const checkpointsDir = path.join(projectRoot, 'services/checkpoints');
const encodersDir = path.join(projectRoot, 'services/encoders');

/**
 * Helper: Wait for HTTP endpoint to be healthy
 */
async function waitForHealthy(port, maxAttempts = 60, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Health check returned ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(2000, () => reject(new Error('Health check timeout')));
      });
      return true;
    } catch {
      if (i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw new Error(`Service did not become healthy after ${maxAttempts * delayMs}ms`);
}

/**
 * Helper: Send HTTP request (GET or POST)
 */
async function httpRequest(port, path, data = null, method = 'GET') {
  return new Promise((resolve, reject) => {
    const isPost = method === 'POST';
    const postData = isPost ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(isPost && { 'Content-Length': Buffer.byteLength(postData) }),
      },
      timeout: 120000, // 2 minute timeout for generation
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', reject);
    if (isPost) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Helper: Spawn service process
 */
function spawnService(servicePath, env) {
  // Run from project root with full path to service to avoid uv trying to build services package
  const fullServicePath = path.join(projectRoot, servicePath);
  return spawn('uv', ['run', 'python3', fullServicePath], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
  });
}

test('🔴 RED: CustomModel Model with Local Flux .1 Dev Encoders', async (t) => {
  await t.test('Encoder Files Exist', async (t) => {
    await t.test('T5-XXL FP8 encoder file exists', () => {
      // T5-XXL renamed to model.safetensors for transformers compatibility
      const t5Path = path.join(encodersDir, 'model.safetensors');
      assert.strictEqual(fs.existsSync(t5Path), true, `T5-XXL encoder not found at ${t5Path}`);
    });

    await t.test('CLIP-L encoder file exists', () => {
      const clipPath = path.join(encodersDir, 'clip_l.safetensors');
      assert.strictEqual(fs.existsSync(clipPath), true, `CLIP-L encoder not found at ${clipPath}`);
    });

    await t.test('CustomModel checkpoint file exists', () => {
      const modelPath = path.join(checkpointsDir, 'flux-dev-fp8.safetensors');
      assert.strictEqual(fs.existsSync(modelPath), true, `CustomModel model not found at ${modelPath}`);
    });
  });

  await t.test('Environment Configuration', async (t) => {
    await t.test('Can configure environment for local encoders', () => {
      const envConfig = {
        FLUX_MODEL_PATH: path.join(checkpointsDir, 'flux-dev-fp8.safetensors'),
        FLUX_TEXT_ENCODER_PATH: path.join(encodersDir, 'clip_l.safetensors'),
        FLUX_TEXT_ENCODER_2_PATH: path.join(encodersDir, 'model.safetensors'),  // T5-XXL renamed for transformers compatibility
      };

      // Verify all paths are absolute and exist
      Object.entries(envConfig).forEach(([key, filePath]) => {
        assert.strictEqual(path.isAbsolute(filePath), true, `${key} is not absolute: ${filePath}`);
        assert.strictEqual(fs.existsSync(filePath), true, `${key} file does not exist: ${filePath}`);
      });
    });
  });

  await t.test('🟢 GREEN: Automated Integration Test - Image Generation', async (t) => {
    const fluxPort = 8001;
    let fluxProcess = null;
    let logs = { stdout: '', stderr: '' };
    let serviceStartFailed = false;
    let serviceStartError = '';

    // Setup: Start Flux service with local encoders
    await t.test('Start Flux service with local encoders', async () => {
      const env = {
        FLUX_MODEL_PATH: path.join(checkpointsDir, 'flux-dev-fp8.safetensors'),
        FLUX_TEXT_ENCODER_PATH: path.join(encodersDir, 'clip_l.safetensors'),
        FLUX_TEXT_ENCODER_2_PATH: path.join(encodersDir, 'model.safetensors'),  // T5-XXL renamed for transformers compatibility
        FLUX_PORT: fluxPort.toString(),
      };

      fluxProcess = spawnService('services/flux_service.py', env);

      // Capture logs for debugging
      fluxProcess.stdout.on('data', (data) => {
        logs.stdout += data.toString();
      });
      fluxProcess.stderr.on('data', (data) => {
        logs.stderr += data.toString();
      });

      // Wait for service to start
      try {
        await waitForHealthy(fluxPort, 120, 1000); // 2 minute timeout
        assert.strictEqual(true, true);
      } catch (error) {
        serviceStartFailed = true;
        serviceStartError = error.message;

        // Check if this is a missing dependency (uvicorn, torch, etc.)
        if (logs.stderr.includes('ModuleNotFoundError') || logs.stderr.includes('ImportError')) {
          const missingModule = logs.stderr.match(/ModuleNotFoundError: No module named ['\"]([^'\"]+)['\"]/)?.[1] || 'unknown';
          console.log(`\n⚠️  Flux service requires Python dependencies to run integration tests`);
          console.log(`Missing module: ${missingModule}`);
          console.log(`\nTo run integration tests manually, install service dependencies:`);
          console.log(`  cd services && pip install -r requirements.txt\n`);
        } else {
          console.log('Service logs:', logs.stdout);
          console.log('Service errors:', logs.stderr);
        }

        // Skip remaining tests with helpful message
        throw error;
      }
    });

    // Skip generation tests if service failed to start
    if (!serviceStartFailed) {
      // Test 1: Health check
      await t.test('Service health check passes', async () => {
        const response = await httpRequest(fluxPort, '/health', null, 'GET');
        assert.strictEqual(response.status, 200, `Health check failed with status ${response.status}`);
      });

      // Test 2: Generate image with minimal steps
      await t.test('Generates image without shape mismatch errors', async () => {
        const response = await httpRequest(fluxPort, '/generate', {
          model: path.join(checkpointsDir, 'flux-dev-fp8.safetensors'),
          prompt: 'a simple test image',
          height: 512,
          width: 512,
          steps: 1,
          guidance: 3.5,
        }, 'POST');

        if (response.status !== 200) {
          console.log('\n=== SERVICE STARTUP LOGS ===');
          console.log(logs.stdout);
          console.log('\n=== SERVICE ERROR LOGS ===');
          console.log(logs.stderr);
        }

        assert.strictEqual(
          response.status,
          200,
          `Generation failed with status ${response.status}: ${JSON.stringify(response.data)}`
        );

        // Check response has image data (localPath, base64, or raw)
        const hasImageData =
          response.data.localPath || response.data.image || response.data.image_base64 || response.data.image_data || response.data.images;

        assert.strictEqual(
          !!hasImageData,
          true,
          `Response missing image data. Got: ${JSON.stringify(response.data).substring(0, 200)}`
        );

        // Verify no shape mismatch error in logs
        assert.strictEqual(
          logs.stderr.includes('mat1 and mat2 shapes cannot be multiplied'),
          false,
          'Shape mismatch error detected in service logs'
        );
      });
    }

    // Cleanup: Stop service
    await t.test('Cleanup: Stop Flux service', async () => {
      if (fluxProcess) {
        await new Promise((resolve) => {
          fluxProcess.kill('SIGTERM');
          setTimeout(resolve, 2000); // Wait for graceful shutdown
        });
      }
      assert.strictEqual(true, true);
    });
  });
});
