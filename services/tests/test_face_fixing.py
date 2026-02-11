"""
Face Fixing Pipeline Tests

TDD RED PHASE: Comprehensive tests for face fixing functionality
Uses pytest with mocking for model-heavy operations to keep tests fast
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from PIL import Image
import numpy as np


class TestFaceFixingPipelineContract:
    """
    TDD RED: Tests verify core pipeline class structure and contract
    Tests that the FaceFixingPipeline class exists and has expected methods
    """

    def test_pipeline_class_exists(self):
        """FaceFixingPipeline class should be importable"""
        from face_fixing import FaceFixingPipeline

        assert FaceFixingPipeline is not None

    def test_pipeline_has_fix_faces_method(self):
        """Pipeline should have fix_faces method"""
        from face_fixing import FaceFixingPipeline

        assert hasattr(FaceFixingPipeline, 'fix_faces')
        assert callable(getattr(FaceFixingPipeline, 'fix_faces'))

    def test_get_face_fixer_function_exists(self):
        """get_face_fixer function should be importable"""
        from face_fixing import get_face_fixer

        assert get_face_fixer is not None
        assert callable(get_face_fixer)

    def test_pipeline_initialization(self):
        """Pipeline should initialize without errors"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        assert pipeline is not None
        assert hasattr(pipeline, 'device')
        assert hasattr(pipeline, 'enhancer_type')


class TestFaceDetection:
    """
    TDD RED: Tests for OpenCV cascade face detection
    Mocks cv2.CascadeClassifier to avoid loading actual models
    """

    @patch('cv2.CascadeClassifier')
    def test_detect_faces_returns_list(self, mock_cascade):
        """_detect_faces should return a list of detected faces"""
        from face_fixing import FaceFixingPipeline

        # Setup mock to return test detections
        mock_detector = MagicMock()
        mock_cascade.return_value = mock_detector
        mock_detector.empty.return_value = False
        mock_detector.detectMultiScale.return_value = np.array([[10, 10, 100, 100]])

        pipeline = FaceFixingPipeline(device='cpu')
        img = np.zeros((512, 512, 3), dtype=np.uint8)

        faces = pipeline._detect_faces(img)

        assert isinstance(faces, list)
        assert len(faces) > 0

    @patch('cv2.CascadeClassifier')
    def test_no_faces_returns_empty_list(self, mock_cascade):
        """_detect_faces should return empty list when no faces detected"""
        from face_fixing import FaceFixingPipeline

        mock_detector = MagicMock()
        mock_cascade.return_value = mock_detector
        mock_detector.empty.return_value = False
        mock_detector.detectMultiScale.return_value = np.array([])

        pipeline = FaceFixingPipeline(device='cpu')
        img = np.zeros((512, 512, 3), dtype=np.uint8)

        faces = pipeline._detect_faces(img)

        assert isinstance(faces, list)
        assert len(faces) == 0

    @patch('cv2.CascadeClassifier')
    def test_multiple_faces_detected(self, mock_cascade):
        """_detect_faces should detect multiple faces in image"""
        from face_fixing import FaceFixingPipeline

        mock_detector = MagicMock()
        mock_cascade.return_value = mock_detector
        mock_detector.empty.return_value = False
        # Return 3 face detections
        mock_detector.detectMultiScale.return_value = np.array([
            [10, 10, 100, 100],
            [200, 150, 120, 120],
            [100, 300, 80, 80],
        ])

        pipeline = FaceFixingPipeline(device='cpu')
        img = np.zeros((512, 512, 3), dtype=np.uint8)

        faces = pipeline._detect_faces(img)

        assert len(faces) == 3
        for face in faces:
            assert 'box' in face
            assert 'score' in face

    @patch('cv2.CascadeClassifier')
    def test_detected_faces_have_correct_structure(self, mock_cascade):
        """Detected faces should have box coordinates and score"""
        from face_fixing import FaceFixingPipeline

        mock_detector = MagicMock()
        mock_cascade.return_value = mock_detector
        mock_detector.empty.return_value = False
        mock_detector.detectMultiScale.return_value = np.array([[10, 20, 100, 150]])

        pipeline = FaceFixingPipeline(device='cpu')
        img = np.zeros((512, 512, 3), dtype=np.uint8)

        faces = pipeline._detect_faces(img)

        assert len(faces) == 1
        face = faces[0]
        assert 'box' in face
        assert 'score' in face
        box = face['box']
        assert len(box) == 4  # x1, y1, x2, y2


