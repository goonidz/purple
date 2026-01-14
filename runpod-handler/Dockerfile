# RunPod GPU Video Rendering Handler
# FFmpeg 5.1 LTS with NVENC support - Production ready
#
# IMPORTANT VERSION NOTES:
# - FFmpeg 5.1.8 (LTS) is used for maximum stability with CUDA 11.8
# - nv-codec-headers n11.1.5.3 is compatible with CUDA 11.x SDK
# - Handler has automatic CPU fallback if GPU unavailable
#
# Build time: ~10-15 minutes

FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

WORKDIR /app

# Install build dependencies for FFmpeg compilation
# CRITICAL: libnvidia-encode-520 provides the NVENC runtime library
# Without this, FFmpeg can compile with NVENC but cannot encode at runtime
RUN apt-get update && apt-get install -y \
    wget \
    git \
    build-essential \
    yasm \
    nasm \
    pkg-config \
    libx264-dev \
    libx265-dev \
    libvpx-dev \
    libmp3lame-dev \
    libopus-dev \
    libfdk-aac-dev \
    libass-dev \
    libfreetype6-dev \
    libnvidia-encode-520 \
    libnvidia-decode-520 \
    && rm -rf /var/lib/apt/lists/*

# Install NVIDIA Video Codec SDK headers
# Using n11.1.5.3 which is compatible with CUDA 11.8 and FFmpeg 5.1
RUN git clone --depth 1 --branch n11.1.5.3 https://github.com/FFmpeg/nv-codec-headers.git && \
    cd nv-codec-headers && \
    make install && \
    cd .. && \
    rm -rf nv-codec-headers

# Download and compile FFmpeg 5.1.8 LTS with NVENC support
# FFmpeg 5.1 is the Long Term Support version - very stable
RUN wget -q https://ffmpeg.org/releases/ffmpeg-5.1.8.tar.xz && \
    tar xf ffmpeg-5.1.8.tar.xz && \
    cd ffmpeg-5.1.8 && \
    ./configure \
        --enable-nonfree \
        --enable-cuda-nvcc \
        --enable-libnpp \
        --enable-gpl \
        --enable-libx264 \
        --enable-libx265 \
        --enable-libvpx \
        --enable-libmp3lame \
        --enable-libopus \
        --enable-libfdk-aac \
        --enable-libass \
        --enable-libfreetype \
        --enable-nvenc \
        --enable-cuvid \
        --extra-cflags="-I/usr/local/cuda/include" \
        --extra-ldflags="-L/usr/local/cuda/lib64" \
        --disable-doc \
        --disable-debug && \
    make -j$(nproc) && \
    make install && \
    ldconfig && \
    cd .. && \
    rm -rf ffmpeg-5.1.8 ffmpeg-5.1.8.tar.xz

# Verify FFmpeg installation and NVENC support
RUN ffmpeg -version && \
    echo "=== Checking NVENC support ===" && \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -i nvenc && \
    echo "=== Checking NVENC library ===" && \
    ldconfig -p | grep -i nvidia-encode && \
    echo "=== NVENC setup complete ==="

# Copy requirements and install Python dependencies
COPY runpod-handler/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy handler code
COPY runpod-handler/handler.py .

# Environment variables (to be set in RunPod dashboard)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_KEY=your-service-key

# CRITICAL: Enable GPU video encoding capabilities in container
# Without this, NVENC is blocked even if GPU is visible
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all

# Health check info
ENV FFMPEG_VERSION="5.1.8-LTS"
ENV NVENC_SUPPORT="enabled"

# Start the handler
CMD ["python", "-u", "handler.py"]
