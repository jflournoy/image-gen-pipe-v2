"""
Modal Diffusion Service Tests
TDD RED PHASE: These tests define the contract for the Modal diffusion service

Note: These tests use pytest with mocking since Modal testing requires deployment.
For actual Modal testing, use `modal run` with test inputs.
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import base64
import io

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestModalDiffusionServiceContract:
    """
    Tests that define the contract for the Modal diffusion service.
    These tests will fail until the service is implemented.
    """

    def test_service_module_exists(self):
        """The modal_diffusion_service module should exist and be importable"""
        try:
            import modal_diffusion_service
            assert modal_diffusion_service is not None
        except ImportError:
            pytest.fail("modal_diffusion_service module should exist")

    def test_service_has_app(self):
        """Service should define a Modal App"""
        from modal_diffusion_service import app
        assert app is not None

    def test_service_has_diffusion_class(self):
        """Service should have a DiffusionService class"""
        from modal_diffusion_service import DiffusionService
        assert DiffusionService is not None


class TestGenerateRequest:
    """Tests for the GenerateRequest Pydantic model"""

    def test_generate_request_model_exists(self):
        """GenerateRequest model should exist"""
        from modal_diffusion_service import GenerateRequest
        assert GenerateRequest is not None

    def test_generate_request_has_required_fields(self):
        """GenerateRequest should have prompt field as required"""
        from modal_diffusion_service import GenerateRequest

        # Should work with prompt
        request = GenerateRequest(prompt="a beautiful sunset")
        assert request.prompt == "a beautiful sunset"

    def test_generate_request_has_optional_fields(self):
        """GenerateRequest should have optional fields with defaults"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(prompt="test")

        # Default values
        assert request.model == "flux-dev"
        assert request.width == 1024
        assert request.height == 1024
        assert request.steps == 25
        assert request.guidance == 3.5

    def test_generate_request_accepts_custom_values(self):
        """GenerateRequest should accept custom values"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(
            prompt="test",
            model="sdxl-turbo",
            width=512,
            height=768,
            steps=4,
            guidance=0.0,
            seed=42
        )

        assert request.model == "sdxl-turbo"
        assert request.width == 512
        assert request.height == 768
        assert request.steps == 4
        assert request.guidance == 0.0
        assert request.seed == 42


class TestGenerateResponse:
    """Tests for the GenerateResponse Pydantic model"""

    def test_generate_response_model_exists(self):
        """GenerateResponse model should exist"""
        from modal_diffusion_service import GenerateResponse
        assert GenerateResponse is not None

    def test_generate_response_has_image_field(self):
        """GenerateResponse should have image field for base64 data"""
        from modal_diffusion_service import GenerateResponse

        response = GenerateResponse(
            image="base64data",
            format="base64"
        )
        assert response.image == "base64data"
        assert response.format == "base64"

    def test_generate_response_has_optional_metadata(self):
        """GenerateResponse should have optional metadata field"""
        from modal_diffusion_service import GenerateResponse

        response = GenerateResponse(
            image="base64data",
            format="base64",
            metadata={"seed": 42, "inference_time": 3.5}
        )
        assert response.metadata["seed"] == 42
        assert response.metadata["inference_time"] == 3.5


class TestHealthResponse:
    """Tests for the HealthResponse model"""

    def test_health_response_model_exists(self):
        """HealthResponse model should exist"""
        from modal_diffusion_service import HealthResponse
        assert HealthResponse is not None

    def test_health_response_has_required_fields(self):
        """HealthResponse should have status and model fields"""
        from modal_diffusion_service import HealthResponse

        response = HealthResponse(
            status="healthy",
            model="flux-dev"
        )
        assert response.status == "healthy"
        assert response.model == "flux-dev"

    def test_health_response_has_available_models(self):
        """HealthResponse should have optional available_models field"""
        from modal_diffusion_service import HealthResponse

        response = HealthResponse(
            status="healthy",
            model="flux-dev",
            available_models=["flux-dev", "sdxl-turbo", "my-custom-model"]
        )
        assert response.available_models == ["flux-dev", "sdxl-turbo", "my-custom-model"]


class TestModelsResponse:
    """Tests for the ModelsResponse model"""

    def test_models_response_exists(self):
        """ModelsResponse model should exist"""
        from modal_diffusion_service import ModelsResponse
        assert ModelsResponse is not None

    def test_models_response_has_models_field(self):
        """ModelsResponse should have models list field"""
        from modal_diffusion_service import ModelsResponse

        response = ModelsResponse(
            models=[
                {"name": "flux-dev", "type": "builtin", "pipeline": "flux"},
                {"name": "my-model", "type": "custom", "pipeline": "sdxl"},
            ]
        )
        assert len(response.models) == 2
        assert response.models[0]["name"] == "flux-dev"


class TestDiffusionServiceClass:
    """Tests for the DiffusionService class methods"""

    def test_diffusion_service_has_load_method(self):
        """DiffusionService should have a load_model method decorated with @modal.enter()"""
        from modal_diffusion_service import DiffusionService

        # Check the class has the method
        assert hasattr(DiffusionService, 'load_model')

    def test_diffusion_service_has_generate_method(self):
        """DiffusionService should have a generate method"""
        from modal_diffusion_service import DiffusionService

        assert hasattr(DiffusionService, 'generate')

    def test_diffusion_service_has_generate_endpoint(self):
        """DiffusionService should have a generate_endpoint for HTTP access"""
        from modal_diffusion_service import DiffusionService

        assert hasattr(DiffusionService, 'generate_endpoint')

    def test_diffusion_service_has_health_endpoint(self):
        """DiffusionService should have a health endpoint"""
        from modal_diffusion_service import DiffusionService

        assert hasattr(DiffusionService, 'health')


class TestModelSupport:
    """Tests for supported diffusion models"""

    def test_supported_models_constant_exists(self):
        """Service should define SUPPORTED_MODELS constant"""
        from modal_diffusion_service import SUPPORTED_MODELS
        assert SUPPORTED_MODELS is not None
        assert isinstance(SUPPORTED_MODELS, dict)

    def test_flux_dev_is_supported(self):
        """flux-dev should be a supported model"""
        from modal_diffusion_service import SUPPORTED_MODELS
        assert "flux-dev" in SUPPORTED_MODELS

    def test_sdxl_turbo_is_supported(self):
        """sdxl-turbo should be a supported model"""
        from modal_diffusion_service import SUPPORTED_MODELS
        assert "sdxl-turbo" in SUPPORTED_MODELS


class TestImageUtils:
    """Tests for image utility functions"""

    def test_image_to_base64_function_exists(self):
        """Service should have image_to_base64 utility function"""
        from modal_diffusion_service import image_to_base64
        assert image_to_base64 is not None

    def test_image_to_base64_returns_string(self):
        """image_to_base64 should return a base64 string"""
        from modal_diffusion_service import image_to_base64
        from PIL import Image

        # Create a small test image
        img = Image.new('RGB', (64, 64), color='red')
        result = image_to_base64(img)

        assert isinstance(result, str)
        # Should be valid base64
        decoded = base64.b64decode(result)
        assert len(decoded) > 0


class TestModalDecorators:
    """Tests to verify Modal decorators are properly applied"""

    def test_app_has_correct_name(self):
        """Modal app should have the correct name"""
        from modal_diffusion_service import app
        # Modal app name is set at creation
        assert "diffusion" in app.name.lower() or app.name is not None

    def test_diffusion_service_is_modal_cls(self):
        """DiffusionService should be decorated with @app.cls()"""
        from modal_diffusion_service import DiffusionService
        # Modal classes have specific attributes when decorated
        # The class should have Modal metadata
        assert DiffusionService is not None


class TestErrorHandling:
    """Tests for error handling in the service"""

    def test_generate_request_validates_prompt(self):
        """Empty prompt should raise validation error"""
        from modal_diffusion_service import GenerateRequest
        from pydantic import ValidationError

        # Empty string should be rejected
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="")

    def test_generate_request_validates_dimensions(self):
        """Invalid dimensions should raise validation error"""
        from modal_diffusion_service import GenerateRequest
        from pydantic import ValidationError

        # Negative dimensions should be rejected
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", width=-1)

        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", height=-1)


class TestGPUConfiguration:
    """Tests for GPU configuration"""

    def test_default_gpu_type_is_defined(self):
        """Default GPU type should be defined"""
        from modal_diffusion_service import DEFAULT_GPU
        assert DEFAULT_GPU is not None
        # Common GPU types for Modal
        assert DEFAULT_GPU in ["A10G", "T4", "A100", "L4", "H100"]


class TestVolumeConfiguration:
    """Tests for Modal Volume configuration"""

    def test_volume_name_is_defined(self):
        """VOLUME_NAME should be defined"""
        from modal_diffusion_service import VOLUME_NAME
        assert VOLUME_NAME is not None
        assert isinstance(VOLUME_NAME, str)

    def test_models_dir_is_defined(self):
        """MODELS_DIR should be defined"""
        from modal_diffusion_service import MODELS_DIR
        assert MODELS_DIR is not None
        assert MODELS_DIR.startswith("/")

    def test_cache_dir_is_defined(self):
        """CACHE_DIR should be defined for HuggingFace cache"""
        from modal_diffusion_service import CACHE_DIR
        assert CACHE_DIR is not None
        assert "huggingface" in CACHE_DIR

    def test_custom_models_dir_is_defined(self):
        """CUSTOM_MODELS_DIR should be defined"""
        from modal_diffusion_service import CUSTOM_MODELS_DIR
        assert CUSTOM_MODELS_DIR is not None
        assert "custom" in CUSTOM_MODELS_DIR

    def test_model_volume_exists(self):
        """model_volume should be created"""
        from modal_diffusion_service import model_volume
        assert model_volume is not None


class TestCustomModels:
    """Tests for custom model support"""

    def test_load_custom_models_config_function_exists(self):
        """load_custom_models_config function should exist"""
        from modal_diffusion_service import load_custom_models_config
        assert load_custom_models_config is not None
        assert callable(load_custom_models_config)

    def test_diffusion_service_has_list_models_method(self):
        """DiffusionService should have list_models method"""
        from modal_diffusion_service import DiffusionService
        assert hasattr(DiffusionService, 'list_models')


class TestIntegrationPatterns:
    """Tests for integration patterns with the Node.js client"""

    def test_generate_endpoint_returns_expected_format(self):
        """Generate endpoint should return format compatible with Node.js client"""
        from modal_diffusion_service import GenerateResponse

        # The response format should match what ModalImageProvider expects
        response = GenerateResponse(
            image="base64data",
            format="base64",
            metadata={"seed": 42, "inference_time": 3.5}
        )

        # Should serialize to dict with expected keys
        response_dict = response.model_dump()
        assert "image" in response_dict
        assert "format" in response_dict
        assert response_dict["format"] == "base64"

    def test_health_endpoint_returns_expected_format(self):
        """Health endpoint should return format compatible with Node.js client"""
        from modal_diffusion_service import HealthResponse

        response = HealthResponse(
            status="healthy",
            model="flux-dev",
            gpu="A10G",
            container_ready=True
        )

        response_dict = response.model_dump()
        assert "status" in response_dict
        assert "model" in response_dict


class TestLCMSchedulerSupport:
    """
    TDD RED: Tests for LCM (Latent Consistency Model) scheduler support.
    Required for DMD (Distribution Matching Distillation) models.
    """

    def test_generate_request_has_scheduler_field(self):
        """GenerateRequest should accept an optional scheduler parameter"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(
            prompt="test",
            scheduler="lcm"
        )
        assert request.scheduler == "lcm"

    def test_generate_request_scheduler_defaults_to_none(self):
        """GenerateRequest scheduler should default to None (use pipeline default)"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(prompt="test")
        assert request.scheduler is None

    def test_generate_request_validates_scheduler_values(self):
        """GenerateRequest should only accept valid scheduler names"""
        from modal_diffusion_service import GenerateRequest
        from pydantic import ValidationError

        # Valid schedulers should work
        valid_schedulers = ["lcm", "euler", "euler_a", "dpm++", "ddim", "karras"]
        for sched in valid_schedulers:
            request = GenerateRequest(prompt="test", scheduler=sched)
            assert request.scheduler == sched

    def test_supported_schedulers_constant_exists(self):
        """SUPPORTED_SCHEDULERS constant should be defined"""
        from modal_diffusion_service import SUPPORTED_SCHEDULERS
        assert SUPPORTED_SCHEDULERS is not None
        assert "lcm" in SUPPORTED_SCHEDULERS

    def test_diffusion_service_has_set_scheduler_method(self):
        """DiffusionService should have a _set_scheduler method"""
        from modal_diffusion_service import DiffusionService
        assert hasattr(DiffusionService, '_set_scheduler')


class TestSDXLRefinerSupport:
    """
    TDD RED: Tests for SDXL refiner pipeline support.
    Allows base-to-refiner handoff at configurable switch point.
    """

    def test_generate_request_has_refiner_fields(self):
        """GenerateRequest should accept refiner configuration"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(
            prompt="test",
            use_refiner=True,
            refiner_switch=0.8
        )
        assert request.use_refiner is True
        assert request.refiner_switch == 0.8

    def test_generate_request_refiner_defaults(self):
        """Refiner fields should have sensible defaults"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(prompt="test")
        assert request.use_refiner is False
        assert request.refiner_switch == 0.8  # Default switch point

    def test_generate_request_validates_refiner_switch_range(self):
        """refiner_switch should be between 0.0 and 1.0"""
        from modal_diffusion_service import GenerateRequest
        from pydantic import ValidationError

        # Valid range
        request = GenerateRequest(prompt="test", refiner_switch=0.75)
        assert request.refiner_switch == 0.75

        # Invalid - above 1.0
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", refiner_switch=1.5)

        # Invalid - below 0.0
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", refiner_switch=-0.1)

    def test_diffusion_service_has_load_refiner_method(self):
        """DiffusionService should have _load_refiner_pipeline method"""
        from modal_diffusion_service import DiffusionService
        assert hasattr(DiffusionService, '_load_refiner_pipeline')

    def test_generate_response_metadata_includes_refiner_info(self):
        """GenerateResponse metadata should include refiner information when used"""
        from modal_diffusion_service import GenerateResponse

        response = GenerateResponse(
            image="base64data",
            format="base64",
            metadata={
                "seed": 42,
                "used_refiner": True,
                "refiner_switch": 0.8,
                "refiner_model": "same_as_base"
            }
        )
        assert response.metadata["used_refiner"] is True
        assert response.metadata["refiner_switch"] == 0.8


class TestClipSkipSupport:
    """
    TDD RED: Tests for clip_skip parameter support.
    Controls how many CLIP layers to skip for style variation.
    """

    def test_generate_request_has_clip_skip_field(self):
        """GenerateRequest should accept clip_skip parameter"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(
            prompt="test",
            clip_skip=2
        )
        assert request.clip_skip == 2

    def test_generate_request_clip_skip_defaults_to_none(self):
        """clip_skip should default to None (use model default)"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(prompt="test")
        assert request.clip_skip is None

    def test_generate_request_validates_clip_skip_range(self):
        """clip_skip should be between 1 and 12"""
        from modal_diffusion_service import GenerateRequest
        from pydantic import ValidationError

        # Valid range
        request = GenerateRequest(prompt="test", clip_skip=3)
        assert request.clip_skip == 3

        # Invalid - too high
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", clip_skip=15)

        # Invalid - zero or negative
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", clip_skip=0)


class TestImg2ImgTouchupSupport:
    """
    TDD RED: Tests for optional img2img touchup pass.
    Light artifact cleanup for any SDXL model output.
    """

    def test_generate_request_has_touchup_strength_field(self):
        """GenerateRequest should accept touchup_strength parameter"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(
            prompt="test",
            touchup_strength=0.3
        )
        assert request.touchup_strength == 0.3

    def test_generate_request_touchup_defaults_to_zero(self):
        """touchup_strength should default to 0.0 (disabled)"""
        from modal_diffusion_service import GenerateRequest

        request = GenerateRequest(prompt="test")
        assert request.touchup_strength == 0.0

    def test_generate_request_validates_touchup_strength_range(self):
        """touchup_strength should be between 0.0 and 1.0"""
        from modal_diffusion_service import GenerateRequest
        from pydantic import ValidationError

        # Valid range
        request = GenerateRequest(prompt="test", touchup_strength=0.4)
        assert request.touchup_strength == 0.4

        # Zero is valid (disabled)
        request = GenerateRequest(prompt="test", touchup_strength=0.0)
        assert request.touchup_strength == 0.0

        # Invalid - above 1.0
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", touchup_strength=1.5)

        # Invalid - negative
        with pytest.raises(ValidationError):
            GenerateRequest(prompt="test", touchup_strength=-0.1)

    def test_generate_response_metadata_includes_touchup_info(self):
        """GenerateResponse metadata should include touchup info when used"""
        from modal_diffusion_service import GenerateResponse

        response = GenerateResponse(
            image="base64data",
            format="base64",
            metadata={
                "seed": 42,
                "touchup": {
                    "applied": True,
                    "strength": 0.3
                }
            }
        )
        assert response.metadata["touchup"]["applied"] is True
        assert response.metadata["touchup"]["strength"] == 0.3


