#!/usr/bin/env python3
"""
Test GFPGAN color preservation with quantitative metrics
Generates images via BFL API, then applies face fixing locally
Measures color tone shifts between original and enhanced images
"""

import requests
import json
import os
import time
import base64
from pathlib import Path
import numpy as np
from PIL import Image
import sys

# Load .env file
try:
    from dotenv import load_dotenv
    # Load from project root .env
    project_root = Path(__file__).parent.parent.parent
    env_path = project_root / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✓ Loaded environment from {env_path}")
except ImportError:
    print("⚠ python-dotenv not installed, using environment variables only")
    print("  Install with: pip install python-dotenv")

# Add services to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'services'))
from face_fixing import FaceFixingPipeline

# Configuration
BFL_API_KEY = os.environ.get('BFL_API_KEY')
BFL_API_URL = os.environ.get('BFL_API_URL', 'https://api.bfl.ai')
BFL_MODEL = os.environ.get('BFL_MODEL', 'flux-dev')  # Free tier model
OUTPUT_DIR = Path("/tmp/gfpgan_color_test")
OUTPUT_DIR.mkdir(exist_ok=True)

if not BFL_API_KEY:
    print("❌ Error: BFL_API_KEY not set")
    print("   Add to .env file: BFL_API_KEY=your-api-key")
    print("   Or set environment variable: export BFL_API_KEY='your-api-key'")
    sys.exit(1)

def rgb_to_lab(rgb):
    """Convert RGB to LAB color space for perceptual color difference"""
    # Normalize to 0-1
    rgb = rgb.astype(np.float32) / 255.0

    # RGB to XYZ (assuming sRGB)
    mask = rgb > 0.04045
    rgb[mask] = np.power((rgb[mask] + 0.055) / 1.055, 2.4)
    rgb[~mask] = rgb[~mask] / 12.92

    # XYZ matrix for sRGB
    xyz = np.dot(rgb, [[0.4124564, 0.3575761, 0.1804375],
                       [0.2126729, 0.7151522, 0.0721750],
                       [0.0193339, 0.1191920, 0.9503041]])

    # XYZ to LAB
    xyz = xyz / [0.95047, 1.0, 1.08883]  # D65 illuminant
    mask = xyz > 0.008856
    xyz[mask] = np.power(xyz[mask], 1/3)
    xyz[~mask] = (7.787 * xyz[~mask]) + (16/116)

    l = (116 * xyz[..., 1]) - 16
    a = 500 * (xyz[..., 0] - xyz[..., 1])
    b = 200 * (xyz[..., 1] - xyz[..., 2])

    return np.stack([l, a, b], axis=-1)

def calculate_color_metrics(img_before, img_after):
    """Calculate color difference metrics between two images"""
    # Convert to numpy arrays
    before = np.array(img_before)
    after = np.array(img_after)

    # Convert to LAB
    lab_before = rgb_to_lab(before)
    lab_after = rgb_to_lab(after)

    # Calculate Delta E (CIE76) - perceptual color difference
    delta_e = np.sqrt(np.sum((lab_before - lab_after) ** 2, axis=-1))
    mean_delta_e = np.mean(delta_e)
    max_delta_e = np.max(delta_e)

    # Calculate RGB differences for reference
    rgb_diff = np.abs(before.astype(float) - after.astype(float))
    mean_rgb_diff = np.mean(rgb_diff)

    # Calculate per-channel differences
    r_diff = np.mean(np.abs(before[:,:,0].astype(float) - after[:,:,0].astype(float)))
    g_diff = np.mean(np.abs(before[:,:,1].astype(float) - after[:,:,1].astype(float)))
    b_diff = np.mean(np.abs(before[:,:,2].astype(float) - after[:,:,2].astype(float)))

    return {
        'delta_e_mean': mean_delta_e,
        'delta_e_max': max_delta_e,
        'rgb_diff_mean': mean_rgb_diff,
        'r_diff': r_diff,
        'g_diff': g_diff,
        'b_diff': b_diff,
    }

