#!/usr/bin/env python3
"""
Modal Model Manager
Upload and manage custom diffusion models on Modal volumes.

Supports: Flux, SDXL, SD3, Chroma (images), WAN (video)

Usage:
    # Upload a local image model (Chroma, SDXL, Flux, etc)
    python modal_model_manager.py upload /path/to/chroma-model.safetensors \
        --name my-chroma --pipeline chroma --steps 20 --guidance 7.5

    # Upload a custom video model (WAN I2V)
    python modal_model_manager.py upload /path/to/wan-custom.safetensors \
        --name my-custom-video --pipeline wan_i2v --steps 30 --guidance 4.0

    # Download from CivitAI (specify pipeline type)
    python modal_model_manager.py download-civitai \
        https://civitai.com/api/download/models/12345 \
        --name civitai-chroma --pipeline chroma

    # List all models
    python modal_model_manager.py list

    # Delete a model
    python modal_model_manager.py delete my-model

    # Show volume usage
    python modal_model_manager.py usage

Pipeline types:
    Image generation:
        - flux: Flux.1 (dev/schnell)
        - sdxl: Stable Diffusion XL
        - sdxl_flow: SDXL with Flow Matching (e.g., BigASP)
        - sd3: Stable Diffusion 3
        - chroma: Chroma1-HD

    Video generation:
        - wan_i2v: WAN2.2 image-to-video
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional, Dict, Any

import modal

# Import constants from diffusion service
VOLUME_NAME = "diffusion-models"
MODELS_DIR = "/models"
CUSTOM_MODELS_DIR = f"{MODELS_DIR}/custom"

# Create/get the volume
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# Modal app for running functions
app = modal.App("model-manager")

# Simple image for model management
manager_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "requests>=2.31.0",
    "tqdm>=4.66.0",
)


def parse_civitai_url(url: str) -> Dict[str, Any]:
    """Parse CivitAI URL to extract model info"""
    # Pattern: https://civitai.com/api/download/models/{modelVersionId}
    # Or: https://civitai.com/models/{modelId}?modelVersionId={versionId}

    api_pattern = r"civitai\.com/api/download/models/(\d+)"
    page_pattern = r"civitai\.com/models/(\d+)"
    version_pattern = r"modelVersionId=(\d+)"

    api_match = re.search(api_pattern, url)
    if api_match:
        return {
            "version_id": api_match.group(1),
            "download_url": url,
        }

    page_match = re.search(page_pattern, url)
    version_match = re.search(version_pattern, url)

    if page_match:
        model_id = page_match.group(1)
        version_id = version_match.group(1) if version_match else None
        return {
            "model_id": model_id,
            "version_id": version_id,
            "download_url": f"https://civitai.com/api/download/models/{version_id}" if version_id else None,
        }

    return {"url": url}


@app.function(
    image=manager_image,
    volumes={MODELS_DIR: volume},
    timeout=3600,  # 1 hour for large downloads
)
def upload_model(
    local_path: str,
    name: str,
    pipeline: str = "sdxl",
    base_model: Optional[str] = None,
    default_steps: int = 25,
    default_guidance: float = 7.5,
) -> Dict[str, Any]:
    """Upload a local model file to the Modal volume"""
    import shutil

    source = Path(local_path)
    if not source.exists():
        raise FileNotFoundError(f"Model file not found: {local_path}")

    # Create custom models directory
    custom_dir = Path(CUSTOM_MODELS_DIR)
    custom_dir.mkdir(parents=True, exist_ok=True)

    # Copy model to volume
    dest_filename = f"{name}{source.suffix}"
    dest_path = custom_dir / dest_filename

    print(f"Copying {source} to {dest_path}...")
    shutil.copy2(str(source), str(dest_path))

    # Update models.json
    config_path = custom_dir / "models.json"
    if config_path.exists():
        with open(config_path, "r") as f:
            models = json.load(f)
    else:
        models = {}

    models[name] = {
        "path": dest_filename,
        "pipeline": pipeline,
        "custom": True,
        "default_steps": default_steps,
        "default_guidance": default_guidance,
    }

    if base_model:
        models[name]["base_model"] = base_model

    with open(config_path, "w") as f:
        json.dump(models, f, indent=2)

    # Commit changes
    volume.commit()

    print(f"Model '{name}' uploaded successfully!")
    return {"name": name, "path": str(dest_path), "config": models[name]}


@app.function(
    image=manager_image,
    volumes={MODELS_DIR: volume},
    timeout=7200,  # 2 hours for large downloads
)
def download_from_civitai(
    url: str,
    name: str,
    pipeline: str = "sdxl",
    base_model: Optional[str] = None,
    default_steps: int = 25,
    default_guidance: float = 7.5,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Download a model from CivitAI and store in volume"""
    import requests
    from tqdm import tqdm

    # Parse URL
    parsed = parse_civitai_url(url)
    download_url = parsed.get("download_url", url)

    if not download_url:
        raise ValueError(f"Could not parse CivitAI URL: {url}")

    print(f"Downloading from: {download_url}")

    # Create custom models directory
    custom_dir = Path(CUSTOM_MODELS_DIR)
    custom_dir.mkdir(parents=True, exist_ok=True)

    # Set up headers
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Download with progress
    response = requests.get(download_url, headers=headers, stream=True)
    response.raise_for_status()

    # Get filename from headers or use default
    content_disposition = response.headers.get("content-disposition", "")
    if "filename=" in content_disposition:
        filename = re.findall(r'filename="?([^";\s]+)"?', content_disposition)[0]
    else:
        filename = f"{name}.safetensors"

    dest_path = custom_dir / filename
    total_size = int(response.headers.get("content-length", 0))

    print(f"Downloading to: {dest_path} ({total_size / 1e9:.2f} GB)")

    with open(dest_path, "wb") as f:
        with tqdm(total=total_size, unit="B", unit_scale=True, desc=name) as pbar:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                pbar.update(len(chunk))

    # Update models.json
    config_path = custom_dir / "models.json"
    if config_path.exists():
        with open(config_path, "r") as f:
            models = json.load(f)
    else:
        models = {}

    models[name] = {
        "path": filename,
        "pipeline": pipeline,
        "custom": True,
        "default_steps": default_steps,
        "default_guidance": default_guidance,
        "source": "civitai",
        "source_url": url,
    }

    if base_model:
        models[name]["base_model"] = base_model

    with open(config_path, "w") as f:
        json.dump(models, f, indent=2)

    # Commit changes
    volume.commit()

    print(f"Model '{name}' downloaded and saved successfully!")
    return {"name": name, "path": str(dest_path), "config": models[name]}


