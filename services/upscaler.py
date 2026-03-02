"""
Standalone Upscaler Module

Decoupled from face_fixing.py — upscales entire images without face detection.
Supports Remacri (4x), RealESRGAN x2/x4, and other RRDBNet-based community models.
Uses tiled processing for memory efficiency on 12GB GPUs.
"""

import os
import re
import time
import traceback
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

import numpy as np
import torch
from PIL import Image

try:
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer
    HAS_REALESRGAN = True
except ImportError:
    HAS_REALESRGAN = False


def convert_old_esrgan_keys(old_sd: dict) -> dict:
    """Convert old ESRGAN state dict keys to BasicSR RRDBNet format.

    Old format: model.0.weight, model.1.sub.N.RDBN.convM.0.weight, ...
    New format: conv_first.weight, body.N.rdbN.convM.weight, ...
    """
    new_sd = {}
    for k, v in old_sd.items():
        new_k = k
        # conv_first: model.0 -> conv_first
        new_k = new_k.replace('model.0.', 'conv_first.')
        # conv_body: model.1.sub.23 -> conv_body (the last sub block)
        new_k = new_k.replace('model.1.sub.23.', 'conv_body.')
        # body: model.1.sub.N -> body.N
        new_k = new_k.replace('model.1.sub.', 'body.')
        # RDB blocks: RDBN -> rdbn (lowercase)
        for i in range(1, 4):
            new_k = new_k.replace(f'RDB{i}', f'rdb{i}')
        # conv layers in RDB: convN.0 -> convN (remove extra .0)
        new_k = re.sub(r'\.conv(\d+)\.0\.', r'.conv\1.', new_k)
        # upconv: model.3 -> conv_up1, model.6 -> conv_up2
        new_k = new_k.replace('model.3.', 'conv_up1.')
        new_k = new_k.replace('model.6.', 'conv_up2.')
        # HRconv: model.8 -> conv_hr
        new_k = new_k.replace('model.8.', 'conv_hr.')
        # last conv: model.10 -> conv_last
        new_k = new_k.replace('model.10.', 'conv_last.')
        new_sd[new_k] = v
    return new_sd


# Default models directory (relative to this file)
_DEFAULT_MODELS_DIR = str(Path(__file__).parent / 'models' / 'upscaler')


