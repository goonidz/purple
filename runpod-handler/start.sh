#!/bin/bash
set -e

echo "[Start] Creating /app directory..."
mkdir -p /app
cd /app

echo "[Start] Downloading handler.py from GitHub..."
curl -f -o handler.py "https://raw.githubusercontent.com/goonidz/purple/main/runpod-handler/handler.py?$(date +%s)"

echo "[Start] Installing Python dependencies..."
pip3 install --quiet runpod supabase requests

echo "[Start] Starting handler..."
exec python3 handler.py