@app.function(
    image=manager_image,
    volumes={MODELS_DIR: volume},
)
def list_models() -> Dict[str, Any]:
    """List all models in the volume"""
    custom_dir = Path(CUSTOM_MODELS_DIR)
    config_path = custom_dir / "models.json"

    result = {
        "custom_models": {},
        "files": [],
        "cache_size": 0,
    }

    # Load custom models config
    if config_path.exists():
        with open(config_path, "r") as f:
            result["custom_models"] = json.load(f)

    # List files in custom directory
    if custom_dir.exists():
        for f in custom_dir.iterdir():
            if f.is_file() and f.suffix in [".safetensors", ".ckpt", ".pt"]:
                result["files"].append({
                    "name": f.name,
                    "size": f.stat().st_size,
                    "size_gb": f.stat().st_size / 1e9,
                })

    # Check HuggingFace cache size
    cache_dir = Path(f"{MODELS_DIR}/huggingface")
    if cache_dir.exists():
        total_size = sum(f.stat().st_size for f in cache_dir.rglob("*") if f.is_file())
        result["cache_size"] = total_size
        result["cache_size_gb"] = total_size / 1e9

    return result


@app.function(
    image=manager_image,
    volumes={MODELS_DIR: volume},
)
def delete_model(name: str) -> Dict[str, Any]:
    """Delete a custom model from the volume"""
    custom_dir = Path(CUSTOM_MODELS_DIR)
    config_path = custom_dir / "models.json"

    if not config_path.exists():
        return {"error": "No custom models found"}

    with open(config_path, "r") as f:
        models = json.load(f)

    if name not in models:
        return {"error": f"Model '{name}' not found"}

    # Get model path
    model_path = custom_dir / models[name]["path"]

    # Delete model file
    if model_path.exists():
        model_path.unlink()
        print(f"Deleted model file: {model_path}")

    # Remove from config
    del models[name]

    with open(config_path, "w") as f:
        json.dump(models, f, indent=2)

    # Commit changes
    volume.commit()

    return {"deleted": name}


