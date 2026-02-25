# Deployment Guide: EdgeTTS + RVC

## Overview

This pipeline adds a new TTS provider `edgetts_rvc` that:
1. Splits the script into ~2000-char sentence-safe chunks on the VPS
2. Generates each chunk in parallel via Microsoft EdgeTTS (free, no API key)
3. Concatenates all chunks into one audio file
4. Sends the full audio to a RunPod Serverless GPU for RVC voice conversion

---

## Step 1 — Build & Push Docker Image

```bash
cd runpod-handler-rvc
docker build -f Dockerfile.serverless -t ghcr.io/goonidz/videoflow-rvc-serverless:latest .
docker push ghcr.io/goonidz/videoflow-rvc-serverless:latest
```

Or use the build script:
```bash
./build-serverless.sh
```

---

## Step 2 — Create RunPod Serverless Endpoint

1. Go to https://www.runpod.io/console/serverless
2. Click **+ New Endpoint**
3. Container image: `ghcr.io/goonidz/videoflow-rvc-serverless:latest`
4. GPU: **RTX 3090** or **RTX 4090** (24 GB VRAM recommended)
5. Min workers: **0**, Max workers: **5**
6. Environment variables:
   ```
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_KEY=<your-service-role-key>
   ```
7. Save and copy the **Endpoint ID**

---

## Step 3 — Configure VPS Environment Variables

SSH into the VPS and add to the image-worker environment (`.env` or PM2 ecosystem file):

```bash
RUNPOD_RVC_ENDPOINT_ID=<endpoint_id_from_step_2>
RUNPOD_API_KEY=<your_runpod_api_key>
```

Then restart the worker:
```bash
pm2 restart image-worker
```

---

## Step 4 — Install edge-tts on VPS

```bash
pip install edge-tts
# Verify
edge-tts --text "Hello world" --voice en-US-AndrewMultilingualNeural --write-media /tmp/test.mp3
```

If `edge-tts` is not in `$PATH` for the PM2 process, set `EDGE_TTS_BIN` env var:
```bash
EDGE_TTS_BIN=/home/ubuntu/.local/bin/edge-tts
```

---

## Step 5 — Deploy Edge Function

```bash
supabase functions deploy start-generation-job
```

---

## Step 6 — Deploy image-worker

```bash
# From local machine
scp image-worker/index.js user@your-vps:/path/to/image-worker/index.js
ssh user@your-vps "pm2 restart image-worker"
```

---

## Step 7 — Deploy Frontend

```bash
npm run build
# Deploy to your hosting (Vercel, Netlify, etc.)
```

---

## Testing

1. In the app, select **EdgeTTS + Voice Clone (RVC)** as TTS provider
2. Pick an EdgeTTS voice (e.g. Andrew for English)
3. Enter your HuggingFace `.pth` model URL
4. Enter your HuggingFace `.index` URL (optional)
5. Set pitch shift (e.g. 0 for same gender, -12 for female→male)
6. Generate audio

Watch the VPS logs: `pm2 logs image-worker`
