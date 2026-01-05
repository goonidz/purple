#!/bin/bash

# Installation script for FFmpeg with Subpixel Zoompan support
# This fork adds subpixel=1 option for smoother zoom animations
# Source: https://github.com/pYtoner/FFmpeg/tree/subpixel_zoompan

set -e

echo "=== Installing FFmpeg Subpixel Fork ==="
echo "This will install a separate FFmpeg binary with subpixel zoom support"
echo ""

# Install build dependencies
echo "[1/5] Installing build dependencies..."
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    yasm \
    nasm \
    libx264-dev \
    libx265-dev \
    libvpx-dev \
    libfdk-aac-dev \
    libmp3lame-dev \
    libopus-dev \
    pkg-config \
    git

# Clone the fork
echo "[2/5] Cloning FFmpeg Subpixel fork..."
cd /home/ubuntu
if [ -d "ffmpeg-subpixel" ]; then
    echo "Directory exists, removing..."
    rm -rf ffmpeg-subpixel
fi
git clone --branch subpixel_zoompan https://github.com/pYtoner/FFmpeg.git ffmpeg-subpixel

# Configure
echo "[3/5] Configuring FFmpeg..."
cd ffmpeg-subpixel
./configure \
    --prefix=/home/ubuntu/ffmpeg-subpixel-build \
    --enable-gpl \
    --enable-nonfree \
    --enable-libx264 \
    --enable-libx265 \
    --enable-libvpx \
    --enable-libfdk-aac \
    --enable-libmp3lame \
    --enable-libopus

# Compile (this takes a while)
echo "[4/5] Compiling FFmpeg (this may take 10-30 minutes)..."
make -j$(nproc)

# Install
echo "[5/5] Installing FFmpeg..."
make install

# Verify installation
echo ""
echo "=== Installation Complete ==="
FFMPEG_PATH="/home/ubuntu/ffmpeg-subpixel-build/bin/ffmpeg"
if [ -f "$FFMPEG_PATH" ]; then
    echo "✅ FFmpeg Subpixel installed at: $FFMPEG_PATH"
    echo ""
    echo "Version info:"
    $FFMPEG_PATH -version | head -3
    echo ""
    echo "Testing subpixel option..."
    if $FFMPEG_PATH -h filter=zoompan 2>&1 | grep -q "subpixel"; then
        echo "✅ Subpixel option is available!"
    else
        echo "⚠️  Subpixel option not found in help (may still work)"
    fi
else
    echo "❌ Installation failed - binary not found"
    exit 1
fi

echo ""
echo "To use: Select 'Zoom Subpixel (Expérimental)' in the video export options"