@app.function(
    image=manager_image,
    volumes={MODELS_DIR: volume},
)
def get_volume_usage() -> Dict[str, Any]:
    """Get volume usage statistics"""
    models_dir = Path(MODELS_DIR)

    total_size = 0
    file_count = 0
    breakdown = {}

    for subdir in models_dir.iterdir():
        if subdir.is_dir():
            dir_size = sum(f.stat().st_size for f in subdir.rglob("*") if f.is_file())
            dir_count = sum(1 for f in subdir.rglob("*") if f.is_file())
            breakdown[subdir.name] = {
                "size": dir_size,
                "size_gb": dir_size / 1e9,
                "files": dir_count,
            }
            total_size += dir_size
            file_count += dir_count

    return {
        "total_size": total_size,
        "total_size_gb": total_size / 1e9,
        "file_count": file_count,
        "breakdown": breakdown,
    }


@app.local_entrypoint()
def main():
    """CLI for model management"""
    # Load environment variables from parent directory's .env file
    from pathlib import Path
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())

    parser = argparse.ArgumentParser(description="Modal Model Manager")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Upload command
    upload_parser = subparsers.add_parser("upload", help="Upload a local model")
    upload_parser.add_argument("path", help="Path to model file")
    upload_parser.add_argument("--name", required=True, help="Name for the model")
    upload_parser.add_argument(
        "--pipeline",
        default="sdxl",
        choices=["flux", "sdxl", "sdxl_flow", "sd3", "chroma", "wan_i2v"],
        help="Pipeline type (image: flux/sdxl/sdxl_flow/sd3/chroma, video: wan_i2v)"
    )
    upload_parser.add_argument("--base-model", help="Base model for custom weights")
    upload_parser.add_argument("--steps", type=int, default=25, help="Default inference steps")
    upload_parser.add_argument("--guidance", type=float, default=7.5, help="Default guidance scale")

    # CivitAI download command
    civitai_parser = subparsers.add_parser("download-civitai", help="Download from CivitAI")
    civitai_parser.add_argument("url", help="CivitAI model URL or download URL")
    civitai_parser.add_argument("--name", required=True, help="Name for the model")
    civitai_parser.add_argument(
        "--pipeline",
        default="sdxl",
        choices=["flux", "sdxl", "sdxl_flow", "sd3", "chroma", "wan_i2v"],
        help="Pipeline type (image: flux/sdxl/sdxl_flow/sd3/chroma, video: wan_i2v)"
    )
    civitai_parser.add_argument("--base-model", help="Base model for custom weights")
    civitai_parser.add_argument("--steps", type=int, default=25, help="Default inference steps")
    civitai_parser.add_argument("--guidance", type=float, default=7.5, help="Default guidance scale")
    civitai_parser.add_argument("--api-key", default=os.getenv("CIVIT_API_KEY"), help="CivitAI API key (defaults to CIVIT_API_KEY env var)")

    # List command
    subparsers.add_parser("list", help="List models in volume")

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a model")
    delete_parser.add_argument("name", help="Name of model to delete")

    # Usage command
    subparsers.add_parser("usage", help="Show volume usage")

    args = parser.parse_args()

    if args.command == "upload":
        result = upload_model.remote(
            local_path=args.path,
            name=args.name,
            pipeline=args.pipeline,
            base_model=args.base_model,
            default_steps=args.steps,
            default_guidance=args.guidance,
        )
        print(json.dumps(result, indent=2))

    elif args.command == "download-civitai":
        result = download_from_civitai.remote(
            url=args.url,
            name=args.name,
            pipeline=args.pipeline,
            base_model=args.base_model,
            default_steps=args.steps,
            default_guidance=args.guidance,
            api_key=args.api_key,
        )
        print(json.dumps(result, indent=2))

    elif args.command == "list":
        result = list_models.remote()
        print("\n=== Custom Models ===")
        for name, config in result["custom_models"].items():
            print(f"  {name}: {config['pipeline']} ({config['path']})")

        print("\n=== Model Files ===")
        for f in result["files"]:
            print(f"  {f['name']}: {f['size_gb']:.2f} GB")

        print(f"\n=== HuggingFace Cache ===")
        print(f"  Size: {result.get('cache_size_gb', 0):.2f} GB")

    elif args.command == "delete":
        result = delete_model.remote(args.name)
        if "error" in result:
            print(f"Error: {result['error']}")
        else:
            print(f"Deleted: {result['deleted']}")

    elif args.command == "usage":
        result = get_volume_usage.remote()
        print(f"\n=== Volume Usage ===")
        print(f"Total: {result['total_size_gb']:.2f} GB ({result['file_count']} files)")
        print("\nBreakdown:")
        for name, info in result["breakdown"].items():
            print(f"  {name}: {info['size_gb']:.2f} GB ({info['files']} files)")

    else:
        parser.print_help()


if __name__ == "__main__":
    with app.run():
        main()
