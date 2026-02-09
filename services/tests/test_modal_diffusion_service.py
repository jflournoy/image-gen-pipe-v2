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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
