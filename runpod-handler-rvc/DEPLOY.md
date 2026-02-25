# Deployment Guide: EdgeTTS + RVC

## Overview

This pipeline adds a new TTS provider `edgetts_rvc` that:
1. Splits the script into ~2000-char sentence-safe chunks on the VPS
2. Generates each chunk in parallel via Microsoft EdgeTTS (free, no API key)
3. Concatenates all chunks into one audio file
4. Sends the full audio to a RunPod Serverless GPU for RVC voice conversion via Applio

---

## Deploying to RunPod

The RVC handler uses a **dedicated Git branch** so pushes to `main` don't trigger rebuilds.

### Deploy a new version:
```bash
git push origin main:runpod-rvc
```

### RunPod endpoint config:
| Setting | Value |
|---------|-------|
| **Branch** | `runpod-rvc` |
| **Dockerfile Path** | `runpod-handler-rvc/Dockerfile.serverless` |
| **Build Context** | `runpod-handler-rvc/` |

### Environment variables (on RunPod endpoint):
```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_KEY=<your-service-role-key>
```

---

## VPS Configuration

SSH into the VPS and set these env vars for the image-worker:

```bash
RUNPOD_RVC_ENDPOINT_ID=<endpoint_id>
RUNPOD_API_KEY=<your_runpod_api_key>
```

Then restart: `pm2 restart image-worker`

### edge-tts must be installed on VPS:
```bash
pip install edge-tts
```

If not in `$PATH`, set `EDGE_TTS_BIN=/home/ubuntu/.local/bin/edge-tts`

---

## Testing

1. Select **EdgeTTS + Voice Clone (RVC)** as TTS provider
2. Pick an EdgeTTS voice
3. Enter HuggingFace `.pth` model URL
4. Enter HuggingFace `.index` URL (optional)
5. Set pitch and speed
6. Generate audio
7. Watch logs: `pm2 logs image-worker`
