/**
 * WAN Video Generation Example
 *
 * Demonstrates how to use the Modal video provider to generate videos from images
 */

const fs = require('fs');
const { createVideoProvider } = require('../src/factory/provider-factory');

async function generateVideoFromImage() {
  try {
    // Create video provider
    const videoProvider = createVideoProvider({
      provider: 'modal',
      // Uses config defaults, can override:
      // apiUrl: 'https://your-app--generate-video.modal.run',
      // tokenId: process.env.MODAL_TOKEN_ID,
      // tokenSecret: process.env.MODAL_TOKEN_SECRET,
      sessionId: 'example-session',
      outputDir: 'output/videos'
    });

    // Example 1: Simple video generation
    console.log('📹 Generating video from image...');

    // Load an image (could come from beam search results, etc)
    const imagePath = 'output/example-image.png';
    if (!fs.existsSync(imagePath)) {
      console.log(`⚠️  Example image not found at ${imagePath}`);
      console.log('   Please provide an input image to generate from.');
      return;
    }

    const imageBuffer = fs.readFileSync(imagePath);

    // Generate video with motion prompt
    const result = await videoProvider.generateVideo(
      imageBuffer,
      'a gentle camera pan across a serene landscape',
      {
        steps: 30,
        guidance: 4.0,
        fps: 24,
        num_frames: 97,
        seed: 42,
        iteration: 0,
        candidateId: 0
      }
    );

    console.log('✅ Video generated successfully!');
    console.log(`📁 Saved to: ${result.videoPath}`);
    console.log(`⏱️  Duration: ${result.metadata.duration_seconds.toFixed(1)}s`);
    console.log(`🚀 Generation time: ${result.metadata.inference_time.toFixed(1)}s`);
    console.log('📊 Metadata:', result.metadata);

    // Example 2: Generate multiple videos with different prompts
    console.log('\n📹 Generating multiple videos with different prompts...');

    const prompts = [
      'slow zoom out revealing a mountain landscape',
      'gentle fade with a color shift from warm to cool tones',
      'subtle camera tilt revealing details'
    ];

    for (let i = 0; i < prompts.length; i++) {
      console.log(`  [${i + 1}/${prompts.length}] Generating: "${prompts[i]}"`);

      const videoResult = await videoProvider.generateVideo(
        imageBuffer,
        prompts[i],
        {
          steps: 25,
          guidance: 3.5,
          fps: 24,
          num_frames: 50,  // Shorter for faster generation
          iteration: 1,
          candidateId: i
        }
      );

      console.log(`    ✅ Saved to: ${videoResult.videoPath}`);
    }

    // Example 3: Health check
    console.log('\n🏥 Checking service health...');
    const health = await videoProvider.healthCheck();
    console.log(`Status: ${health.status}`);
    console.log(`Model: ${health.model}`);
    console.log(`GPU: ${health.gpu}`);
    console.log(`Ready: ${health.container_ready}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run example
if (require.main === module) {
  generateVideoFromImage();
}

module.exports = { generateVideoFromImage };