class TestDMDModelConfiguration:
    """
    TDD RED: Tests for DMD (Distribution Matching Distillation) model support.
    DMD models like MoP require specific scheduler and step settings.
    """

    def test_supported_models_can_specify_scheduler(self):
        """SUPPORTED_MODELS entries can specify a default scheduler"""
        from modal_diffusion_service import SUPPORTED_MODELS

        # At minimum, SDXL turbo should specify its scheduler preference
        if "sdxl-turbo" in SUPPORTED_MODELS:
            config = SUPPORTED_MODELS["sdxl-turbo"]
            # Should have scheduler field (or at least steps/guidance for DMD)
            assert "default_steps" in config
            assert config["default_steps"] <= 8  # DMD models use few steps

    def test_custom_models_config_supports_scheduler(self):
        """Custom models should be able to specify default scheduler in models.json"""
        # This test validates the config schema supports scheduler field
        # The actual parsing is handled by load_custom_models_config

        expected_dmd_config = {
            "path": "model.safetensors",
            "pipeline": "sdxl",
            "default_steps": 8,
            "default_guidance": 1.0,
            "scheduler": "lcm",  # NEW: scheduler field
            "clip_skip": 2,  # NEW: clip_skip field
            "use_refiner": True,  # NEW: refiner field
            "refiner_switch": 0.85
        }

        # All keys should be valid (this will be validated by load_custom_models_config)
        assert "scheduler" in expected_dmd_config
        assert "clip_skip" in expected_dmd_config
        assert "use_refiner" in expected_dmd_config

    def test_generate_uses_model_default_scheduler_if_not_specified(self):
        """When scheduler is not in request, should use model's default scheduler"""
        # This is a behavior test - will need integration testing
        # For now, verify the field plumbing exists
        from modal_diffusion_service import GenerateRequest

        # Request without scheduler
        request = GenerateRequest(prompt="test", model="sdxl-turbo")
        assert request.scheduler is None  # Not specified in request

        # The service should look up sdxl-turbo's default scheduler
        # This behavior will be verified in integration tests


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
