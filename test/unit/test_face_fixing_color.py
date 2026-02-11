#!/usr/bin/env python3
"""
Unit tests for face fixing color correction

TDD RED PHASE: Tests for improved LAB color correction with skin-region weighting
"""

import pytest
import numpy as np
from PIL import Image
import sys
from pathlib import Path

# Add services to path for importing
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'services'))

from face_fixing import FaceFixingPipeline


class TestColorCorrection:
    """Test color correction methods in face fixing pipeline"""

    def test_correct_color_tone_exists(self):
        """Test that _correct_color_tone method exists"""
        pipeline = FaceFixingPipeline(device='cpu')
        assert hasattr(pipeline, '_correct_color_tone')
        assert callable(pipeline._correct_color_tone)

    def test_correct_color_tone_preserves_dimensions(self):
        """Test that color correction preserves image dimensions"""
        pipeline = FaceFixingPipeline(device='cpu')

        # Create test images (BGR format)
        source = np.random.randint(0, 256, (100, 100, 3), dtype=np.uint8)
        target = np.random.randint(0, 256, (100, 100, 3), dtype=np.uint8)

        result = pipeline._correct_color_tone(source, target)

        assert result.shape == source.shape
        assert result.dtype == np.uint8

    def test_improved_color_correction_reduces_color_drift(self):
        """
        🔴 TDD RED: Improved method should reduce color drift vs naive approach

        This test will FAIL until we implement the improved LAB method with
        skin-region weighting.
        """
        pipeline = FaceFixingPipeline(device='cpu')

        # Create source image with warm skin tones (realistic face colors)
        # Typical skin tone RGB ranges: R=190-230, G=150-200, B=130-180
        height, width = 100, 100
        source = np.zeros((height, width, 3), dtype=np.uint8)
        source[:, :, 0] = 140  # B channel (BGR format)
        source[:, :, 1] = 170  # G channel
        source[:, :, 2] = 210  # R channel (warm)

        # Create target with cooler, desaturated tones (simulating GFPGAN shift)
        target = np.zeros((height, width, 3), dtype=np.uint8)
        target[:, :, 0] = 160  # B channel (more blue)
        target[:, :, 1] = 165  # G channel (less green)
        target[:, :, 2] = 195  # R channel (less red = cooler)

        # Apply color correction
        corrected = pipeline._correct_color_tone(source, target)

        # Calculate color differences (mean absolute error per channel)
        uncorrected_diff = np.mean(np.abs(source.astype(float) - target.astype(float)))
        corrected_diff = np.mean(np.abs(source.astype(float) - corrected.astype(float)))

        # Improved method should reduce color drift by at least 30%
        improvement = (uncorrected_diff - corrected_diff) / uncorrected_diff

        assert improvement >= 0.3, (
            f"Improved color correction should reduce drift by ≥30%, "
            f"but only achieved {improvement*100:.1f}% improvement. "
            f"Uncorrected diff: {uncorrected_diff:.2f}, "
            f"Corrected diff: {corrected_diff:.2f}"
        )

    def test_improved_method_uses_skin_weighting(self):
        """
        🔴 TDD RED: New method should weight skin regions more heavily

        This test validates that the improved method produces different results
        for images with skin vs non-skin content, proving it's using skin detection.
        """
        pipeline = FaceFixingPipeline(device='cpu')

        # Create image with skin tones in center, non-skin at edges
        height, width = 100, 100
        source_skin = np.zeros((height, width, 3), dtype=np.uint8)

        # Center region: skin tones (YCrCb skin range: Y=0-255, Cr=133-173, Cb=77-127)
        # In RGB: approximately R=190-230, G=150-200, B=130-180
        center_start, center_end = 25, 75
        source_skin[center_start:center_end, center_start:center_end, 0] = 140  # B
        source_skin[center_start:center_end, center_start:center_end, 1] = 170  # G
        source_skin[center_start:center_end, center_start:center_end, 2] = 210  # R (skin)

        # Edges: blue sky (non-skin)
        source_skin[:center_start, :, :] = [200, 150, 100]  # BGR blue
        source_skin[center_end:, :, :] = [200, 150, 100]
        source_skin[:, :center_start, :] = [200, 150, 100]
        source_skin[:, center_end:, :] = [200, 150, 100]

        # Target: shift both regions
        target = source_skin.copy()
        target[:, :, 2] -= 20  # Reduce red channel everywhere

        # Apply correction
        corrected = pipeline._correct_color_tone(source_skin, target)

        # Check that skin region (center) is corrected more than non-skin (edges)
        skin_correction = np.mean(np.abs(
            source_skin[center_start:center_end, center_start:center_end, 2].astype(float) -
            corrected[center_start:center_end, center_start:center_end, 2].astype(float)
        ))

        edge_correction = np.mean(np.abs(
            source_skin[:center_start, :, 2].astype(float) -
            corrected[:center_start, :, 2].astype(float)
        ))

        # Skin region should be corrected differently than non-skin
        # (This proves the method is using region-based weighting)
        assert skin_correction != edge_correction, (
            "Improved method should correct skin and non-skin regions differently, "
            "proving it uses skin-region weighting"
        )

    def test_color_correction_handles_edge_cases(self):
        """Test that color correction handles edge cases gracefully"""
        pipeline = FaceFixingPipeline(device='cpu')

        # Test 1: Identical images (no correction needed)
        identical = np.ones((50, 50, 3), dtype=np.uint8) * 128
        result = pipeline._correct_color_tone(identical, identical.copy())
        assert result.shape == identical.shape

        # Test 2: Pure black source
        black = np.zeros((50, 50, 3), dtype=np.uint8)
        target = np.ones((50, 50, 3), dtype=np.uint8) * 128
        result = pipeline._correct_color_tone(black, target)
        assert result.shape == black.shape

        # Test 3: Pure white source
        white = np.ones((50, 50, 3), dtype=np.uint8) * 255
        result = pipeline._correct_color_tone(white, target)
        assert result.shape == white.shape

    def test_color_correction_output_range(self):
        """Test that corrected values stay in valid uint8 range [0, 255]"""
        pipeline = FaceFixingPipeline(device='cpu')

        # Create extreme test case
        source = np.random.randint(0, 256, (100, 100, 3), dtype=np.uint8)
        target = np.random.randint(0, 256, (100, 100, 3), dtype=np.uint8)

        result = pipeline._correct_color_tone(source, target)

        # All values should be in valid range
        assert np.all(result >= 0) and np.all(result <= 255)
        assert result.dtype == np.uint8


if __name__ == '__main__':
    # Run tests with pytest
    pytest.main([__file__, '-v'])
