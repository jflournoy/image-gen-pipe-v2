"""
Face Fixing Module

Face enhancement: GFPGAN (with built-in RetinaFace detection) + optional Real-ESRGAN upscaling
"""

import os
import time
import traceback
from typing import Optional, Tuple, Dict, Any
from pathlib import Path

import sys
import numpy as np
import torch
from PIL import Image

# Compatibility shim: torchvision >= 0.20 removed transforms.functional_tensor
# but GFPGAN/basicsr still import from it. Redirect to transforms.functional.
try:
    import torchvision.transforms.functional_tensor  # noqa: F401
except ModuleNotFoundError:
    import torchvision.transforms.functional as _functional
    sys.modules['torchvision.transforms.functional_tensor'] = _functional
    print("[FaceFixing] Applied torchvision.transforms.functional_tensor shim")

# GFPGAN includes RetinaFace for detection + face restoration

try:
    from gfpgan import GFPGANer
    HAS_GFPGAN = True
    print("[FaceFixing] GFPGAN imported successfully")
except Exception as e:
    HAS_GFPGAN = False
    print(f"[FaceFixing] GFPGAN import failed ({type(e).__name__}): {e}")

try:
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer
    HAS_REALESRGAN = True
    print("[FaceFixing] Real-ESRGAN imported successfully")
except Exception as e:
    HAS_REALESRGAN = False
    print(f"[FaceFixing] Real-ESRGAN import failed ({type(e).__name__}): {e}")


