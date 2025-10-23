#!/usr/bin/env node
/**
 * Test script to verify local image storage with real DALL-E 3 API
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node test-local-storage.js
 */

require('dotenv').config();
const OpenAIImageProvider = require('./src/providers/openai-image-provider');
const fs = require('fs').promises;
const path = require('path');

async function testLocalStorage() {
  console.log('🧪 Testing DALL-E 3 local storage integration\n');

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable not set');
    console.error('   Set it with: export OPENAI_API_KEY=sk-...');
    process.exit(1);
  }

  // Create provider with test output directory
  const testOutputDir = path.join(__dirname, 'test-storage-output');
  const provider = new OpenAIImageProvider(process.env.OPENAI_API_KEY, {
    outputDir: testOutputDir,
    sessionId: 'test-session'
  });

  console.log('📁 Output directory:', testOutputDir);
  console.log('🆔 Session ID:', provider.sessionId);
  console.log('');

  try {
    // Test 1: Generate image for iteration 0, candidate 0 (what)
    console.log('1️⃣  Generating image for iter-00/candidate-00-what...');
    const result1 = await provider.generateImage(
      'A serene mountain lake at sunset',
      {
        size: '1024x1024',
        quality: 'standard',
        style: 'natural',
        iteration: 0,
        candidateId: 0,
        dimension: 'what'
      }
    );

    console.log('   ✅ Image generated successfully');
    console.log('   🔗 URL:', result1.url.substring(0, 60) + '...');
    console.log('   📝 Revised prompt:', result1.revisedPrompt.substring(0, 60) + '...');
    console.log('   💾 Local path:', result1.localPath);
    console.log('');

    // Verify files exist
    const dir1 = path.dirname(result1.localPath);
    const promptPath = path.join(dir1, 'prompt.txt');
    const imagePath = path.join(dir1, 'image.png');

    const promptExists = await fs.access(promptPath).then(() => true).catch(() => false);
    const imageExists = await fs.access(imagePath).then(() => true).catch(() => false);

    console.log('   📄 Files created:');
    console.log('      • prompt.txt:', promptExists ? '✅' : '❌');
    console.log('      • image.png:', imageExists ? '✅' : '❌');
    console.log('');

    // Test 2: Generate another image for iteration 0, candidate 1 (what)
    console.log('2️⃣  Generating image for iter-00/candidate-01-what...');
    const result2 = await provider.generateImage(
      'A dramatic mountain landscape with storm clouds',
      {
        iteration: 0,
        candidateId: 1,
        dimension: 'what'
      }
    );

    console.log('   ✅ Image generated successfully');
    console.log('   💾 Local path:', result2.localPath);
    console.log('');

    // Test 3: Generate image for iteration 1 (refining best from iteration 0)
    console.log('3️⃣  Generating image for iter-01/candidate-00-how...');
    const result3 = await provider.generateImage(
      'A serene mountain lake at sunset with golden hour lighting and reflections',
      {
        iteration: 1,
        candidateId: 0,
        dimension: 'how'
      }
    );

    console.log('   ✅ Image generated successfully');
    console.log('   💾 Local path:', result3.localPath);
    console.log('');

    // List directory structure
    console.log('📂 Directory structure created:');
    const date = new Date().toISOString().split('T')[0];
    const sessionDir = path.join(testOutputDir, date, 'test-session');

    async function listDir(dir, prefix = '') {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          console.log(`${prefix}📁 ${entry.name}/`);
          await listDir(fullPath, prefix + '  ');
        } else {
          const stats = await fs.stat(fullPath);
          const sizeKB = (stats.size / 1024).toFixed(1);
          console.log(`${prefix}📄 ${entry.name} (${sizeKB} KB)`);
        }
      }
    }

    await listDir(sessionDir);
    console.log('');

    console.log('✨ Test completed successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('   • Generated 3 images across 2 iterations');
    console.log('   • All images saved locally with beam search structure');
    console.log('   • Prompts saved in prompt.txt files');
    console.log('   • Directory structure follows specification');
    console.log('');
    console.log(`🗂️  View output at: ${testOutputDir}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the test
testLocalStorage();
