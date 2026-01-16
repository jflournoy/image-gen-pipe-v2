"""
Encoder Loading Module

Provides clean, reusable functions for loading text encoders (CLIP-L, T5-XXL)
and VAE from local safetensors files with graceful fallbacks to HuggingFace.

This module extracts the encoder loading logic from flux_service.py into
reusable, testable components.
"""

import os
import torch
from pathlib import Path
from typing import Optional, List, Callable
from dataclasses import dataclass
from transformers import CLIPTextModel, T5EncoderModel
from diffusers import AutoencoderKL
from safetensors.torch import load_file


@dataclass
class EncoderConfig:
    """
    Configuration for loading a specific encoder type.

    Encapsulates the differences between encoder types (CLIP-L vs T5 vs VAE)
    to allow a generic load_encoder_with_fallbacks() function.
    """
    name: str
    """Human-readable name for logging (e.g., 'CLIP-L', 'T5-XXL')"""

    env_var_path: Optional[str]
    """Environment variable containing local path, or None if not set"""

    local_loader: Callable[[str], torch.nn.Module]
    """Function that loads encoder from local safetensors file path"""

    fallback_chain: List[Callable[[], torch.nn.Module]]
    """Ordered list of fallback loaders, each taking no args"""

    dtype_converter: Optional[Callable[[torch.nn.Module], torch.nn.Module]] = None
    """Optional post-load dtype conversion (e.g., FP8 -> FP16 for T5)"""


def load_clip_from_safetensors(path: str, torch_dtype: torch.dtype) -> CLIPTextModel:
    """
    Load CLIP-L text encoder from local safetensors file.

    Args:
        path: Absolute path to CLIP-L .safetensors file
        torch_dtype: Target dtype (torch.float16 or torch.float32)

    Returns:
        Loaded CLIP-L model

    Raises:
        FileNotFoundError: If path doesn't exist
        Exception: If loading fails (corrupt file, etc.)
    """
    if not Path(path).exists():
        raise FileNotFoundError(f'CLIP-L encoder file not found: {path}')

    try:
        # Load state dict from safetensors file
        state_dict = load_file(path)

        # Create model config from the base model
        text_encoder = CLIPTextModel.from_pretrained(
            'openai/clip-vit-large-patch14',
            torch_dtype=torch_dtype
        )

        # Load the state dict
        text_encoder.load_state_dict(state_dict)

        return text_encoder
    except Exception as e:
        raise Exception(f'Failed to load CLIP-L from {path}: {e}')


def load_t5_from_safetensors(path: str, torch_dtype: torch.dtype) -> T5EncoderModel:
    """
    Load T5-XXL text encoder from local safetensors file.

    T5-XXL requires a config.json in the same directory for proper
    architecture initialization. Also handles FP8 -> FP16 conversion
    since PyTorch doesn't support arithmetic on FP8 tensors.

    Args:
        path: Absolute path to T5-XXL .safetensors file
        torch_dtype: Target dtype (torch.float16 or torch.float32)

    Returns:
        Loaded T5-XXL model converted to target dtype

    Raises:
        FileNotFoundError: If path or config.json doesn't exist
        Exception: If loading fails
    """
    if not Path(path).exists():
        raise FileNotFoundError(f'T5-XXL encoder file not found: {path}')

    # Check for config.json in same directory
    encoder_dir = Path(path).parent
    config_path = encoder_dir / 'config.json'
    if not config_path.exists():
        raise FileNotFoundError(f'T5-XXL config.json not found in {encoder_dir}')

    try:
        # Load state dict from safetensors file
        state_dict = load_file(path)

        # Load model from local config directory
        text_encoder_2 = T5EncoderModel.from_pretrained(
            str(encoder_dir),
            torch_dtype=torch_dtype
        )

        # Load the state dict weights
        text_encoder_2.load_state_dict(state_dict)

        # Convert from FP8 to FP16/FP32 for CUDA compatibility
        # (PyTorch doesn't support arithmetic operations on FP8 tensors)
        text_encoder_2 = text_encoder_2.to(dtype=torch_dtype)

        return text_encoder_2
    except Exception as e:
        raise Exception(f'Failed to load T5-XXL from {path}: {e}')


