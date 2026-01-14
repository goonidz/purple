# RunPod GPU Video Rendering Handler
# Base image with CUDA and FFmpeg with NVENC support

FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

WORKDIR /app

# Install build dependencies and NVIDIA headers for NVENC
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    git \
    build-essential \
    yasm \
    nasm \
    pkg-config \
    libx264-dev \
    libx265-dev \
    libmp3lame-dev \
    libopus-dev \
    libvpx-dev \
    && rm -rf /var/lib/apt/lists/*

# Install NVIDIA Video Codec SDK headers
RUN git clone https://git.videolan.org/git/ffmpeg/nv-codec-headers.git && \
    cd nv-codec-headers && \
    make install && \
    cd .. && \
    rm -rf nv-codec-headers

# Download and compile FFmpeg with NVENC support
RUN wget https://ffmpeg.org/releases/ffmpeg-6.1.tar.xz && \
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
        --enable-nvenc \
        --enable-cuvid \
        --extra-cflags=-I/usr/local/cuda/include \
        --extra-ldflags=-L/usr/local/cuda/lib64 && \
    make -j$(nproc) && \
    make install && \
    ldconfig && \
    cd .. && \
    rm -rf ffmpeg-6.1 ffmpeg-6.1.tar.xz

# Copy requirements and install Python dependencies
COPY runpod-handler/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy handler code
COPY runpod-handler/handler.py .

# Environment variables (to be set in RunPod dashboard)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_KEY=your-service-key

# Start the handler
CMD ["python", "-u", "handler.py"]