class FaceFixingPipeline:
    """
    Face fixing pipeline with lazy model loading.
    Uses GFPGAN (which includes RetinaFace detection) for face enhancement.
    """

    # Model URLs for downloading
    GFPGAN_MODEL_URL = 'https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth'
    REALESRGAN_URLS = {
        2: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth',
        4: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
    }
    # facexlib detection/parsing model URLs (downloaded by GFPGAN internally)
    FACEXLIB_URLS = {
        'detection_Resnet50_Final.pth': 'https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth',
        'parsing_parsenet.pth': 'https://github.com/xinntao/facexlib/releases/download/v0.2.2/parsing_parsenet.pth',
    }

    def __init__(self, device: str = 'cuda', models_dir: Optional[str] = None, cache_dir: Optional[str] = None, **kwargs):
        """
        Initialize face fixing pipeline.

        Args:
            device: 'cuda' or 'cpu' for inference
            models_dir: Directory for persistent model cache (e.g. Modal volume path).
                         If set, models are downloaded here once and reused across restarts.
            cache_dir: Directory for HF model cache (uses HF_HOME or default if None)
        """
        self.device = device if torch.cuda.is_available() else 'cpu'
        self.models_dir = models_dir
        self.cache_dir = cache_dir or str(Path.home() / '.cache' / 'huggingface' / 'hub')

        # Lazy-loaded models
        self.enhancer = None
        self.upsampler = None
        self.enhancer_type = None  # Track which enhancer is loaded

        # Ensure models_dir exists
        if self.models_dir:
            Path(self.models_dir).mkdir(parents=True, exist_ok=True)

        print(f'[FaceFixing] Initialized (device={self.device}, models_dir={self.models_dir})')
        print(f'[FaceFixing] Import status: HAS_GFPGAN={HAS_GFPGAN}, HAS_REALESRGAN={HAS_REALESRGAN}')

        if HAS_GFPGAN:
            print('[FaceFixing] Will use GFPGAN (RetinaFace detection + restoration)')
        else:
            print('[FaceFixing] Warning: GFPGAN not available!')

    def _ensure_model_cached(self, url: str, filename: str) -> str:
        """Download model to models_dir if not already cached. Returns local path."""
        if not self.models_dir:
            return url  # No cache dir — let libraries download to their defaults

        local_path = Path(self.models_dir) / filename
        if local_path.exists():
            size_mb = local_path.stat().st_size / (1024 * 1024)
            print(f'[FaceFixing] Model cached: {filename} ({size_mb:.1f}MB)')
            return str(local_path)

        import urllib.request
        print(f'[FaceFixing] Downloading {filename} to {local_path}...')
        start = time.time()
        urllib.request.urlretrieve(url, str(local_path))
        size_mb = local_path.stat().st_size / (1024 * 1024)
        print(f'[FaceFixing] Downloaded {filename} ({size_mb:.1f}MB) in {time.time() - start:.1f}s')
        return str(local_path)

    def _load_enhancer(self) -> None:
        """Load face enhancement model (GFPGAN only for now)."""
        if self.enhancer is not None:
            return

        # Load GFPGAN (primary face enhancement model)
        if HAS_GFPGAN:
            try:
                print('[FaceFixing] Loading GFPGAN enhancement model...')

                # Cache GFPGAN model
                gfpgan_path = self._ensure_model_cached(
                    self.GFPGAN_MODEL_URL, 'GFPGANv1.3.pth'
                )

                # Cache facexlib detection/parsing models so GFPGAN doesn't re-download.
                # GFPGANer hardcodes model_rootpath='gfpgan/weights' internally,
                # so we symlink cached models there for it to find.
                if self.models_dir:
                    weights_dir = Path(self.models_dir) / 'weights'
                    weights_dir.mkdir(parents=True, exist_ok=True)
                    for fname, url in self.FACEXLIB_URLS.items():
                        self._ensure_model_cached(url, f'weights/{fname}')

                    # Symlink cached models to gfpgan/weights/ (GFPGANer's hardcoded path)
                    gfpgan_weights = Path('gfpgan/weights')
                    gfpgan_weights.mkdir(parents=True, exist_ok=True)
                    for fname in self.FACEXLIB_URLS:
                        src = weights_dir / fname
                        dst = gfpgan_weights / fname
                        if src.exists() and not dst.exists():
                            os.symlink(str(src.resolve()), str(dst))
                            print(f'[FaceFixing] Symlinked {fname} to gfpgan/weights/')

                self.enhancer = GFPGANer(
                    model_path=gfpgan_path,
                    upscale=1,
                    arch='clean',
                    channel_multiplier=2,
                    bg_upsampler=None,
                    device=self.device,
                )
                self.enhancer_type = 'gfpgan'
                print('[FaceFixing] GFPGAN model loaded')
                return
            except Exception as e:
                print(f'[FaceFixing] Warning: Failed to load GFPGAN: {e}')
                print('[FaceFixing] Face enhancement unavailable - will return original image')
                self.enhancer_type = 'none'
                return

        # No enhancement models available - this is not fatal, just skip enhancement
        print('[FaceFixing] No face enhancement model available')
        self.enhancer_type = 'none'

    def _load_upsampler(self, scale: int = 2) -> None:
        """Load Real-ESRGAN upsampler model."""
        if self.upsampler is not None:
            return

        if not HAS_REALESRGAN:
            raise ImportError(
                'Real-ESRGAN not installed. Install with: '
                'pip install realesrgan'
            )

        try:
            print(f'[FaceFixing] Loading Real-ESRGAN {scale}x upsampler...')

            if scale not in self.REALESRGAN_URLS:
                raise ValueError(f'Unsupported scale: {scale}. Supported scales: {list(self.REALESRGAN_URLS.keys())}')

            model_url = self.REALESRGAN_URLS[scale]
            model_filename = f'RealESRGAN_x{scale}plus.pth'
            model_path = self._ensure_model_cached(model_url, model_filename)

            model = RRDBNet(
                num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=scale
            )

            self.upsampler = RealESRGANer(
                scale=scale,
                model_path=model_path,
                model=model,
                tile=512,  # Process in tiles to save VRAM
                tile_pad=10,
                pre_pad=0,
                half=True,  # FP16 for speed
                device=self.device,
            )
            print(f'[FaceFixing] Real-ESRGAN {scale}x upsampler loaded')
        except Exception as e:
            print(f'[FaceFixing] Failed to load Real-ESRGAN upsampler: {e}')
            raise

    def _enhance_faces(self, image_bgr: np.ndarray, fidelity: float = 0.5) -> Tuple[np.ndarray, int]:
        """
        Detect and enhance all faces in image using GFPGAN's full pipeline
        (RetinaFace detection + face restoration + paste-back).

        Args:
            image_bgr: BGR image as numpy array (HxWxC)
            fidelity: Restoration strength (0=more original, 1=more restored)

        Returns:
            Tuple of (enhanced BGR image, number of faces detected)
        """
        self._load_enhancer()

        if self.enhancer_type == 'none' or self.enhancer is None:
            return image_bgr, 0

        # GFPGAN expects BGR input (uses OpenCV/RetinaFace internally)
        with torch.no_grad():
            cropped_faces, restored_faces, restored_bgr = self.enhancer.enhance(
                image_bgr,
                has_aligned=False,
                only_center_face=False,
                paste_back=True,
                weight=fidelity,
            )

        faces_count = len(cropped_faces)

        return restored_bgr, faces_count

    def _upscale_image(self, image: np.ndarray, scale: int = 2) -> np.ndarray:
        """
        Upscale image using Real-ESRGAN.

        Args:
            image: BGR image as numpy array (HxWxC)
            scale: Upscaling factor (2 or 4)

        Returns:
            Upscaled image as numpy array
        """
        self._load_upsampler(scale)

        # Real-ESRGAN expects RGB
        rgb_image = np.flip(image, axis=2)

        # Upscale (returns RGB)
        upscaled_rgb, _ = self.upsampler.enhance(rgb_image)

        # Convert back to BGR
        upscaled_bgr = np.flip(upscaled_rgb, axis=2)

        return upscaled_bgr

    def fix_faces(
        self, image: Image.Image, fidelity: float = 0.5, upscale: int = 1
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        """
        Fix faces in image using GFPGAN (RetinaFace detection + restoration) + optional upscale.

        Args:
            image: PIL Image
            fidelity: Restoration strength (0.0=more original, 1.0=more restored), default 0.5
            upscale: Upscaling factor (1=none, 2=2x), default 1

        Returns:
            Tuple of (enhanced PIL Image, metadata dict)

        Metadata includes:
            - applied: bool (whether face fixing was applied)
            - faces_count: int (number of faces detected by RetinaFace)
            - fidelity: float (fidelity parameter used)
            - upscale: int (upscale factor used)
            - time: float (processing time in seconds)
            - error: str (error message if applicable)
        """
        start_time = time.time()
        metadata = {'fidelity': fidelity, 'upscale': upscale}

        try:
            # Validate parameters
            if not 0.0 <= fidelity <= 1.0:
                raise ValueError(f'fidelity must be between 0.0 and 1.0, got {fidelity}')
            if upscale not in (1, 2):
                raise ValueError(f'upscale must be 1 or 2, got {upscale}')

            # Convert PIL to numpy BGR
            import cv2
            image_np = np.array(image)
            if image_np.shape[2] == 4:
                image_np = image_np[:, :, :3]
            image_bgr = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)

            # Detect + enhance faces via GFPGAN (uses RetinaFace internally)
            print('[FaceFixing] Running GFPGAN (RetinaFace detection + restoration)...')
            enhance_start = time.time()
            enhanced_bgr, faces_count = self._enhance_faces(image_bgr, fidelity)
            enhance_time = time.time() - enhance_start
            print(f'[FaceFixing] Detected {faces_count} faces, enhanced in {enhance_time:.2f}s')

            if faces_count == 0:
                metadata['applied'] = False
                metadata['reason'] = 'no_faces_detected'
                metadata['faces_count'] = 0
                metadata['time'] = time.time() - start_time
                return image, metadata

            # Optional upscaling
            if upscale > 1:
                print(f'[FaceFixing] Upscaling {upscale}x...')
                upscale_start = time.time()
                try:
                    enhanced_bgr = self._upscale_image(enhanced_bgr, upscale)
                    upscale_time = time.time() - upscale_start
                    print(f'[FaceFixing] Upscaled in {upscale_time:.2f}s')
                except Exception as e:
                    print(f'[FaceFixing] Warning: Upscaling failed: {e}')
                    metadata['upscale_error'] = str(e)

            # Convert back to PIL (BGR → RGB)
            enhanced_image = Image.fromarray(cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2RGB))

            total_time = time.time() - start_time
            metadata['applied'] = True
            metadata['faces_count'] = faces_count
            metadata['time'] = total_time
            print(f'[FaceFixing] Complete: {faces_count} face(s) fixed in {total_time:.2f}s')

            return enhanced_image, metadata

        except Exception as e:
            total_time = time.time() - start_time
            print(f'[FaceFixing] Face fixing failed: {e}')
            print(traceback.format_exc())
            metadata['applied'] = False
            metadata['error'] = str(e)
            metadata['time'] = total_time
            return image, metadata


# Singleton instance for Modal service
_face_fixer_instance: Optional[FaceFixingPipeline] = None


def get_face_fixer(device: str = 'cuda', models_dir: Optional[str] = None) -> FaceFixingPipeline:
    """Get or create face fixing pipeline instance (lazy singleton)."""
    global _face_fixer_instance
    if _face_fixer_instance is None:
        _face_fixer_instance = FaceFixingPipeline(device=device, models_dir=models_dir)
    return _face_fixer_instance