def load_vae_from_safetensors(path: str, torch_dtype: torch.dtype) -> AutoencoderKL:
    """
    Load VAE (Variational Autoencoder) from local safetensors file.

    Args:
        path: Absolute path to VAE .safetensors file
        torch_dtype: Target dtype (torch.float16 or torch.float32)

    Returns:
        Loaded VAE model

    Raises:
        FileNotFoundError: If path doesn't exist
        Exception: If loading fails
    """
    if not Path(path).exists():
        raise FileNotFoundError(f'VAE encoder file not found: {path}')

    try:
        vae = AutoencoderKL.from_single_file(
            path,
            torch_dtype=torch_dtype
        )
        return vae
    except Exception as e:
        raise Exception(f'Failed to load VAE from {path}: {e}')


def load_encoder_with_fallbacks(
    config: EncoderConfig,
    torch_dtype: torch.dtype
) -> Optional[torch.nn.Module]:
    """
    Load an encoder with configurable fallback chain.

    Implements the pattern:
    1. Try loading from local path (if configured)
    2. Try each fallback loader in order
    3. Log all attempts and failures
    4. Apply dtype converter if provided

    Args:
        config: EncoderConfig specifying loader and fallbacks
        torch_dtype: Target dtype for the encoder

    Returns:
        Loaded encoder module, or None if all methods fail

    Note:
        All exceptions are caught and logged. This provides graceful
        degradation - the service continues even if encoders fail.
    """
    encoder = None

    # Try local path first
    if config.env_var_path:
        try:
            print(f'[Flux Service] Loading {config.name} from local path: {config.env_var_path}')
            # Debug: Check if file exists before attempting load
            path_obj = Path(config.env_var_path)
            if not path_obj.exists():
                raise FileNotFoundError(f'Path does not exist: {config.env_var_path}')
            print(f'[Flux Service] Path verified to exist, loading {config.name}...')
            encoder = config.local_loader(config.env_var_path)
            print(f'[Flux Service] Successfully loaded local {config.name} encoder')

            # Apply dtype conversion if configured
            if config.dtype_converter:
                encoder = config.dtype_converter(encoder)

            return encoder
        except Exception as e:
            print(f'[Flux Service] Failed to load local {config.name}: {e}')
            print(f'[Flux Service] Falling back to HuggingFace {config.name}...')

    # Try fallback chain
    for i, fallback_loader in enumerate(config.fallback_chain):
        try:
            print(f'[Flux Service] Attempting fallback {i+1}/{len(config.fallback_chain)} for {config.name}...')
            encoder = fallback_loader()
            print(f'[Flux Service] Successfully loaded {config.name} from fallback {i+1}')
            return encoder
        except Exception as e:
            if i < len(config.fallback_chain) - 1:
                print(f'[Flux Service] Fallback {i+1} failed ({type(e).__name__}), trying next...')
            else:
                print(f'[Flux Service] All fallbacks exhausted for {config.name}')

    return encoder


def create_clip_fallback_loaders(torch_dtype: torch.dtype) -> List[Callable]:
    """
    Create ordered list of CLIP-L fallback loaders.

    Fallback chain (in order):
    1. SD3-medium (sometimes has better compatibility)
    2. OpenAI CLIP (always available fallback)

    Args:
        torch_dtype: Target dtype for encoders

    Returns:
        List of callables that load CLIP-L model
    """
    return [
        lambda: CLIPTextModel.from_pretrained(
            'stabilityai/stable-diffusion-3-medium',
            subfolder='text_encoders',
            filename='clip_l.safetensors',
            torch_dtype=torch_dtype
        ),
        lambda: CLIPTextModel.from_pretrained(
            'openai/clip-vit-large-patch14',
            torch_dtype=torch_dtype
        ),
    ]


