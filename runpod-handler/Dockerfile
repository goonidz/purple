# RunPod GPU Video Rendering Handler
# FFmpeg 6.1 with NVENC support for CUDA 12.x
#
# Build time: ~10-15 minutes

FROM runpod/pytorch:1.0.3-cu1281-torch280-ubuntu2204

WORKDIR /app

# Install build dependencies for FFmpeg compilation
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
# n12.1.14.0 is compatible with FFmpeg 6.1
RUN git clone --depth 1 --branch n12.1.14.0 https://github.com/FFmpeg/nv-codec-headers.git && \
    cd nv-codec-headers && \
    make install && \
    cd .. && \
    rm -rf nv-codec-headers

# Download and compile FFmpeg 6.1 with NVENC support
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
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -i nvenc

# Copy requirements and install Python dependencies
COPY runpod-handler/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy handler code
COPY runpod-handler/handler.py .

# Enable GPU video encoding capabilities
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all

CMD ["python", "-u", "handler.py"]
