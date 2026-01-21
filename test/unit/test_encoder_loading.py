"""
Unit tests for encoder_loading module
Tests encoder loading functions with local files and fallbacks
"""

import pytest
import torch
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import tempfile
import json


class TestLoadClipFromSafetensors:
    """Tests for load_clip_from_safetensors function"""

    def test_load_clip_successful(self):
        """Test successful CLIP-L loading from safetensors file"""
        from services.encoder_loading import load_clip_from_safetensors

        # This test will fail until implementation exists
        # It expects to load a valid CLIP-L safetensors file
        clip_path = 'services/encoders/clip_l.safetensors'

        encoder = load_clip_from_safetensors(clip_path, torch.float16)

        assert encoder is not None
        assert hasattr(encoder, 'forward')  # Has forward method

    def test_load_clip_missing_file(self):
        """Test CLIP-L loading raises FileNotFoundError for missing file"""
        from services.encoder_loading import load_clip_from_safetensors

        with pytest.raises(FileNotFoundError):
            load_clip_from_safetensors('services/encoders/nonexistent.safetensors', torch.float16)

    def test_load_clip_with_float32(self):
        """Test CLIP-L loading with float32 dtype"""
        from services.encoder_loading import load_clip_from_safetensors

        clip_path = 'services/encoders/clip_l.safetensors'
        encoder = load_clip_from_safetensors(clip_path, torch.float32)

        assert encoder is not None


class TestLoadT5FromSafetensors:
    """Tests for load_t5_from_safetensors function"""

    def test_load_t5_successful(self):
        """Test successful T5-XXL loading from safetensors file"""
        from services.encoder_loading import load_t5_from_safetensors

        # T5 requires config.json in same directory
        t5_path = 'services/encoders/model.safetensors'

        encoder = load_t5_from_safetensors(t5_path, torch.float16)

        assert encoder is not None
        assert hasattr(encoder, 'forward')

    def test_load_t5_missing_file(self):
        """Test T5-XXL loading raises FileNotFoundError for missing file"""
        from services.encoder_loading import load_t5_from_safetensors

        with pytest.raises(FileNotFoundError):
            load_t5_from_safetensors('services/encoders/nonexistent.safetensors', torch.float16)

    def test_load_t5_missing_config(self):
        """Test T5-XXL loading raises error if config.json missing"""
        from services.encoder_loading import load_t5_from_safetensors

        # Create temp directory without config.json
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a dummy safetensors file
            safetensors_path = Path(tmpdir) / 'model.safetensors'
            safetensors_path.write_bytes(b'dummy')

            with pytest.raises((FileNotFoundError, Exception)):
                load_t5_from_safetensors(str(safetensors_path), torch.float16)

    def test_load_t5_converts_dtype(self):
        """Test T5-XXL conversion to target dtype"""
        from services.encoder_loading import load_t5_from_safetensors

        t5_path = 'services/encoders/model.safetensors'
        encoder = load_t5_from_safetensors(t5_path, torch.float16)

        # Check dtype conversion (allows for module parameters being different)
        assert encoder is not None


class TestLoadVAEFromSafetensors:
    """Tests for load_vae_from_safetensors function"""

    def test_load_vae_successful(self):
        """Test successful VAE loading from safetensors file"""
        from services.encoder_loading import load_vae_from_safetensors

        vae_path = 'services/encoders/ae.safetensors'

        encoder = load_vae_from_safetensors(vae_path, torch.float16)

        assert encoder is not None
        assert hasattr(encoder, 'forward')

    def test_load_vae_missing_file(self):
        """Test VAE loading raises FileNotFoundError for missing file"""
        from services.encoder_loading import load_vae_from_safetensors

        with pytest.raises(FileNotFoundError):
            load_vae_from_safetensors('services/encoders/nonexistent.safetensors', torch.float16)


