"""
Standalone Upscaler Pipeline Tests

TDD RED PHASE: Tests for standalone image upscaling with Remacri model support.
Uses pytest with mocking for model-heavy operations to keep tests fast.
"""

import re
import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from PIL import Image
import numpy as np


class TestUpscalerPipelineContract:
    """
    TDD RED: Verify core UpscalerPipeline class structure and contract.
    """

    def test_pipeline_class_exists(self):
        """UpscalerPipeline class should be importable"""
        from upscaler import UpscalerPipeline

        assert UpscalerPipeline is not None

    def test_pipeline_has_upscale_method(self):
        """Pipeline should have upscale method"""
        from upscaler import UpscalerPipeline

        assert hasattr(UpscalerPipeline, 'upscale')
        assert callable(getattr(UpscalerPipeline, 'upscale'))

    def test_get_upscaler_function_exists(self):
        """get_upscaler function should be importable"""
        from upscaler import get_upscaler

        assert get_upscaler is not None
        assert callable(get_upscaler)

    def test_pipeline_initialization(self):
        """Pipeline should initialize without loading models (lazy loading)"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')
        assert pipeline is not None
        assert hasattr(pipeline, 'device')
        assert pipeline.upsampler is None  # Lazy — not loaded yet

    def test_pipeline_has_models_registry(self):
        """Pipeline should have MODELS dict with supported upscaler models"""
        from upscaler import UpscalerPipeline

        assert hasattr(UpscalerPipeline, 'MODELS')
        models = UpscalerPipeline.MODELS
        assert 'remacri' in models
        assert 'remacri-smooth' in models
        assert 'realesrgan-x4' in models
        assert 'realesrgan-x2' in models

    def test_default_model_is_remacri(self):
        """Default model should be remacri"""
        from upscaler import UpscalerPipeline

        assert UpscalerPipeline.DEFAULT_MODEL == 'remacri'

    def test_model_configs_have_required_fields(self):
        """Each model config should have scale and filename"""
        from upscaler import UpscalerPipeline

        for name, config in UpscalerPipeline.MODELS.items():
            assert 'scale' in config, f'{name} missing scale'
            assert 'filename' in config, f'{name} missing filename'
            assert config['scale'] in (2, 4), f'{name} has unsupported scale {config["scale"]}'


class TestOldESRGANKeyConversion:
    """
    TDD RED: Test the key format conversion from old ESRGAN to BasicSR RRDBNet.
    Remacri uses old format (model.0.weight) while RRDBNet expects (conv_first.weight).
    """

    def test_convert_function_exists(self):
        """convert_old_esrgan_keys function should be importable"""
        from upscaler import convert_old_esrgan_keys

        assert callable(convert_old_esrgan_keys)

    def test_conv_first_conversion(self):
        """model.0.weight -> conv_first.weight"""
        from upscaler import convert_old_esrgan_keys

        old_sd = {'model.0.weight': 'w', 'model.0.bias': 'b'}
        new_sd = convert_old_esrgan_keys(old_sd)
        assert 'conv_first.weight' in new_sd
        assert 'conv_first.bias' in new_sd

    def test_body_block_conversion(self):
        """model.1.sub.N.RDBN.convM.0 -> body.N.rdbN.convM"""
        from upscaler import convert_old_esrgan_keys

        old_sd = {
            'model.1.sub.0.RDB1.conv1.0.weight': 'w',
            'model.1.sub.5.RDB3.conv4.0.bias': 'b',
        }
        new_sd = convert_old_esrgan_keys(old_sd)
        assert 'body.0.rdb1.conv1.weight' in new_sd
        assert 'body.5.rdb3.conv4.bias' in new_sd

    def test_conv_body_conversion(self):
        """model.1.sub.23 (last sub) -> conv_body"""
        from upscaler import convert_old_esrgan_keys

        old_sd = {'model.1.sub.23.weight': 'w', 'model.1.sub.23.bias': 'b'}
        new_sd = convert_old_esrgan_keys(old_sd)
        assert 'conv_body.weight' in new_sd
        assert 'conv_body.bias' in new_sd

    def test_upconv_conversion(self):
        """model.3 -> conv_up1, model.6 -> conv_up2"""
        from upscaler import convert_old_esrgan_keys

        old_sd = {
            'model.3.weight': 'w1', 'model.3.bias': 'b1',
            'model.6.weight': 'w2', 'model.6.bias': 'b2',
        }
        new_sd = convert_old_esrgan_keys(old_sd)
        assert 'conv_up1.weight' in new_sd
        assert 'conv_up2.weight' in new_sd

    def test_hr_and_last_conv_conversion(self):
        """model.8 -> conv_hr, model.10 -> conv_last"""
        from upscaler import convert_old_esrgan_keys

        old_sd = {
            'model.8.weight': 'w1', 'model.8.bias': 'b1',
            'model.10.weight': 'w2', 'model.10.bias': 'b2',
        }
        new_sd = convert_old_esrgan_keys(old_sd)
        assert 'conv_hr.weight' in new_sd
        assert 'conv_last.weight' in new_sd

    def test_preserves_all_keys(self):
        """Conversion should not lose any keys"""
        from upscaler import convert_old_esrgan_keys

        old_sd = {f'key_{i}': i for i in range(10)}
        new_sd = convert_old_esrgan_keys(old_sd)
        assert len(new_sd) == len(old_sd)


class TestUpscaleMethod:
    """
    TDD RED: Test the upscale() public API with mocked model loading.
    """

    def test_upscale_returns_tuple(self):
        """upscale() should return (PIL.Image, dict) tuple"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')

        # Mock the upsampler so we don't need actual model weights
        mock_upsampler = MagicMock()
        # RealESRGANer.enhance returns (output_bgr, None)
        fake_output = np.zeros((256, 256, 3), dtype=np.uint8)
        mock_upsampler.enhance.return_value = (fake_output, None)
        pipeline.upsampler = mock_upsampler
        pipeline._current_model = 'remacri'

        input_image = Image.new('RGB', (64, 64), color='red')
        result = pipeline.upscale(input_image, model_name='remacri')

        assert isinstance(result, tuple)
        assert len(result) == 2
        assert isinstance(result[0], Image.Image)
        assert isinstance(result[1], dict)

    def test_upscale_metadata_fields(self):
        """Metadata should include model, scale, time, and dimensions"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')

        mock_upsampler = MagicMock()
        fake_output = np.zeros((256, 256, 3), dtype=np.uint8)
        mock_upsampler.enhance.return_value = (fake_output, None)
        pipeline.upsampler = mock_upsampler
        pipeline._current_model = 'remacri'

        input_image = Image.new('RGB', (64, 64), color='red')
        _, metadata = pipeline.upscale(input_image, model_name='remacri')

        assert 'model' in metadata
        assert 'scale' in metadata
        assert 'time' in metadata
        assert 'input_size' in metadata
        assert 'output_size' in metadata
        assert metadata['model'] == 'remacri'

    def test_upscale_converts_rgb_to_bgr_and_back(self):
        """Should convert PIL RGB -> BGR numpy for upsampler, then back to RGB PIL"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')

        mock_upsampler = MagicMock()
        fake_output = np.zeros((256, 256, 3), dtype=np.uint8)
        mock_upsampler.enhance.return_value = (fake_output, None)
        pipeline.upsampler = mock_upsampler
        pipeline._current_model = 'remacri'

        # Create a red image (RGB: 255, 0, 0)
        input_image = Image.new('RGB', (64, 64), color=(255, 0, 0))
        pipeline.upscale(input_image, model_name='remacri')

        # Verify enhance was called with BGR numpy array
        call_args = mock_upsampler.enhance.call_args
        input_array = call_args[0][0]
        assert isinstance(input_array, np.ndarray)
        # BGR: blue channel (index 0) should be 0, red channel (index 2) should be 255
        assert input_array[0, 0, 0] == 0    # Blue
        assert input_array[0, 0, 2] == 255  # Red

    def test_upscale_strips_alpha_channel(self):
        """Should handle RGBA images by stripping alpha before upscaling"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')

        mock_upsampler = MagicMock()
        fake_output = np.zeros((256, 256, 3), dtype=np.uint8)
        mock_upsampler.enhance.return_value = (fake_output, None)
        pipeline.upsampler = mock_upsampler
        pipeline._current_model = 'remacri'

        input_image = Image.new('RGBA', (64, 64), color=(255, 0, 0, 128))
        result_image, _ = pipeline.upscale(input_image, model_name='remacri')

        # Should succeed without error and return RGB image
        assert result_image.mode == 'RGB'

    def test_upscale_invalid_model_raises_valueerror(self):
        """Should raise ValueError for unknown model names"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')

        input_image = Image.new('RGB', (64, 64))
        with pytest.raises(ValueError, match='Unknown upscaler model'):
            pipeline.upscale(input_image, model_name='nonexistent-model')


