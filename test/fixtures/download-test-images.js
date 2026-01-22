#!/usr/bin/env node
/**
 * Download test images for VLM comparison tests
 *
 * Downloads small images from Unsplash and creates variants for testing.
 * Run once before running GPU tests: node test/fixtures/download-test-images.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, 'images');

// Unsplash source images (small 400px versions)
const IMAGES = {
  'sharp-dog.jpg': 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400&q=80',
  'cat.jpg': 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400&q=80',
  'aesthetic-good.jpg': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
};

/**
 * Download image from URL, following redirects
 */
function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl) => {
      https.get(currentUrl, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download ${currentUrl}: ${response.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          fs.unlink(dest, () => {}); // Delete partial file
          reject(err);
        });
      }).on('error', reject);
    };

    request(url);
  });
}

/**
 * Create blurred version of an image
 */
async function createBlurredVersion(sourcePath, destPath) {
  await sharp(sourcePath)
    .blur(15) // Strong Gaussian blur
    .jpeg({ quality: 60 }) // Lower quality
    .toFile(destPath);
}

/**
 * Create low aesthetic quality version (add noise, reduce quality)
 */
async function createLowAestheticVersion(sourcePath, destPath) {
  // Create a grainy, low-quality version
  await sharp(sourcePath)
    .modulate({ saturation: 0.5 }) // Reduce saturation
    .sharpen({ sigma: 3 }) // Over-sharpen creates artifacts
    .jpeg({ quality: 30 }) // Very low quality
    .toFile(destPath);
}

async function main() {
  console.log('📁 Creating test fixtures directory...');
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  console.log('📥 Downloading test images from Unsplash...');

  for (const [filename, url] of Object.entries(IMAGES)) {
    const dest = path.join(IMAGES_DIR, filename);

    if (fs.existsSync(dest)) {
      console.log(`  ✓ ${filename} already exists, skipping`);
      continue;
    }

    try {
      console.log(`  ↓ Downloading ${filename}...`);
      await downloadImage(url, dest);
      console.log(`  ✓ ${filename} downloaded`);
    } catch (error) {
      console.error(`  ✗ Failed to download ${filename}: ${error.message}`);
      // Create a fallback synthetic image
      console.log(`  → Creating synthetic fallback for ${filename}...`);
      await createSyntheticImage(filename);
    }
  }

  // Create derived images
  console.log('\n🔧 Creating derived test images...');

  const sharpDogPath = path.join(IMAGES_DIR, 'sharp-dog.jpg');
  const blurryDogPath = path.join(IMAGES_DIR, 'blurry-dog.jpg');
  const aestheticGoodPath = path.join(IMAGES_DIR, 'aesthetic-good.jpg');
  const aestheticPoorPath = path.join(IMAGES_DIR, 'aesthetic-poor.jpg');

  if (fs.existsSync(sharpDogPath) && !fs.existsSync(blurryDogPath)) {
    console.log('  → Creating blurry-dog.jpg...');
    await createBlurredVersion(sharpDogPath, blurryDogPath);
    console.log('  ✓ blurry-dog.jpg created');
  }

  if (fs.existsSync(aestheticGoodPath) && !fs.existsSync(aestheticPoorPath)) {
    console.log('  → Creating aesthetic-poor.jpg...');
    await createLowAestheticVersion(aestheticGoodPath, aestheticPoorPath);
    console.log('  ✓ aesthetic-poor.jpg created');
  }

  console.log('\n✅ Test fixtures ready!');
  console.log(`   Location: ${IMAGES_DIR}`);

  // List created files
  const files = fs.readdirSync(IMAGES_DIR);
  console.log(`   Files: ${files.join(', ')}`);
}

/**
 * Create synthetic fallback image if download fails
 */
async function createSyntheticImage(filename) {
  const dest = path.join(IMAGES_DIR, filename);

  // Create simple colored rectangles as fallbacks
  const colors = {
    'sharp-dog.jpg': { r: 139, g: 90, b: 43 }, // Brown (dog-like)
    'cat.jpg': { r: 255, g: 165, b: 0 },       // Orange (cat-like)
    'aesthetic-good.jpg': { r: 70, g: 130, b: 180 }, // Steel blue (sky-like)
  };

  const color = colors[filename] || { r: 128, g: 128, b: 128 };

  await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: color,
    }
  })
  .jpeg({ quality: 90 })
  .toFile(dest);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
