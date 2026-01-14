# RunPod GPU Video Rendering Handler (Serverless)
#
# Your error:
#   nvidia-container-cli: requirement error: unsatisfied condition: cuda>=12.8
# means the *worker's host driver* is older than CUDA 12.8.
# You can't "update the driver" on serverless workers, so the fix is:
#   ✅ use an earlier CUDA container.
#
# This Dockerfile pins to RunPod's CUDA 12.2 base image (broad compatibility)
# and installs a prebuilt FFmpeg that includes NVENC.
#
# Build time: ~2-4 minutes

FROM runpod/base:0.6.1-cuda12.2.0

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    xz-utils \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install prebuilt FFmpeg with NVENC support (fast, no compilation).
# (John Van Sickle static builds typically do NOT include NVENC; use BtbN.)
RUN wget -q https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl-shared.tar.xz && \
    tar xf ffmpeg-master-latest-linux64-gpl-shared.tar.xz && \
    cp -r ffmpeg-master-latest-linux64-gpl-shared/bin/* /usr/local/bin/ && \
    cp -r ffmpeg-master-latest-linux64-gpl-shared/lib/* /usr/local/lib/ && \
    ldconfig && \
    rm -rf ffmpeg-master-latest-linux64-gpl-shared* && \
    ffmpeg -version && \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -i nvenc

# Copy requirements and install Python dependencies
COPY runpod-handler/requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Copy handler code
COPY runpod-handler/handler.py .

# Enable GPU video encoding capabilities
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all

CMD ["python3", "-u", "handler.py"]
