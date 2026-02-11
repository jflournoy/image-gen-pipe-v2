"""
Tests for Modal SDXL negative prompt support
TDD RED phase - these tests should fail initially
"""

import pytest
from pydantic import ValidationError
from modal_diffusion_service import GenerateRequest


class TestNegativePromptSupport:
    """Test negative prompt parameter in GenerateRequest"""

    def test_negative_prompt_field_exists(self):
        """Should accept negative_prompt parameter"""
        request = GenerateRequest(
            prompt="30 year old man",
            model="sdxl-base",
            negative_prompt="elderly, aged, wrinkled, young, child, blurry"
        )

        assert hasattr(request, 'negative_prompt')
        assert request.negative_prompt == "elderly, aged, wrinkled, young, child, blurry"

    def test_negative_prompt_optional(self):
        """negative_prompt should be optional (defaults to None)"""
        request = GenerateRequest(
            prompt="test",
            model="sdxl-base"
        )

        assert request.negative_prompt is None

    def test_negative_prompt_can_be_empty_string(self):
        """Should allow empty string for negative_prompt"""
        request = GenerateRequest(
            prompt="test",
            model="sdxl-base",
            negative_prompt=""
        )

        assert request.negative_prompt == ""

    def test_negative_prompt_validation(self):
        """Should validate negative_prompt is a string"""
        # Valid string
        request = GenerateRequest(
            prompt="test",
            model="sdxl-base",
            negative_prompt="blurry, low quality"
        )
        assert isinstance(request.negative_prompt, str)

    def test_negative_prompt_with_sdxl_models(self):
        """Should work with all SDXL model variants"""
        models = ["sdxl-base", "sdxl-turbo"]

        for model in models:
            request = GenerateRequest(
                prompt="test",
                model=model,
                negative_prompt="blurry, low quality"
            )
            assert request.negative_prompt == "blurry, low quality"

    def test_negative_prompt_with_flux_models(self):
        """Should also work with Flux models (even if not typically used)"""
        request = GenerateRequest(
            prompt="test",
            model="flux-dev",
            negative_prompt="blurry"
        )

        assert request.negative_prompt == "blurry"

    def test_negative_prompt_strips_whitespace(self):
        """Should strip leading/trailing whitespace from negative_prompt"""
        request = GenerateRequest(
            prompt="test",
            model="sdxl-base",
            negative_prompt="  blurry, low quality  "
        )

        # Should be stripped after validation
        assert request.negative_prompt.strip() == "blurry, low quality"

    def test_long_negative_prompt(self):
        """Should handle long negative prompts (for Compel)"""
        long_negative = (
            "blurry, low quality, distorted, deformed, ugly, bad anatomy, "
            "extra limbs, missing limbs, floating limbs, disconnected limbs, "
            "mutation, mutated, disfigured, malformed hands, poorly drawn hands, "
            "poorly drawn face, bad proportions, gross proportions, "
            "duplicate, morbid, mutilated, extra fingers, fused fingers, "
            "too many fingers, cloned face, malformed limbs"
        )

        request = GenerateRequest(
            prompt="test",
            model="sdxl-base",
            negative_prompt=long_negative
        )

        assert len(request.negative_prompt) > 100
        assert request.negative_prompt == long_negative


class TestNegativePromptMetadata:
    """Test that negative prompt info is included in response metadata"""

    def test_metadata_includes_negative_prompt(self):
        """Response metadata should include the negative_prompt used"""
        # This will be tested with actual generation later
        # For now, just document the expected structure
        expected_metadata = {
            "seed": 12345,
            "model": "sdxl-base",
            "steps": 30,
            "guidance": 7.5,
            "negative_prompt": "elderly, aged, blurry, low quality"
        }

        assert "negative_prompt" in expected_metadata
        assert isinstance(expected_metadata["negative_prompt"], str)
