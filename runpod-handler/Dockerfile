# RunPod GPU Video Rendering Handler
# FFmpeg 6.1 with NVENC support for CUDA 12.x
#
# IMPORTANT VERSION NOTES:
# - Using runpod/pytorch:1.0.3 with CUDA 12.8 (latest stable)
# - nv-codec-headers n12.2.72.0 for CUDA 12.x compatibility
# - FFmpeg 6.1 works well with modern CUDA
# - Handler has automatic CPU fallback if GPU unavailable
#
# Build time: ~10-15 minutes

FROM runpod/pytorch:1.0.3-cu1281-torch280-ubuntu2204

WORKDIR /app

# Install build dependencies for FFmpeg compilation
# Note: NVENC runtime libs are provided by the container for CUDA 12.x
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
    && rm -rf /var/lib/apt/lists/*

# Install NVIDIA Video Codec SDK headers
# Using n12.2.72.0 for CUDA 12.x compatibility
RUN git clone --depth 1 --branch n12.2.72.0 https://github.com/FFmpeg/nv-codec-headers.git && \
    cd nv-codec-headers && \
    make install && \
    cd .. && \
    rm -rf nv-codec-headers

# Download and compile FFmpeg 6.1 with NVENC support
# FFmpeg 6.1 is the latest stable, works with CUDA 12.x
RUN wget -q https://ffmpeg.org/releases/ffmpeg-6.1.tar.xz && \
    tar xf ffmpeg-6.1.tar.xz && \
    cd ffmpeg-6.1 && \
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
    rm -rf ffmpeg-6.1 ffmpeg-6.1.tar.xz

# Verify FFmpeg installation and NVENC support
RUN ffmpeg -version && \
    echo "=== Checking NVENC support ===" && \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -i nvenc && \
    echo "=== FFmpeg build complete ==="

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
ENV FFMPEG_VERSION="6.1-cuda12"
ENV NVENC_SUPPORT="enabled"

# Start the handler
CMD ["python", "-u", "handler.py"]
# Trigger rebuild Wed Jan 14 17:14:38 CET 2026
