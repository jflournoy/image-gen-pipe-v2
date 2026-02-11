#!/usr/bin/env python3
"""
One-time script to update MoP DMD model configuration with correct settings.

Run with: modal run update_dmd_config.py
"""

import json
from pathlib import Path

import modal

VOLUME_NAME = "diffusion-models"
MODELS_DIR = "/models"
CUSTOM_MODELS_DIR = f"{MODELS_DIR}/custom"

volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
app = modal.App("update-dmd-config")

image = modal.Image.debian_slim(python_version="3.11")


@app.function(
    image=image,
    volumes={MODELS_DIR: volume},
)
def update_mop_dmd_config():
    """Update MoP DMD model with correct LCM/refiner settings"""
    config_path = Path(CUSTOM_MODELS_DIR) / "models.json"

    if not config_path.exists():
        print("Error: models.json not found")
        return {"error": "models.json not found"}

    with open(config_path, "r") as f:
        models = json.load(f)

    # Update MoP DMD model configuration
    if "mop-dmd_v6-1" in models:
        models["mop-dmd_v6-1"].update({
            # DMD-specific settings
            "scheduler": "lcm",
            "default_steps": 8,
            "default_guidance": 1.0,
            # Refiner settings (same model as base/refiner)
            "use_refiner": True,
            "refiner_switch": 0.85,
            "refiner_same_as_base": True,  # Use same model for refiner
            # Clip skip
            "clip_skip": 2,
        })
        print(f"Updated mop-dmd_v6-1 config: {json.dumps(models['mop-dmd_v6-1'], indent=2)}")
    else:
        print("Warning: mop-dmd_v6-1 not found in models.json")
        print(f"Available models: {list(models.keys())}")

    # Update CyberRealistic Pony configuration
    if "cyber-realistic-pony_v16.0" in models:
        models["cyber-realistic-pony_v16.0"].update({
            # Recommended settings from CivitAI
            "scheduler": "karras",  # DPM++ 2M SDE Karras
            "default_steps": 30,
            "default_guidance": 4.0,  # CFG 3-5
            "clip_skip": 1,
            # Light touchup for artifact cleanup
            "touchup_strength": 0.25,
        })
        print(f"Updated cyber-realistic-pony_v16.0 config: {json.dumps(models['cyber-realistic-pony_v16.0'], indent=2)}")
    else:
        print("Warning: cyber-realistic-pony_v16.0 not found in models.json")
        print(f"Available models: {list(models.keys())}")

    # Write updated config
    with open(config_path, "w") as f:
        json.dump(models, f, indent=2)

    # Commit volume changes
    volume.commit()

    print("Configuration updated and committed!")
    return {"updated": "mop-dmd_v6-1", "config": models.get("mop-dmd_v6-1")}


@app.local_entrypoint()
def main():
    result = update_mop_dmd_config.remote()
    print(f"\nResult: {json.dumps(result, indent=2)}")
