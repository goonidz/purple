FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-liberation \
    fonts-dejavu-core \
    ffmpeg \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Apple Color Emoji (optional — copy AppleColorEmoji.ttc into fonts/ before building)
COPY fonts/ /usr/share/fonts/apple/
RUN fc-cache -fv 2>/dev/null || true

WORKDIR /app
COPY package*.json ./
RUN npm ci --production

COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium

EXPOSE 8080

CMD ["node", "render-server.js"]
