# RunPod GPU Video Rendering Handler

Ce dossier contient le handler RunPod pour le rendu vidéo accéléré par GPU (CuPy + NVENC).

## 🚀 Mode Serverless (Actuel - Janvier 2026)

```
Frontend (Toggle GPU ON)
    ↓
Edge Function (render-video-gpu)
    ↓
RunPod Serverless API (sr4lev8xioj0pv)
    ↓
Worker (Image Docker Custom)
    ↓
Handler Python (CuPy GPU + NVENC)
    ↓ (Real-time updates)
Supabase DB (gpu_render_jobs)
    ↓ (Realtime subscription)
Frontend (Progress bar + current_step)
    ↓ (Upload)
VPS Storage API (unlimited)
```

### Avantages Serverless
- ✅ **Auto-scaling** : Workers démarrent/stoppent automatiquement
- ✅ **Pay-per-second** : ~$0.00024/s (~5 centimes pour 100 scènes)
- ✅ **Démarrage instant** : ~5-10s (dépendances pré-installées)
- ✅ **Progress temps réel** : `current_step` + `progress` en DB
- ✅ **Upload illimité** : VPS API (pas de limite Supabase)

## 📁 Fichiers

- `handler.py` - Point d'entrée RunPod (modes Serverless + Pod + Worker)
- `Dockerfile.serverless` - Image custom avec dépendances pré-installées
- `build-serverless.sh` - Script de build et push vers GHCR
- `requirements.txt` - Dépendances Python (CuPy, httpx, FFmpeg)
- `.dockerignore` - Fichiers ignorés lors du build

## 📚 Documentation

- **[SERVERLESS_DEPLOY.md](./SERVERLESS_DEPLOY.md)** - Guide complet de déploiement Serverless
- **[ZOOM_IMPLEMENTATION.md](./ZOOM_IMPLEMENTATION.md)** - Détails techniques CuPy GPU vs OpenCV CPU
- **[../RUNPOD_POD_CONFIG.md](../RUNPOD_POD_CONFIG.md)** - Configuration complète (Serverless + Pod)

## ⚡ Quick Start

### 1. Build l'image Docker custom

```bash
cd runpod-handler
./build-serverless.sh
```

### 2. Redémarre les workers

RunPod Dashboard → Serverless → `sr4lev8xioj0pv` → Workers → Terminate 🗑️

### 3. Teste

Lance un rendu GPU depuis le frontend !

**Voir [SERVERLESS_DEPLOY.md](./SERVERLESS_DEPLOY.md) pour le guide complet.**

---

## 🎨 Technologies

### Backend Rendu
- **CuPy** : GPU-accelerated zoom transforms (order=1 bilinear)
- **httpx + HTTP/2** : Download parallèle d'images (~32s pour 102 images)
- **FFmpeg + NVENC** : Encoding GPU (h264_nvenc, hevc_nvenc)
- **20 workers** : Processing parallèle de scènes

### Performance (GPU A40)
- **102 scènes** (9 min vidéo) : **~3 minutes** total
  - Download : ~32s
  - Processing : ~200s
  - Upload VPS : ~60s
- **Speedup vs CPU** : **6-10x plus rapide**

### Dépendances Clés
```txt
cupy-cuda11x>=11.0.0      # GPU acceleration
httpx[http2]>=0.27.0      # HTTP/2 downloads
opencv-python-headless    # Fallback CPU
runpod>=1.0.0            # RunPod SDK
```

---

## 💰 Coûts Serverless

| GPU | Prix/sec | Vidéo 17 scènes (2:34) | Vidéo 100 scènes (9 min) |
|-----|----------|------------------------|--------------------------|
| A40 (recommandé) | $0.00024 | **~$0.017** (2¢) | **~$0.048** (5¢) |
| A100 | $0.00139 | ~$0.097 (10¢) | ~$0.278 (28¢) |

**Auto-stop** : $0 quand idle (vs Pod qui coûte $0.86/h même idle).

---

## 🔧 Modes de fonctionnement

Le handler supporte **3 modes** :

### 1. Serverless (actuel)
- Trigger : HTTP POST depuis Edge Function
- Updates DB en temps réel via `update_gpu_job()`
- Auto-scale workers

### 2. Worker (legacy Pod)
- Trigger : Polling `claim_gpu_render_job()` RPC
- Updates DB pendant le rendu
- Persistant (toujours actif)

### 3. Pod (legacy)
- Trigger : Manuel / API directe
- Pas de DB updates
- Pour debug

Mode déterminé par `RUNPOD_MODE` env var.

---

## 📊 Monitoring

### RunPod Dashboard
- **Requests** : Liste des jobs (status, durée, coût)
- **Workers** : Workers actifs, logs en temps réel
- **Analytics** : Métriques, graphiques, coûts

### Supabase DB
```sql
SELECT id, status, progress, current_step, video_url, metadata
FROM gpu_render_jobs
WHERE status = 'processing'
ORDER BY created_at DESC;
```

### Frontend Console
```
🔔 [GPU] Realtime update: pending 20 current_step: Téléchargement de 17 images...
🔔 [GPU] Realtime update: pending 40 current_step: Scène 10/17 terminée...
```

---

## 🐛 Troubleshooting

### Image build failed
- Vérifier Docker running : `docker ps`
- Login GHCR : `echo $GITHUB_PAT | docker login ghcr.io -u goonidz --password-stdin`

### Worker ne démarre pas
- Vérifier que l'image est publique sur GHCR
- Vérifier les env vars dans l'Endpoint
- Logs RunPod : Dashboard → Workers → Logs

### Progress ne s'affiche pas
- Vérifier migration DB (`current_step` column)
- Vérifier Realtime subscription (logs console)
- Vérifier `GpuRenderJobIndicator` component

**Voir [SERVERLESS_DEPLOY.md](./SERVERLESS_DEPLOY.md) pour plus de détails.**

---

**Système Serverless 100% fonctionnel !** 🎉
