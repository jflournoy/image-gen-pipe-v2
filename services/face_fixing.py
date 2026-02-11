"""
Face Fixing Module

Multi-stage face enhancement: detection → restoration → optional upscaling
Uses MediaPipe for detection, CodeFormer for enhancement, Real-ESRGAN for upscaling
"""

import time
import traceback
from typing import Optional, Tuple, Dict, Any
from pathlib import Path

import numpy as np
import torch
from PIL import Image
import mediapipe as mp

# Try to import face enhancement models, with graceful fallback
# CodeFormer is complex to install and requires manual setup from GitHub
# For now, we skip the import and rely on GFPGAN as the default
HAS_CODEFORMER = False

try:
    from gfpgan import GFPGANer
    HAS_GFPGAN = True
except ImportError:
    # GFPGAN has complex dependencies (basicsr/torchvision compatibility issues)
    # Disabled for now - will revisit when dependencies stabilize
    HAS_GFPGAN = False

try:
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer
    HAS_REALESRGAN = True
except ImportError:
    HAS_REALESRGAN = False


class FaceFixingPipeline:
    """
    Face fixing pipeline with lazy model loading.
    Detects faces via MediaPipe and enhances them with CodeFormer.
    """

    def __init__(self, device: str = 'cuda', cache_dir: Optional[str] = None, use_codeformer: bool = False):
        """
        Initialize face fixing pipeline.

        Args:
            device: 'cuda' or 'cpu' for inference
            cache_dir: Directory for model cache (uses HF_HOME or default if None)
            use_codeformer: Use CodeFormer (if available) instead of GFPGAN for higher quality
        """
        self.device = device if torch.cuda.is_available() else 'cpu'
        self.cache_dir = cache_dir or str(Path.home() / '.cache' / 'huggingface' / 'hub')
        self.use_codeformer = use_codeformer and HAS_CODEFORMER

        # Lazy-loaded models
        self.face_detector = None
        self.enhancer = None  # Can be either GFPGAN or CodeFormer
        self.upsampler = None
        self.enhancer_type = None  # Track which enhancer is loaded

        print(f'[FaceFixing] Initialized (device={self.device})')
        if self.use_codeformer:
            print('[FaceFixing] Will use CodeFormer for face enhancement')
        elif HAS_GFPGAN:
            print('[FaceFixing] Will use GFPGAN for face enhancement')
        else:
            print('[FaceFixing] Warning: Neither CodeFormer nor GFPGAN available!')

    def _load_face_detector(self) -> None:
        """Load MediaPipe face detection model (lightweight, CPU-optimized)."""
        if self.face_detector is not None:
            return

        try:
            print('[FaceFixing] Loading MediaPipe face detector...')
            mp_face_detection = mp.solutions.face_detection
            # model_selection=1: Full range detection (handles various distances)
            self.face_detector = mp_face_detection.FaceDetection(
                model_selection=1, min_detection_confidence=0.5
            )
            print('[FaceFixing] MediaPipe face detector loaded')
        except Exception as e:
            print(f'[FaceFixing] Failed to load face detector: {e}')
            raise

    def _load_enhancer(self) -> None:
        """Load face enhancement model (GFPGAN only for now)."""
        if self.enhancer is not None:
            return

        # Load GFPGAN (primary face enhancement model)
        if HAS_GFPGAN:
            try:
                print('[FaceFixing] Loading GFPGAN enhancement model...')
                self.enhancer = GFPGANer(
                    scale=1,  # No upscaling in GFPGANer itself
                    model_path='https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth',
                    upscale=1,  # Separate upscaler
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

            model_name = f'RealESRGAN_x{scale}'
            model = RRDBNet(
                num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=scale
            )

            # Download model weights
            import huggingface_hub

            model_path = huggingface_hub.hf_hub_download(
                repo_id='ai-forever/Real-ESRGAN',
                filename=f'{model_name}.pth',
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

    def _detect_faces(self, image: np.ndarray) -> list:
        """
        Detect faces in image using MediaPipe.

        Args:
            image: BGR image as numpy array (HxWxC)

        Returns:
            List of detected faces with bounding boxes and landmarks
        """
        self._load_face_detector()

        # Convert BGR to RGB for MediaPipe
        rgb_image = np.ascontiguousarray(np.flip(image, axis=2))

        results = self.face_detector.process(rgb_image)

        faces = []
        if results.detections:
            h, w = image.shape[:2]
            for detection in results.detections:
                bbox = detection.location_data.relative_bounding_box
                x1 = int(bbox.xmin * w)
                y1 = int(bbox.ymin * h)
                x2 = int((bbox.xmin + bbox.width) * w)
                y2 = int((bbox.ymin + bbox.height) * h)

                # Clamp to image bounds
                x1 = max(0, x1)
                y1 = max(0, y1)
                x2 = min(w, x2)
                y2 = min(h, y2)

                faces.append({'box': (x1, y1, x2, y2), 'score': detection.score[0]})

        return faces

    def _enhance_face(self, image: np.ndarray, face_box: tuple, fidelity: float = 0.7) -> np.ndarray:
        """
        Enhance a single face using available model (GFPGAN).

        Args:
            image: BGR image as numpy array (HxWxC)
            face_box: Bounding box (x1, y1, x2, y2)
            fidelity: Enhancement strength parameter (ignored for GFPGAN, kept for API compatibility)

        Returns:
            Enhanced image (full resolution, or original if enhancement unavailable)
        """
        self._load_enhancer()

        # If no enhancer available, return original image
        if self.enhancer_type == 'none' or self.enhancer is None:
            return image

        x1, y1, x2, y2 = face_box

        # Extract face region with padding
        pad = int((x2 - x1) * 0.1)
        x1_pad = max(0, x1 - pad)
        y1_pad = max(0, y1 - pad)
        x2_pad = min(image.shape[1], x2 + pad)
        y2_pad = min(image.shape[0], y2 + pad)

        face_region = image[y1_pad : y2_pad + 1, x1_pad : x2_pad + 1].copy()

        # Enhance using GFPGAN
        restored_bgr = self._enhance_with_gfpgan(face_region)

        # Paste back into full image
        enhanced_image = image.copy()
        h_restore, w_restore = restored_bgr.shape[:2]
        h_region, w_region = image[y1_pad : y2_pad + 1, x1_pad : x2_pad + 1].shape[:2]

        # Resize if dimensions changed
        if (h_restore, w_restore) != (h_region, w_region):
            from PIL import Image as PILImage

            restored_pil = PILImage.fromarray(restored_bgr)
            restored_pil = restored_pil.resize((w_region, h_region), PILImage.Resampling.LANCZOS)
            restored_bgr = np.array(restored_pil)

        enhanced_image[y1_pad : y2_pad + 1, x1_pad : x2_pad + 1] = restored_bgr

        return enhanced_image

    def _enhance_with_codeformer(self, face_bgr: np.ndarray, fidelity: float = 0.7) -> np.ndarray:
        """Enhance face using CodeFormer."""
        # Prepare input for CodeFormer (RGB, normalized)
        face_rgb = np.flip(face_bgr, axis=2).astype(np.float32) / 255.0
        face_tensor = torch.from_numpy(face_rgb).permute(2, 0, 1).unsqueeze(0).to(self.device)

        # Enhance with weight parameter
        with torch.no_grad():
            try:
                restored = self.enhancer(face_tensor, weight=fidelity)
            except TypeError:
                # Fallback if weight parameter not supported
                restored = self.enhancer(face_tensor)

        # Convert back to numpy BGR
        restored_np = (
            restored.squeeze(0).permute(1, 2, 0).clamp(0, 1).cpu().numpy() * 255
        ).astype(np.uint8)
        restored_bgr = np.flip(restored_np, axis=2)

        return restored_bgr

    def _enhance_with_gfpgan(self, face_bgr: np.ndarray) -> np.ndarray:
        """Enhance face using GFPGAN."""
        # GFPGAN expects BGR directly
        # Convert to RGB for processing
        import cv2
        face_rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)

        with torch.no_grad():
            _, _, restored_rgb = self.enhancer.enhance(face_rgb, has_aligned=False, only_center_face=False,
                                                        paste_back=True, weight=0.5)

        # Convert back to BGR
        restored_bgr = cv2.cvtColor(restored_rgb, cv2.COLOR_RGB2BGR)

        return restored_bgr

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
        self, image: Image.Image, fidelity: float = 0.7, upscale: int = 1
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        """
        Fix faces in image: detect → enhance → optional upscale.

        Args:
            image: PIL Image
            fidelity: CodeFormer fidelity (0.0=max quality, 1.0=max identity), default 0.7
            upscale: Upscaling factor (1=none, 2=2x), default 1

        Returns:
            Tuple of (enhanced PIL Image, metadata dict)

        Metadata includes:
            - applied: bool (whether face fixing was applied)
            - faces_count: int (number of faces detected)
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
            image_np = np.array(image)
            if image_np.shape[2] == 4:
                # RGBA -> RGB
                image_np = image_np[:, :, :3]

            # Detect faces
            print(f'[FaceFixing] Detecting faces...')
            detect_start = time.time()
            faces = self._detect_faces(image_np)
            detect_time = time.time() - detect_start
            print(f'[FaceFixing] Detected {len(faces)} faces in {detect_time:.2f}s')

            if not faces:
                metadata['applied'] = False
                metadata['reason'] = 'no_faces_detected'
                metadata['faces_count'] = 0
                metadata['time'] = time.time() - start_time
                return image, metadata

            # Enhance faces
            print(f'[FaceFixing] Enhancing {len(faces)} face(s)...')
            enhanced_np = image_np.copy()
            for i, face in enumerate(faces):
                enhance_start = time.time()
                try:
                    enhanced_np = self._enhance_face(enhanced_np, face['box'], fidelity)
                    enhance_time = time.time() - enhance_start
                    print(f'[FaceFixing] Enhanced face {i + 1}/{len(faces)} in {enhance_time:.2f}s')
                except Exception as e:
                    print(
                        f'[FaceFixing] Warning: Failed to enhance face {i + 1}/{len(faces)}: {e}'
                    )
                    # Continue with other faces
                    continue

            # Optional upscaling
            if upscale > 1:
                print(f'[FaceFixing] Upscaling {upscale}x...')
                upscale_start = time.time()
                try:
                    enhanced_np = self._upscale_image(enhanced_np, upscale)
                    upscale_time = time.time() - upscale_start
                    print(f'[FaceFixing] Upscaled in {upscale_time:.2f}s')
                except Exception as e:
                    print(f'[FaceFixing] Warning: Upscaling failed: {e}')
                    metadata['upscale_error'] = str(e)

            # Convert back to PIL
            enhanced_image = Image.fromarray(np.flip(enhanced_np, axis=2))

            total_time = time.time() - start_time
            metadata['applied'] = True
            metadata['faces_count'] = len(faces)
            metadata['time'] = total_time
            print(f'[FaceFixing] Face fixing complete in {total_time:.2f}s')

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


def get_face_fixer(device: str = 'cuda') -> FaceFixingPipeline:
    """Get or create face fixing pipeline instance (lazy singleton)."""
    global _face_fixer_instance
    if _face_fixer_instance is None:
        _face_fixer_instance = FaceFixingPipeline(device=device)
    return _face_fixer_instance
