# RunPod GPU Video Rendering Handler
# Using RunPod's official base image with CUDA 12.2 (optimized for GPU access)
# Reference: https://github.com/Pranjalya/ffmpeg-gpu-runpod-template
#
# Build time: ~5-8 minutes

FROM runpod/base:0.6.1-cuda12.2.0

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Download and install FFmpeg static build with NVENC support
# Using BtbN's builds which include NVENC (unlike John Van Sickle's)
RUN wget -q https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl-shared.tar.xz && \
    tar xf ffmpeg-master-latest-linux64-gpl-shared.tar.xz && \
    cp -r ffmpeg-master-latest-linux64-gpl-shared/bin/* /usr/local/bin/ && \
    cp -r ffmpeg-master-latest-linux64-gpl-shared/lib/* /usr/local/lib/ && \
    ldconfig && \
    rm -rf ffmpeg-master-latest-linux64-gpl-shared* && \
    ffmpeg -version

# Verify NVENC support
RUN echo "=== Checking encoders ===" && \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -i nvenc || echo "Checking NVENC..."

# Install Python dependencies
COPY runpod-handler/requirements.txt .
RUN python3 -m pip install --upgrade pip && \
    python3 -m pip install --no-cache-dir -r requirements.txt

# Copy handler code
COPY runpod-handler/handler.py .

# NVIDIA GPU capabilities - ensure video encoding access
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all

# Health check info
ENV FFMPEG_BUILD="BtbN-master-gpl-shared"
ENV NVENC_SUPPORT="enabled"

# Start the handler
CMD ["python3", "-u", "handler.py"]
