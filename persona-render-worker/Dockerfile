FROM lscr.io/linuxserver/ffmpeg:8.1.2

USER root
WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates curl libvulkan1 mesa-vulkan-drivers python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --no-cache-dir --break-system-packages \
       'runpod>=1.7,<2' 'requests>=2.32,<3' \
    && python3 -c 'import sys; assert (3, 10) <= sys.version_info[:2] < (3, 14), sys.version' \
    && ffmpeg -hide_banner -filters 2>&1 | grep -q libplacebo \
    && ffmpeg -hide_banner -encoders 2>&1 | grep -q h264_nvenc

COPY handler.py /app/handler.py

ENTRYPOINT []
CMD ["python3", "-u", "/app/handler.py"]