class TestModelLoading:
    """
    TDD RED: Test model loading and caching behavior.
    """

    def test_lazy_loading_on_first_upscale(self):
        """Model should not load until first upscale() call"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')
        assert pipeline.upsampler is None

    def test_model_reuse_on_same_model(self):
        """Calling upscale twice with same model should not reload"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')

        mock_upsampler = MagicMock()
        fake_output = np.zeros((256, 256, 3), dtype=np.uint8)
        mock_upsampler.enhance.return_value = (fake_output, None)
        pipeline.upsampler = mock_upsampler
        pipeline._current_model = 'remacri'

        input_image = Image.new('RGB', (64, 64))

        # Upscale twice with same model
        with patch.object(pipeline, '_load_model') as mock_load:
            pipeline.upscale(input_image, model_name='remacri')
            pipeline.upscale(input_image, model_name='remacri')
            # Should not reload since model is already loaded
            mock_load.assert_not_called()

    def test_model_reload_on_different_model(self):
        """Switching models should trigger reload"""
        from upscaler import UpscalerPipeline

        pipeline = UpscalerPipeline(device='cpu')

        mock_upsampler = MagicMock()
        fake_output = np.zeros((256, 256, 3), dtype=np.uint8)
        mock_upsampler.enhance.return_value = (fake_output, None)
        pipeline.upsampler = mock_upsampler
        pipeline._current_model = 'remacri'

        input_image = Image.new('RGB', (64, 64))

        with patch.object(pipeline, '_load_model') as mock_load:
            # Switch to a different model
            pipeline.upscale(input_image, model_name='realesrgan-x4')
            mock_load.assert_called_once_with('realesrgan-x4')


class TestSingletonFactory:
    """
    TDD RED: Test the get_upscaler() singleton factory.
    """

    def test_singleton_returns_same_instance(self):
        """get_upscaler() should return the same instance on repeated calls"""
        import upscaler as upscaler_module

        # Reset singleton
        upscaler_module._upscaler_instance = None

        instance1 = upscaler_module.get_upscaler(device='cpu')
        instance2 = upscaler_module.get_upscaler(device='cpu')
        assert instance1 is instance2

        # Cleanup
        upscaler_module._upscaler_instance = None

    def test_reset_upscaler_function_exists(self):
        """reset_upscaler() should exist for testing/cleanup"""
        from upscaler import reset_upscaler

        assert callable(reset_upscaler)
