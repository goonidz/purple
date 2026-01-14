# RunPod GPU Video Rendering Handler
# Base image with CUDA and FFmpeg with NVENC support

FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

WORKDIR /app

# Install FFmpeg with NVENC support
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libavcodec-extra \
    libavformat-dev \
    libavutil-dev \
    libswscale-dev \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

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
