FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-liberation \
    fonts-dejavu-core \
    ffmpeg \
    fontconfig \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY fonts/ /usr/share/fonts/apple/
RUN fc-cache -fv 2>/dev/null || true

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium

CMD ["python3", "-u", "handler.py"]
