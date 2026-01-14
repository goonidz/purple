# RunPod GPU Video Rendering Handler
# Base image with CUDA support

FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install FFmpeg with NVENC support (static build from John Van Sickle - maintained and reliable)
# This is the industry-standard approach for GPU-enabled FFmpeg
RUN wget https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz && \
    tar xf ffmpeg-git-amd64-static.tar.xz && \
    cd ffmpeg-git-*-amd64-static && \
    mv ffmpeg ffprobe /usr/local/bin/ && \
    cd .. && \
    rm -rf ffmpeg-git-* && \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

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
