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
    echo "Options:"
    echo "  1) Enable for this session only (sudo nvidia-smi -pm 1)"
    echo "  2) Enable permanently (systemd service, survives reboots)"
    echo "  3) Skip"
    echo ""
    read -p "Choose [1/2/3]: " -n 1 -r
    echo

    if [[ $REPLY == "1" ]]; then
        sudo nvidia-smi -pm 1
        echo "✓ Persistence mode enabled (until next reboot)"
    elif [[ $REPLY == "2" ]]; then
        echo "Installing systemd service for permanent persistence mode..."
        sudo cp scripts/nvidia-persistence.service /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable nvidia-persistence
        sudo systemctl start nvidia-persistence
        echo "✓ Persistence mode enabled permanently"
        echo "  Service will run automatically on boot"
    else
        echo "⚠️  Skipped. You may experience GPU driver crashes during tests."
    fi
else
    echo "✓ Persistence mode is already ENABLED"

    # Check if systemd service is installed
    if systemctl list-unit-files | grep -q nvidia-persistence; then
        echo "✓ Systemd service installed (will persist after reboot)"
    else
        echo "⚠️  Enabled for current session only (will reset after reboot)"
        echo ""
        read -p "Install systemd service for permanent enable? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo cp scripts/nvidia-persistence.service /etc/systemd/system/
            sudo systemctl daemon-reload
            sudo systemctl enable nvidia-persistence
            echo "✓ Systemd service installed (will persist after reboot)"
        fi
    fi
fi

echo ""
echo "📈 GPU Memory Usage:"
nvidia-smi --query-gpu=memory.used,memory.free --format=csv

echo ""
echo "✓ GPU setup check complete"
