#!/bin/bash
# Quick update script for Linode deployment
# Usage: bash update.sh

set -e

APP_DIR="/var/www/image-gen-pipe-v2"

echo "Updating Image Gen Pipe V2..."

cd "$APP_DIR"

echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm ci --omit=dev --ignore-scripts

echo "Restarting service..."
systemctl restart image-gen-pipe

echo ""
echo "[OK] App updated and service restarted"
echo ""
echo "Recent logs:"
journalctl -u image-gen-pipe -n 20 --no-pager

echo ""
echo "Service status:"
systemctl status image-gen-pipe --no-pager | head -10