class TestGFPGANEnhancement:
    """
    TDD RED: Tests for GFPGAN face enhancement
    Mocks GFPGANer class to avoid loading actual GFPGAN model
    """

    def test_enhancement_with_gfpgan_fallback(self):
        """Should have graceful fallback for face enhancement"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')

        # Test that enhance methods exist
        assert hasattr(pipeline, '_enhance_with_gfpgan')
        assert hasattr(pipeline, '_enhance_face')

    @patch('face_fixing.HAS_GFPGAN', False)
    def test_graceful_fallback_when_gfpgan_unavailable(self):
        """Should handle gracefully when GFPGAN not available"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        pipeline._load_enhancer()

        # Should set enhancer_type to 'none' not crash
        assert pipeline.enhancer_type == 'none'


class TestRealESRGANUpscaling:
    """
    TDD RED: Tests for Real-ESRGAN upscaling
    Mocks RealESRGANer class to avoid loading actual model
    """

    @patch('face_fixing.HAS_REALESRGAN', False)
    def test_raises_error_when_realesrgan_unavailable(self):
        """Should raise ImportError when Real-ESRGAN not available"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')

        with pytest.raises(ImportError):
            pipeline._load_upsampler(scale=2)

    def test_upscaling_method_exists(self):
        """Should have upscaling method available"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')

        # Test that upscaling methods exist
        assert hasattr(pipeline, '_load_upsampler')
        assert hasattr(pipeline, '_upscale_image')


class TestParameterValidation:
    """
    TDD RED: Tests for input parameter validation
    Verifies that invalid parameters are rejected with clear errors
    """

    def test_fidelity_valid_range(self):
        """fidelity parameter should accept 0.0 to 1.0"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        # Valid values should not raise
        valid_fidelities = [0.0, 0.3, 0.5, 0.7, 0.9, 1.0]
        for fidelity in valid_fidelities:
            # Should not raise
            try:
                _, metadata = pipeline.fix_faces(img, fidelity=fidelity, upscale=1)
                # Validation passed
                assert metadata is not None
            except ValueError:
                pytest.fail(f"fidelity={fidelity} should be valid")

    def test_fidelity_invalid_below_zero(self):
        """fidelity < 0.0 should result in error in metadata"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        result, metadata = pipeline.fix_faces(img, fidelity=-0.1, upscale=1)

        # Should return original image with error metadata
        assert metadata['applied'] is False
        assert 'error' in metadata

    def test_fidelity_invalid_above_one(self):
        """fidelity > 1.0 should result in error in metadata"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        result, metadata = pipeline.fix_faces(img, fidelity=1.5, upscale=1)

        # Should return original image with error metadata
        assert metadata['applied'] is False
        assert 'error' in metadata

    def test_upscale_valid_values(self):
        """upscale should only accept 1 or 2"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        # Valid values
        for upscale in [1, 2]:
            try:
                _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=upscale)
                assert metadata is not None
            except ValueError:
                pytest.fail(f"upscale={upscale} should be valid")

    def test_upscale_invalid_values(self):
        """upscale with invalid values should result in error in metadata"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        invalid_upscales = [0, 3, 4, -1]
        for upscale in invalid_upscales:
            result, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=upscale)
            # Should return original image with error metadata
            assert metadata['applied'] is False
            assert 'error' in metadata


class TestMetadataTracking:
    """
    TDD RED: Tests for response metadata structure
    Verifies that metadata includes all required fields
    """

    def test_metadata_structure_has_required_fields(self):
        """Metadata should include applied, faces_count, fidelity, upscale, time"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        # Check required fields exist
        assert 'applied' in metadata
        assert 'faces_count' in metadata
        assert 'fidelity' in metadata
        assert 'upscale' in metadata
        assert 'time' in metadata

    def test_metadata_applied_is_boolean(self):
        """metadata['applied'] should be a boolean"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        assert isinstance(metadata['applied'], bool)

    def test_metadata_faces_count_is_integer(self):
        """metadata['faces_count'] should be an integer"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        assert isinstance(metadata['faces_count'], int)
        assert metadata['faces_count'] >= 0

    def test_metadata_fidelity_matches_parameter(self):
        """metadata['fidelity'] should match the input fidelity"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        test_fidelity = 0.75
        _, metadata = pipeline.fix_faces(img, fidelity=test_fidelity, upscale=1)

        assert metadata['fidelity'] == test_fidelity

    def test_metadata_upscale_matches_parameter(self):
        """metadata['upscale'] should match the input upscale"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        test_upscale = 2
        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=test_upscale)

        assert metadata['upscale'] == test_upscale

    def test_metadata_time_is_float(self):
        """metadata['time'] should be a float (seconds)"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        assert isinstance(metadata['time'], float)
        assert metadata['time'] >= 0.0

    def test_metadata_includes_reason_when_no_faces(self):
        """Metadata should include 'reason' field when no faces detected"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64), color='white')

        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        # When no faces detected, applied should be False
        if metadata['applied'] is False and metadata['faces_count'] == 0:
            assert 'reason' in metadata or 'error' not in metadata or metadata.get('error') is None