def generate_via_bfl(prompt, seed=42):
    """Generate image via BFL API and return PIL Image"""
    print("  Generating via BFL API...")

    # Submit generation request
    payload = {
        "prompt": prompt,
        "width": 1024,
        "height": 1024,
        "prompt_upsampling": False,
        "seed": seed,
        "safety_tolerance": 5,  # Max allowed by BFL API
    }

    headers = {
        "Content-Type": "application/json",
        "X-Key": BFL_API_KEY,
    }

    # Submit job
    response = requests.post(
        f"{BFL_API_URL}/v1/{BFL_MODEL}",
        json=payload,
        headers=headers,
        timeout=30
    )

    if response.status_code != 200:
        print(f"  ✗ BFL submission failed: {response.status_code} - {response.text}")
        return None

    data = response.json()
    task_id = data.get('id')
    polling_url = data.get('polling_url')

    if not task_id or not polling_url:
        print(f"  ✗ Invalid response: {data}")
        return None

    print(f"  Task ID: {task_id}")
    print(f"  Polling URL: {polling_url}")

    # Poll for result using the polling_url from response
    max_wait = 300  # 5 minutes
    poll_interval = 2
    elapsed = 0

    while elapsed < max_wait:
        time.sleep(poll_interval)
        elapsed += poll_interval

        result_response = requests.get(
            polling_url,
            headers=headers,
            timeout=10
        )

        if result_response.status_code != 200:
            print(f"  ✗ Poll failed: {result_response.status_code}")
            continue

        result = result_response.json()
        status = result.get('status')

        if status == 'Ready':
            image_url = result['result']['sample']
            print(f"  ✓ Image ready, downloading...")

            # Download image
            img_response = requests.get(image_url, timeout=30)
            if img_response.status_code != 200:
                print(f"  ✗ Download failed: {img_response.status_code}")
                return None

            # Load image
            from io import BytesIO
            img = Image.open(BytesIO(img_response.content))
            print(f"  ✓ Image downloaded ({img.size})")
            return img

        elif status == 'Error':
            print(f"  ✗ Generation error: {result}")
            return None

        elif status in ['Pending', 'Request Moderated']:
            print(f"  ⏳ Status: {status} (waited {elapsed}s)")
        else:
            print(f"  ? Unknown status: {status}")

    print(f"  ✗ Timeout after {max_wait}s")
    return None


def apply_face_fixing(img_baseline, weight_value, gfpgan_arch='clean', preserve_color=True, color_method='ycbcr'):
    """Apply face fixing to image and return enhanced image"""
    print(f"  Applying face fixing (weight={weight_value}, arch={gfpgan_arch}, preserve_color={preserve_color}, method={color_method})...")

    # Initialize face fixing pipeline
    device = 'cuda' if os.environ.get('CUDA_VISIBLE_DEVICES') else 'cpu'
    pipeline = FaceFixingPipeline(device=device)

    # Temporarily set color correction method on pipeline
    if preserve_color and hasattr(pipeline, '_current_color_method'):
        pipeline._current_color_method = color_method
    elif preserve_color:
        # Store method for the correction function to use
        os.environ['GFPGAN_COLOR_METHOD'] = color_method

    # Apply face fixing
    img_fixed, metadata = pipeline.fix_faces(
        img_baseline,
        fidelity=weight_value,
        upscale=1,
        gfpgan_arch=gfpgan_arch,
        gfpgan_preserve_color=preserve_color
    )

    print(f"  ✓ Face fixing applied: {metadata}")
    return img_fixed, metadata


def generate_image_pair(weight_value, test_label, prompt, seed=42, gfpgan_arch='clean', preserve_color=True, baseline_image=None, color_method='ycbcr'):
    """Generate before/after pair with quantitative comparison"""

    print(f"\n{'='*70}")
    print(f"Testing: {test_label} (weight={weight_value}, method={color_method if preserve_color else 'none'})")
    print(f"{'='*70}")

    # Use cached baseline or generate new one
    if baseline_image is None:
        print("  Generating baseline via BFL API...")
        img_baseline = generate_via_bfl(prompt, seed)
        if img_baseline is None:
            return None
    else:
        print("  Using cached baseline image")
        img_baseline = baseline_image

    baseline_path = OUTPUT_DIR / f"{test_label}_baseline.png"
    img_baseline.save(baseline_path)
    print(f"  ✓ Baseline saved: {baseline_path}")

    # Apply face fixing
    img_fixed, ff_metadata = apply_face_fixing(img_baseline, weight_value, gfpgan_arch, preserve_color, color_method=color_method)

    fixed_path = OUTPUT_DIR / f"{test_label}_fixed_w{weight_value}.png"
    img_fixed.save(fixed_path)
    print(f"  ✓ Face-fixed saved: {fixed_path}")

    # Calculate color metrics
    metrics = calculate_color_metrics(img_baseline, img_fixed)

    # Print metrics
    print(f"\n  📊 Color Difference Metrics:")
    print(f"     Delta E (mean):  {metrics['delta_e_mean']:.2f} (lower = better color preservation)")
    print(f"     Delta E (max):   {metrics['delta_e_max']:.2f}")
    print(f"     RGB diff (mean): {metrics['rgb_diff_mean']:.2f}")
    print(f"     R channel diff:  {metrics['r_diff']:.2f}")
    print(f"     G channel diff:  {metrics['g_diff']:.2f}")
    print(f"     B channel diff:  {metrics['b_diff']:.2f}")

    # Create side-by-side comparison
    # Resize if needed to fit side-by-side (max 2048 total width)
    width, height = img_baseline.size
    if width > 1024:
        # Resize to fit
        scale = 1024 / width
        new_width = int(width * scale)
        new_height = int(height * scale)
        img_baseline = img_baseline.resize((new_width, new_height), Image.Resampling.LANCZOS)
        img_fixed = img_fixed.resize((new_width, new_height), Image.Resampling.LANCZOS)
        width, height = new_width, new_height

    comparison = Image.new('RGB', (width * 2, height))
    comparison.paste(img_baseline, (0, 0))
    comparison.paste(img_fixed, (width, 0))
    comparison_path = OUTPUT_DIR / f"{test_label}_comparison_w{weight_value}.png"
    comparison.save(comparison_path)
    print(f"  ✓ Comparison saved: {comparison_path}")

    return {
        'weight': weight_value,
        'label': test_label,
        'metrics': metrics,
        'faces_detected': ff_metadata.get('faces_count', 0),
        'processing_time': ff_metadata.get('time', 0),
        'baseline_path': baseline_path,
        'fixed_path': fixed_path,
        'comparison_path': comparison_path,
        'baseline_image': img_baseline,  # Cache for reuse
    }

