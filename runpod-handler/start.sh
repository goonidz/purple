#!/bin/bash
set -e

echo "[Start] Creating /app directory..."
mkdir -p /app
cd /app

echo "[Start] Downloading handler.py from GitHub..."
curl -f -o handler.py "https://raw.githubusercontent.com/goonidz/purple/main/runpod-handler/handler.py?$(date +%s)"

echo "[Start] Downloading requirements.txt from GitHub..."
curl -f -o requirements.txt "https://raw.githubusercontent.com/goonidz/purple/main/runpod-handler/requirements.txt?$(date +%s)"

echo "[Start] Installing Python dependencies..."
python3 -m pip install --quiet -r requirements.txt

echo "[Start] Installing CUDA runtime libs for CuPy (if not present)..."
python3 -m pip install --quiet nvidia-cuda-nvrtc-cu12 nvidia-cublas-cu12 nvidia-cudnn-cu12 || echo "CUDA libs install failed, will use CPU fallback"

echo "[Start] Starting handler..."
exec python3 handler.py