def create_t5_fallback_loaders(torch_dtype: torch.dtype) -> List[Callable]:
    """
    Create ordered list of T5-XXL fallback loaders.

    Fallback chain (in order):
    1. Flux-optimized T5-XXL from comfyanonymous (FP8, best for Flux)
    2. Google's T5-base (always available, less optimal)

    Args:
        torch_dtype: Target dtype for encoders

    Returns:
        List of callables that load T5-XXL model
    """
    return [
        lambda: T5EncoderModel.from_pretrained(
            'comfyanonymous/flux_text_encoders',
            subfolder=None,
            torch_dtype=torch_dtype
        ),
        lambda: T5EncoderModel.from_pretrained(
            'google-t5/t5-base',
            torch_dtype=torch_dtype
        ),
    ]


def create_vae_fallback_loaders(torch_dtype: torch.dtype) -> List[Callable]:
    """
    Create ordered list of VAE fallback loaders.

    Fallback chain (in order):
    1. FLUX.1-dev official VAE (best for Flux models)

    Args:
        torch_dtype: Target dtype for encoders

    Returns:
        List of callables that load VAE model
    """
    return [
        lambda: AutoencoderKL.from_pretrained(
            'black-forest-labs/FLUX.1-dev',
            subfolder='vae',
            torch_dtype=torch_dtype
        ),
    ]


def load_text_encoders(torch_dtype: torch.dtype) -> tuple:
    """
    Load both text encoders (CLIP-L and T5-XXL) with fallback support.

    This is the main helper that flux_service.py calls instead of
    duplicating the encoder loading logic.

    Reads environment variables:
    - FLUX_TEXT_ENCODER_PATH: Local CLIP-L path (optional)
    - FLUX_TEXT_ENCODER_2_PATH: Local T5-XXL path (optional)

    Args:
        torch_dtype: Target dtype for encoders (torch.float16 or torch.float32)

    Returns:
        Tuple of (text_encoder, text_encoder_2)

    Raises:
        Exception: If encoders cannot be loaded
    """
    # Get environment variables
    clip_local_path = os.getenv('FLUX_TEXT_ENCODER_PATH')
    t5_local_path = os.getenv('FLUX_TEXT_ENCODER_2_PATH')

    # Create CLIP-L configuration
    clip_config = EncoderConfig(
        name="CLIP-L",
        env_var_path=clip_local_path,
        local_loader=lambda path: load_clip_from_safetensors(path, torch_dtype),
        fallback_chain=create_clip_fallback_loaders(torch_dtype),
    )

    # Create T5-XXL configuration
    t5_config = EncoderConfig(
        name="T5-XXL",
        env_var_path=t5_local_path,
        local_loader=lambda path: load_t5_from_safetensors(path, torch_dtype),
        fallback_chain=create_t5_fallback_loaders(torch_dtype),
        dtype_converter=lambda encoder: encoder.to(dtype=torch_dtype),
    )

    # Load both with fallbacks
    text_encoder = load_encoder_with_fallbacks(clip_config, torch_dtype)
    text_encoder_2 = load_encoder_with_fallbacks(t5_config, torch_dtype)

    # Validate that encoders were loaded successfully
    if text_encoder is None:
        raise Exception(f'Failed to load CLIP-L encoder after all fallbacks exhausted')
    if text_encoder_2 is None:
        raise Exception(f'Failed to load T5-XXL encoder after all fallbacks exhausted')

    return text_encoder, text_encoder_2


def load_vae_with_fallback(torch_dtype: torch.dtype) -> AutoencoderKL:
    """
    Load VAE with fallback support.

    Reads environment variable:
    - FLUX_VAE_PATH: Local VAE path (optional)

    Args:
        torch_dtype: Target dtype for VAE

    Returns:
        Loaded VAE model

    Raises:
        Exception: If VAE cannot be loaded
    """
    vae_local_path = os.getenv('FLUX_VAE_PATH')

    vae_config = EncoderConfig(
        name="VAE",
        env_var_path=vae_local_path,
        local_loader=lambda path: load_vae_from_safetensors(path, torch_dtype),
        fallback_chain=create_vae_fallback_loaders(torch_dtype),
    )

    vae = load_encoder_with_fallbacks(vae_config, torch_dtype)

    # Validate that VAE was loaded successfully
    if vae is None:
        raise Exception(f'Failed to load VAE after all fallbacks exhausted')

    return vae
