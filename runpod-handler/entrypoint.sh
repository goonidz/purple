#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Starting. UID=$(id -u) GID=$(id -g)"

# Ensure caps directory exists
mkdir -p /dev/nvidia-caps || true

# Best-effort: create NVENC/NVDEC capability device nodes if supported by the driver.
# Missing /dev/nvidia-caps nodes often causes:
#   "No capable devices found" / "unsupported device (2)"
if [[ -f /proc/driver/nvidia/capabilities/nvenc ]]; then
  echo "[entrypoint] Creating NVENC caps device..."
  nvidia-modprobe -f /proc/driver/nvidia/capabilities/nvenc || true
else
  echo "[entrypoint] No nvenc caps file at /proc/driver/nvidia/capabilities/nvenc"
fi

if [[ -f /proc/driver/nvidia/capabilities/nvdec ]]; then
  echo "[entrypoint] Creating NVDEC caps device..."
  nvidia-modprobe -f /proc/driver/nvidia/capabilities/nvdec || true
fi

echo "[entrypoint] /dev/nvidia-caps:"
ls -la /dev/nvidia-caps 2>/dev/null || true

echo "[entrypoint] Downloading latest handler.py from GitHub..."
curl -sf -o /app/handler.py "https://raw.githubusercontent.com/goonidz/purple/main/runpod-handler/handler.py?t=$(date +%s)" \
  && echo "[entrypoint] handler.py updated from GitHub" \
  || echo "[entrypoint] WARNING: Could not download handler.py, using baked-in version"

echo "[entrypoint] Launching: $*"
exec "$@"