def main():
    print("\n🎨 GFPGAN COLOR PRESERVATION TEST")
    print("="*70)
    print("Testing color tone preservation with quantitative metrics")
    print("Using Delta E (LAB color space) for perceptually accurate measurement")
    is_free = 'dev' in BFL_MODEL.lower()
    tier = "(free tier)" if is_free else "(paid tier)"
    print(f"BFL Model: {BFL_MODEL} {tier}")
    print(f"Output directory: {OUTPUT_DIR}")
    print("="*70)

    prompt = "professional headshot of a woman, warm skin tones, natural lighting, clear face, detailed facial features, photorealistic portrait"
    seed = 42  # Fixed seed for consistency

    # Generate baseline image once via BFL API
    print("\n📸 Generating baseline image via BFL API...")
    baseline_image = generate_via_bfl(prompt, seed)
    if baseline_image is None:
        print("❌ Failed to generate baseline image, aborting")
        return

    # Test different configurations (weight, arch, preserve_color, label)
    # Compare: no correction, YCbCr chrominance transfer, LAB histogram matching
    configs_to_test = [
        (0.5, 'clean', False, "without_color_correction"),
        (0.5, 'clean', True, "ycbcr_chrominance_transfer"),
        (0.5, 'clean', True, "lab_histogram_matching"),
    ]

    results = []
    for weight, arch, preserve_color, label in configs_to_test:
        # Determine color method from label
        if 'ycbcr' in label:
            color_method = 'ycbcr'
        elif 'lab' in label:
            color_method = 'lab'
        else:
            color_method = 'ycbcr'  # default

        result = generate_image_pair(
            weight, label, prompt, seed, arch, preserve_color,
            baseline_image=baseline_image, color_method=color_method
        )
        if result:
            results.append(result)

    # Print summary report
    print("\n" + "="*70)
    print("📋 SUMMARY REPORT")
    print("="*70)
    print("\nDelta E Reference:")
    print("  < 1.0  = Imperceptible difference")
    print("  1-2    = Perceptible with close observation")
    print("  2-10   = Perceptible at a glance")
    print("  > 10   = Colors look different")
    print()

    # Sort by Delta E (lower is better for color preservation)
    results_sorted = sorted(results, key=lambda x: x['metrics']['delta_e_mean'])

    print(f"{'Weight':<8} {'Delta E':<10} {'RGB Diff':<10} {'Faces':<8} {'Time':<8} {'Label'}")
    print("-" * 70)
    for r in results_sorted:
        print(f"{r['weight']:<8.1f} "
              f"{r['metrics']['delta_e_mean']:<10.2f} "
              f"{r['metrics']['rgb_diff_mean']:<10.2f} "
              f"{r['faces_detected']:<8} "
              f"{r['processing_time']:<8.2f} "
              f"{r['label']}")

    print("\n💡 Recommendations:")
    best = results_sorted[0]
    print(f"   Best color preservation: weight={best['weight']} (Delta E: {best['metrics']['delta_e_mean']:.2f})")
    print(f"\n   View comparisons in: {OUTPUT_DIR}")
    print(f"   Files named: *_comparison_w*.png (left=before, right=after)")

    # Save detailed report
    report_path = OUTPUT_DIR / "report.txt"
    with open(report_path, 'w') as f:
        f.write("GFPGAN Color Preservation Test Report\n")
        f.write("="*70 + "\n\n")
        for r in results_sorted:
            f.write(f"Weight: {r['weight']}\n")
            f.write(f"Label: {r['label']}\n")
            f.write(f"Delta E (mean): {r['metrics']['delta_e_mean']:.2f}\n")
            f.write(f"Delta E (max): {r['metrics']['delta_e_max']:.2f}\n")
            f.write(f"RGB diff (mean): {r['metrics']['rgb_diff_mean']:.2f}\n")
            f.write(f"R diff: {r['metrics']['r_diff']:.2f}\n")
            f.write(f"G diff: {r['metrics']['g_diff']:.2f}\n")
            f.write(f"B diff: {r['metrics']['b_diff']:.2f}\n")
            f.write(f"Faces detected: {r['faces_detected']}\n")
            f.write(f"Processing time: {r['processing_time']:.2f}s\n")
            f.write("\n")

    print(f"\n   Detailed report saved: {report_path}")

if __name__ == "__main__":
    main()
