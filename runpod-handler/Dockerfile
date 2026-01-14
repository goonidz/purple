# RunPod GPU Video Rendering Handler - WORKING CONFIG
#
# Base image: lestermfp/runpod-ffmpeg-cuda (community template)
# This image has FFmpeg 5.1.4 pre-compiled with NVENC support
# and CUDA 11.8 - proven to work on RunPod Pods.
#
# Features:
# - Parallel downloads (20 workers)
# - Parallel processing (3 workers, NVENC limit)
# - Project name sanitization (URL-safe)
# - NVENC hardware encoding
#
# Build time: ~1-2 minutes

FROM lestermfp/runpod-ffmpeg-cuda:latest

WORKDIR /app

# Install Python dependencies
COPY runpod-handler/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy handler code (with parallel processing + fixes)
COPY runpod-handler/handler.py .

# GPU capabilities
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all

# Start worker
CMD ["python3", "handler.py"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python3", "-u", "handler.py"]