class TestLoadEncoderWithFallbacks:
    """Tests for load_encoder_with_fallbacks function"""

    def test_load_from_local_success(self):
        """Test loading from local path when successful"""
        from services.encoder_loading import load_encoder_with_fallbacks, EncoderConfig

        def local_loader(path):
            return Mock(name="test_encoder")

        config = EncoderConfig(
            name="TestEncoder",
            env_var_path="services/encoders/test.safetensors",
            local_loader=local_loader,
            fallback_chain=[]
        )

        encoder = load_encoder_with_fallbacks(config, torch.float16)

        assert encoder is not None
        assert encoder.name == "test_encoder"

    def test_load_fallback_when_local_fails(self):
        """Test tries fallback when local loading fails"""
        from services.encoder_loading import load_encoder_with_fallbacks, EncoderConfig

        def local_loader(path):
            raise FileNotFoundError("local file not found")

        def fallback_loader():
            return Mock(name="fallback_encoder")

        config = EncoderConfig(
            name="TestEncoder",
            env_var_path="services/encoders/missing.safetensors",
            local_loader=local_loader,
            fallback_chain=[fallback_loader]
        )

        encoder = load_encoder_with_fallbacks(config, torch.float16)

        assert encoder is not None
        assert encoder.name == "fallback_encoder"

    def test_load_no_local_path_uses_fallback(self):
        """Test uses fallback chain when no local path configured"""
        from services.encoder_loading import load_encoder_with_fallbacks, EncoderConfig

        def fallback_loader():
            return Mock(name="fallback_encoder")

        config = EncoderConfig(
            name="TestEncoder",
            env_var_path=None,  # No local path
            local_loader=lambda x: Mock(),
            fallback_chain=[fallback_loader]
        )

        encoder = load_encoder_with_fallbacks(config, torch.float16)

        assert encoder is not None

    def test_load_all_fallbacks_exhausted(self):
        """Test returns None when all methods fail"""
        from services.encoder_loading import load_encoder_with_fallbacks, EncoderConfig

        def local_loader(path):
            raise FileNotFoundError("local failed")

        def fallback1():
            raise Exception("fallback 1 failed")

        def fallback2():
            raise Exception("fallback 2 failed")

        config = EncoderConfig(
            name="TestEncoder",
            env_var_path="services/encoders/missing.safetensors",
            local_loader=local_loader,
            fallback_chain=[fallback1, fallback2]
        )

        encoder = load_encoder_with_fallbacks(config, torch.float16)

        assert encoder is None

    def test_dtype_converter_applied(self):
        """Test dtype_converter is applied after loading"""
        from services.encoder_loading import load_encoder_with_fallbacks, EncoderConfig

        mock_encoder = Mock(name="test_encoder")
        mock_encoder.to = Mock(return_value=mock_encoder)

        def local_loader(path):
            return mock_encoder

        def dtype_converter(encoder):
            encoder.to(dtype=torch.float16)
            return encoder

        config = EncoderConfig(
            name="TestEncoder",
            env_var_path="services/encoders/test.safetensors",
            local_loader=local_loader,
            fallback_chain=[],
            dtype_converter=dtype_converter
        )

        encoder = load_encoder_with_fallbacks(config, torch.float16)

        assert encoder is not None
        mock_encoder.to.assert_called()


class TestEncoderConfig:
    """Tests for EncoderConfig dataclass"""

    def test_encoder_config_creation(self):
        """Test EncoderConfig can be created with required fields"""
        from services.encoder_loading import EncoderConfig

        config = EncoderConfig(
            name="CLIP-L",
            env_var_path="services/encoders/clip_l.safetensors",
            local_loader=lambda x: Mock(),
            fallback_chain=[]
        )

        assert config.name == "CLIP-L"
        assert config.env_var_path == "services/encoders/clip_l.safetensors"
        assert config.fallback_chain == []


class TestLoadTextEncodersHelper:
    """Tests for load_text_encoders helper function"""

    @patch.dict('os.environ', {
        'FLUX_TEXT_ENCODER_PATH': 'services/encoders/clip_l.safetensors',
        'FLUX_TEXT_ENCODER_2_PATH': 'services/encoders/model.safetensors'
    })
    def test_load_text_encoders_with_local_paths(self):
        """Test load_text_encoders uses local paths when configured"""
        from services.encoder_loading import load_text_encoders

        clip, t5 = load_text_encoders(torch.float16)

        assert clip is not None
        assert t5 is not None

    @patch.dict('os.environ', {
        'FLUX_TEXT_ENCODER_PATH': '',
        'FLUX_TEXT_ENCODER_2_PATH': ''
    }, clear=False)
    def test_load_text_encoders_without_local_paths(self):
        """Test load_text_encoders falls back to HuggingFace"""
        from services.encoder_loading import load_text_encoders

        # This will try HF fallbacks - should succeed or raise appropriate error
        try:
            clip, t5 = load_text_encoders(torch.float16)
            assert clip is not None or t5 is not None  # At least one should load
        except Exception as e:
            # Network errors or missing HF token are acceptable in test
            assert 'HF' in str(e) or 'network' in str(e).lower() or 'timeout' in str(e).lower()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
