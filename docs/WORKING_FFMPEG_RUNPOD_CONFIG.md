# Working FFmpeg RunPod Configuration

Cette configuration a été testée et fonctionne pour le rendu vidéo GPU avec NVENC.

---

## Image de base (IMPORTANT)

```
lestermfp/runpod-ffmpeg-cuda:latest
```

C'est un **template communautaire** RunPod qui inclut FFmpeg pré-compilé avec support NVENC complet.

---

## Spécifications de l'image

### Système
| Élément | Valeur |
|---------|--------|
| OS | Ubuntu 22.04.3 LTS |
| CUDA | 11.8 (V11.8.89) |
| Entrypoint | `/opt/nvidia/nvidia_entrypoint.sh` |

### FFmpeg
```
ffmpeg version n5.1.4
Configuration:
  --enable-cuda
  --enable-cuda-llvm
  --enable-cuda-nvcc
  --enable-cuvid
  --enable-ffnvcodec
  --enable-nvenc
  --enable-nonfree
  --enable-libx264
  --enable-libx265
  --extra-cflags=-I/usr/local/nvidia/include/
  --extra-ldflags=-L/usr/local/nvidia/lib64/
```

### Encodeurs NVENC disponibles
```
h264_nvenc - NVIDIA NVENC H.264 encoder
hevc_nvenc - NVIDIA NVENC hevc encoder
```

### Exemple de commande FFmpeg GPU
```bash
ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda \
  -i input.mp4 \
  -c:v h264_nvenc -b:v 20000k \
  -vf scale_npp=4096:-1 \
  -c:a copy output.mp4
```

---

## Packages Python installés

```
runpod==1.8.1
supabase==2.27.2
requests==2.32.5
aiohttp==3.13.3
pydantic==2.12.5
fastapi==0.128.0
uvicorn==0.40.0
boto3==1.42.28
sentry-sdk==2.49.0
```

### requirements.txt minimal
```
runpod>=1.7.0
requests>=2.28.0
supabase>=2.0.0
```

---

## Configuration Pod RunPod

### Template
- **Image**: `lestermfp/runpod-ffmpeg-cuda`
- **Volume**: 50 GB
- **Container Disk**: 10 GB
- **GPU**: NVIDIA (RTX 4090 recommandé)

### Variables d'environnement
```bash
RUNPOD_MODE=worker
SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=all
```

---

## Structure du container

```
/app/
└── handler.py    # 738 lignes (avec fix project_name)

/usr/local/bin/
└── ffmpeg        # FFmpeg 5.1.4 avec NVENC

/opt/nvidia/
└── nvidia_entrypoint.sh
```

---

## Dockerfile basé sur cette config

```dockerfile
FROM lestermfp/runpod-ffmpeg-cuda:latest

WORKDIR /app

COPY runpod-handler/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY runpod-handler/handler.py .
COPY runpod-handler/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python3", "handler.py"]
```

---

## Fix appliqué : Sanitization du project_name

Le problème : les espaces dans le nom du projet créaient des URLs invalides.

```python
# AVANT (bug)
project_name = payload.get('projectName', 'video')

# APRÈS (fix)
project_name_raw = payload.get('projectName', 'video')
project_name = re.sub(r'[^\w\-]', '_', project_name_raw)
```

Exemple :
- `"China Just Broke The Silver"` → `"China_Just_Broke_The_Silver"`

---

## Logs attendus (fonctionnement normal)

```
[entrypoint] Starting. UID=0 GID=0
[Worker] Polling for GPU render jobs...
[Worker] Claimed gpu_render_job: <UUID>
[GPU Handler] Detecting available encoders...
[GPU Handler] GPU detected: NVIDIA GeForce RTX 4090, 24564 MiB
[GPU Handler] NVENC available: h264_nvenc, hevc_nvenc
[GPU Handler] Using encoder: h264_nvenc (GPU: True)
[GPU Handler] Processing scene 1/17
[GPU Handler] Running FFmpeg (h264_nvenc): ffmpeg -y -loop 1 ...
[GPU Handler] Concatenating segments...
[GPU Handler] Adding audio...
[GPU Handler] Uploading to Supabase...
[GPU Handler] ✅ Render complete in 45.2s
[GPU Handler] Video URL: https://...supabase.co/storage/v1/object/public/rendered-videos/...
[Worker] Job completed successfully
```

---

## Troubleshooting

### NVENC not found
- Vérifier que l'image de base est `lestermfp/runpod-ffmpeg-cuda`
- Vérifier `NVIDIA_DRIVER_CAPABILITIES=all`
- Le GPU doit être NVIDIA avec support NVENC

### Upload failed
- Vérifier que le bucket `rendered-videos` existe
- Vérifier `SUPABASE_SERVICE_KEY` (pas la anon key)

### URL avec espaces
- Vérifier que le fix `project_name` est appliqué (ligne ~541 du handler.py)

---

## Références

- Template communautaire : `lestermfp/runpod-ffmpeg-cuda`
- RunPod Pods : https://www.runpod.io/console/pods
- Supabase Storage : https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/storage

---

*Dernière mise à jour : 14 janvier 2026*
