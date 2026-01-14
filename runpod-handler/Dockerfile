# RunPod GPU Video Rendering Handler
#
# Base image: lestermfp/runpod-ffmpeg-cuda (community template)
# This image has FFmpeg 5.1.4 pre-compiled with NVENC support
# and CUDA 11.8 - proven to work on RunPod Pods.
#
# Build time: ~1-2 minutes (just adding Python deps + handler)

FROM lestermfp/runpod-ffmpeg-cuda:latest

WORKDIR /app

# Install Python dependencies (image already has python3-pip)
COPY runpod-handler/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy handler code
COPY runpod-handler/handler.py .

# Entrypoint for NVENC capability devices
COPY runpod-handler/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# GPU capabilities
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python3", "handler.py"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python3", "-u", "handler.py"]