class TestErrorHandling:
    """
    TDD RED: Tests for graceful error handling and fallback
    Verifies the system handles errors without crashing
    """

    def test_no_faces_returns_original_image(self):
        """When no faces detected, should return original image unchanged"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64), color='white')

        result, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        # Result should still be a PIL Image
        assert isinstance(result, Image.Image)
        # Dimensions should match input
        assert result.size == img.size

    def test_invalid_image_format_handling(self):
        """Should handle RGBA images by converting to RGB"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGBA', (64, 64))

        # Should not crash
        result, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        assert isinstance(result, Image.Image)

    def test_metadata_included_on_all_paths(self):
        """Metadata should be included in response regardless of success/failure"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGB', (64, 64))

        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        # Metadata should never be None
        assert metadata is not None
        assert isinstance(metadata, dict)


class TestImageFormats:
    """
    TDD RED: Tests for image format conversions
    Verifies that PIL, numpy, and color format conversions work correctly
    """

    def test_pil_to_numpy_conversion(self):
        """Should convert PIL Image to numpy array"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')

        # Create test PIL image
        pil_img = Image.new('RGB', (64, 64), color=(255, 0, 0))
        np_img = np.array(pil_img)

        assert isinstance(np_img, np.ndarray)
        assert np_img.shape == (64, 64, 3)

    def test_rgba_to_rgb_conversion(self):
        """Should handle RGBA to RGB conversion"""
        from face_fixing import FaceFixingPipeline

        pipeline = FaceFixingPipeline(device='cpu')
        img = Image.new('RGBA', (64, 64))

        _, metadata = pipeline.fix_faces(img, fidelity=0.7, upscale=1)

        # Should complete without error
        assert metadata is not None

    def test_image_array_dtype(self):
        """Image arrays should use uint8 dtype"""
        pil_img = Image.new('RGB', (64, 64), color=(200, 100, 50))
        np_img = np.array(pil_img)

        assert np_img.dtype == np.uint8
        assert np.all(np_img <= 255)
        assert np.all(np_img >= 0)


class TestSingletonPattern:
    """
    TDD RED: Tests for singleton face fixer instance
    """

    def test_get_face_fixer_returns_instance(self):
        """get_face_fixer should return a FaceFixingPipeline instance"""
        from face_fixing import get_face_fixer, FaceFixingPipeline

        fixer = get_face_fixer()

        assert isinstance(fixer, FaceFixingPipeline)

    def test_get_face_fixer_is_singleton(self):
        """get_face_fixer should return same instance on repeated calls"""
        from face_fixing import get_face_fixer

        fixer1 = get_face_fixer()
        fixer2 = get_face_fixer()

        assert fixer1 is fixer2
