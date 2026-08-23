FROM jrottenberg/ffmpeg:8.1.2-ubuntu2404

USER root
WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates curl libvulkan1 mesa-vulkan-drivers python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --no-cache-dir --break-system-packages \
       'runpod>=1.7,<2' 'requests>=2.32,<3'

COPY handler.py /app/handler.py

ENTRYPOINT []
CMD ["python3", "-u", "/app/handler.py"]
