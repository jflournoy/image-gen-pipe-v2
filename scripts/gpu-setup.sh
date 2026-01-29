#!/bin/bash
# GPU setup script for stable model operations
# Enables NVIDIA persistence mode to prevent driver reload crashes

set -e

echo "=== GPU Setup for Image Generation Pipeline ==="
echo ""

# Check if nvidia-smi is available
if ! command -v nvidia-smi &> /dev/null; then
    echo "❌ nvidia-smi not found. Is NVIDIA driver installed?"
    exit 1
fi

echo "📊 Current GPU Status:"
nvidia-smi --query-gpu=index,name,memory.used,memory.total,persistence_mode --format=csv

echo ""
echo "🔍 Checking persistence mode..."
PERSISTENCE=$(nvidia-smi --query-gpu=persistence_mode --format=csv,noheader)

if [[ "$PERSISTENCE" == "Disabled" ]]; then
    echo "⚠️  Persistence mode is DISABLED"
    echo ""
    echo "Persistence mode keeps the NVIDIA driver loaded, preventing crashes"
    echo "during heavy GPU load cycling (repeated model loading/unloading)."
    echo ""
    echo "Enabling persistence mode requires sudo. Run:"
    echo "  sudo nvidia-smi -pm 1"
    echo ""
    read -p "Enable persistence mode now? (requires sudo) [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo nvidia-smi -pm 1
        echo "✓ Persistence mode enabled"
    else
        echo "⚠️  Skipped. You may experience GPU driver crashes during tests."
    fi
else
    echo "✓ Persistence mode is already ENABLED"
fi

echo ""
echo "📈 GPU Memory Usage:"
nvidia-smi --query-gpu=memory.used,memory.free --format=csv

echo ""
echo "✓ GPU setup check complete"