class UpscalerPipeline:
    """
    Standalone upscaling pipeline with lazy model loading.
    Uses RRDBNet architecture with tiled processing for memory efficiency.
    Default model: Remacri 4x (same architecture as RealESRGAN_x4plus).
    """

    MODELS = {
        'remacri': {
            'scale': 4,
            'filename': '4x_foolhardy_Remacri.pth',
            'old_esrgan_format': True,
        },
        'remacri-smooth': {
            'scale': 4,
            'filename': '4x_foolhardy_Remacri_ExtraSmoother.pth',
            'old_esrgan_format': True,
        },
        'realesrgan-x4': {
            'scale': 4,
            'filename': 'RealESRGAN_x4plus.pth',
            'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
            'old_esrgan_format': False,
        },
        'realesrgan-x2': {
            'scale': 2,
            'filename': 'RealESRGAN_x2plus.pth',
            'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth',
            'old_esrgan_format': False,
        },
    }

    DEFAULT_MODEL = 'remacri'

    def __init__(self, device: str = 'cuda', models_dir: Optional[str] = None):
        self.device = device if torch.cuda.is_available() else 'cpu'
        self.models_dir = models_dir or os.environ.get(
            'UPSCALER_MODELS_DIR', _DEFAULT_MODELS_DIR
        )
        self.upsampler = None
        self._current_model = None

    def _resolve_model_path(self, config: dict) -> str:
        """Resolve model file path, downloading if needed and possible."""
        model_path = os.path.join(self.models_dir, config['filename'])

        if os.path.exists(model_path):
            return model_path

        # Try auto-download for models with URLs
        if 'url' in config:
            os.makedirs(self.models_dir, exist_ok=True)
            print(f'[Upscaler] Downloading {config["filename"]}...')
            start = time.time()
            from basicsr.utils.download_util import load_file_from_url
            downloaded = load_file_from_url(
                url=config['url'],
                model_dir=self.models_dir,
                progress=True,
                file_name=config['filename'],
            )
            elapsed = time.time() - start
            size_mb = os.path.getsize(downloaded) / (1024 * 1024)
            print(f'[Upscaler] Downloaded {config["filename"]} ({size_mb:.1f}MB) in {elapsed:.1f}s')
            return downloaded

        raise FileNotFoundError(
            f'Model file not found: {model_path}\n'
            f'Place {config["filename"]} in {self.models_dir}'
        )

    def _load_model(self, model_name: str) -> None:
        """Load upscaler model. Reinitializes if model changes."""
        if not HAS_REALESRGAN:
            raise ImportError(
                'Real-ESRGAN not installed. Install with: pip install realesrgan'
            )

        config = self.MODELS[model_name]
        scale = config['scale']
        model_path = self._resolve_model_path(config)

        model = RRDBNet(
            num_in_ch=3, num_out_ch=3, num_feat=64,
            num_block=23, num_grow_ch=32, scale=scale,
        )

        if config.get('old_esrgan_format'):
            # Remacri and similar community models use old ESRGAN key format
            print(f'[Upscaler] Loading {config["filename"]} (old ESRGAN format, converting keys)...')
            old_sd = torch.load(model_path, map_location='cpu')
            new_sd = convert_old_esrgan_keys(old_sd)
            model.load_state_dict(new_sd, strict=True)
            model.eval()

            # Create RealESRGANer with pre-loaded model
            # Pass a dummy model_path that won't be loaded — we override the model after
            self.upsampler = RealESRGANer.__new__(RealESRGANer)
            self.upsampler.scale = scale
            self.upsampler.tile_size = 512
            self.upsampler.tile_pad = 10
            self.upsampler.pre_pad = 0
            self.upsampler.mod_scale = None
            self.upsampler.half = True
            self.upsampler.device = torch.device(self.device)
            self.upsampler.model = model.to(self.upsampler.device)
            if self.upsampler.half:
                self.upsampler.model = self.upsampler.model.half()
        else:
            # Standard RealESRGAN .pth with params/params_ema keys
            print(f'[Upscaler] Loading {config["filename"]}...')
            self.upsampler = RealESRGANer(
                scale=scale,
                model_path=model_path,
                model=model,
                tile=512,
                tile_pad=10,
                pre_pad=0,
                half=True,
                device=self.device,
            )

        self._current_model = model_name
        print(f'[Upscaler] {config["filename"]} ({scale}x) loaded on {self.device}')

    def upscale(
        self,
        image: Image.Image,
        model_name: Optional[str] = None,
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        """Upscale an image.

        Args:
            image: PIL Image input (RGB or RGBA)
            model_name: Which upscaler model to use (default: remacri)

        Returns:
            Tuple of (upscaled PIL Image, metadata dict)
        """
        if model_name is None:
            model_name = self.DEFAULT_MODEL

        if model_name not in self.MODELS:
            raise ValueError(
                f'Unknown upscaler model: {model_name}. '
                f'Available: {list(self.MODELS.keys())}'
            )

        # Load model if needed (lazy loading / model switch)
        if self.upsampler is None or self._current_model != model_name:
            self._load_model(model_name)

        config = self.MODELS[model_name]
        start = time.time()

        # Convert PIL -> numpy BGR (what RealESRGANer expects)
        input_array = np.array(image)
        if input_array.shape[-1] == 4:
            input_array = input_array[:, :, :3]  # Strip alpha
        image_bgr = input_array[:, :, ::-1].copy()  # RGB -> BGR

        # Upscale
        with torch.no_grad():
            output_bgr, _ = self.upsampler.enhance(image_bgr, outscale=config['scale'])

        # Convert BGR -> RGB -> PIL
        output_rgb = output_bgr[:, :, ::-1].copy()
        result = Image.fromarray(output_rgb)

        elapsed = time.time() - start
        h_in, w_in = input_array.shape[:2]
        h_out, w_out = output_bgr.shape[:2]

        metadata = {
            'model': model_name,
            'scale': config['scale'],
            'time': round(elapsed, 2),
            'input_size': [w_in, h_in],
            'output_size': [w_out, h_out],
        }

        print(f'[Upscaler] {w_in}x{h_in} -> {w_out}x{h_out} '
              f'({config["scale"]}x, {model_name}) in {elapsed:.2f}s')

        return result, metadata


# Singleton
_upscaler_instance: Optional[UpscalerPipeline] = None


def get_upscaler(
    device: str = 'cuda',
    models_dir: Optional[str] = None,
) -> UpscalerPipeline:
    """Get or create the singleton UpscalerPipeline instance."""
    global _upscaler_instance
    if _upscaler_instance is None:
        _upscaler_instance = UpscalerPipeline(device=device, models_dir=models_dir)
    return _upscaler_instance


def reset_upscaler() -> None:
    """Reset the singleton instance (for testing/cleanup)."""
    global _upscaler_instance
    _upscaler_instance = None
