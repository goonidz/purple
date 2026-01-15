# Configuration RunPod Pod Template

## ✅ Déploiement terminé

1. **Migration DB** : `gpu_render_jobs` table + `claim_gpu_render_job()` RPC ✅
2. **Edge Function** : `render-video-gpu-pod` déployée ✅  
   URL: `https://laqgmqyjstisipsbljha.supabase.co/functions/v1/render-video-gpu-pod`
3. **Image GHCR** : `ghcr.io/goonidz/purple-runpod-handler:cuda12.2` ✅  
   SHA: `470b63aba91e614f6485102e3ad54eab84b8c6bb8c9c0354f18fd5d73ef39276`

---

## Configuration du Pod Template RunPod

### 1. Image Docker
```
ghcr.io/goonidz/purple-runpod-handler:cuda12.2
```

### 2. Variables d'environnement (CRITICAL)

Ajoute ces variables dans le Pod Template :

```bash
# Mode worker (polling)
RUNPOD_MODE=worker

# Supabase config (pour DB updates uniquement)
SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTg4MjA2MSwiZXhwIjoyMDgxNDU4MDYxfQ.8WIZ3w_ouqXivqQms7sqjnxnTdA06hcwym966LYeh4w

# VPS Video Storage (pour upload des vidéos - bypass Supabase Storage limits)
VPS_UPLOAD_URL=https://purpleai.duckdns.org/api/upload-video
VPS_UPLOAD_TOKEN=3d8973d677721dba2bd2b32bde3de73e3112a0c6daf0b5b51b8e87f1780fca30

# NVIDIA GPU
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=compute,utility,video
```

### 3. VPS Video Storage API

**Pourquoi ?** Supabase Storage a des limites strictes (50 MB par fichier, timeouts sur gros uploads). Les vidéos rendues GPU peuvent facilement dépasser 100-500 MB.

**Solution** : Upload direct vers le VPS via une API dédiée.

**Architecture** :
```
RunPod → HTTPS POST → VPS (video-storage-api:3001)
                          ↓
                    /var/www/rendered-videos/
                          ↓
                    Nginx sert les fichiers (public)
```

**Ce qui a été déployé** :
- ✅ Service Node.js (`video-storage-api`) sur VPS (port 3001, géré par PM2)
- ✅ Nginx configuré pour servir `/rendered-videos/` en statique
- ✅ Nginx proxy `/api/upload-video` vers le service
- ✅ Handler RunPod modifié pour uploader vers VPS (avec fallback Supabase)

**Avantages** :
- 🚀 Pas de limite de taille (jusqu'à 500 MB configuré, extensible)
- ⚡ Timeout 5 minutes (vs 60s Supabase)
- 💰 Gratuit (VPS déjà payé)
- 🔄 Fallback automatique sur Supabase Storage si VPS fail

**Logs attendus** :
```
[GPU Handler] Uploading video to VPS...
[GPU Handler] Uploaded 127.45 MB to VPS
[GPU Handler] Video URL: https://purpleai.duckdns.org/rendered-videos/1736937461_project_abc123.mp4
```

Voir `video-storage-api/DEPLOY.md` pour les détails du déploiement VPS.

---

### 4. GPU Requirements
- **Type** : NVIDIA GPU (RTX 3090, RTX 4090, A6000, etc.)
- **CUDA Version** : 12.x (image compatible avec 12.2+)

### 5. Ports
Aucun port public nécessaire (le worker poll Supabase en interne).

---

## Comment ça marche

### Workflow complet

1. **Frontend** : User clique sur "Render" avec GPU toggle ON
2. **Edge Function** : `render-video-gpu-pod` insère un job dans `gpu_render_jobs` (status=pending)
3. **RunPod Pod Worker** :
   - Poll `claim_gpu_render_job()` toutes les 5 secondes
   - Claim un job atomiquement (status → processing)
   - Download images, render avec `h264_nvenc` (GPU)
   - Upload vidéo vers **VPS Storage API** (fallback: Supabase Storage)
   - Update job status → completed + video_url
4. **Frontend** : Poll `gpu_render_jobs` table pour status/progress

### Logs attendus dans le Pod

```
[entrypoint] Starting. UID=0 GID=0
[entrypoint] Creating NVENC caps device...
[entrypoint] /dev/nvidia-caps: nvidia-cap0 nvidia-cap1
[Worker] Polling for GPU render jobs...
[Worker] Claimed gpu_render_job: <UUID>
[GPU Handler] Detecting available encoders...
[GPU Handler] GPU detected: NVIDIA GeForce RTX 4090, 24564 MiB
[GPU Handler] NVENC available: h264_nvenc, hevc_nvenc
[GPU Handler] Processing scene 1/17
[GPU Handler] Running FFmpeg (h264_nvenc): ffmpeg -y -loop 1 ...
[GPU Handler] Concatenating segments...
[GPU Handler] Adding audio...
[GPU Handler] Uploading video to VPS...
[GPU Handler] Uploaded 127.45 MB to VPS
✅ Render complete: https://purpleai.duckdns.org/rendered-videos/1736937461_project_abc123.mp4
[Worker] Job completed successfully
[Worker] Polling for GPU render jobs...
```

---

## Test end-to-end

1. **Lancer le Pod** depuis RunPod Dashboard (avec le template configuré)
2. **Vérifier les logs** : doit afficher `[Worker] Polling for GPU render jobs...`
3. **Frontend** : Créer un projet, activer GPU toggle, cliquer "Render"
4. **Vérifier DB** :
   ```sql
   SELECT id, status, progress, claimed_by, error_message 
   FROM gpu_render_jobs 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```
5. **Logs Pod** : doit afficher `[Worker] Claimed gpu_render_job: ...` puis le rendu

---

## Troubleshooting

### Le Pod ne claim pas de jobs
- Vérifier `RUNPOD_MODE=worker` (pas "pod" ni "serverless")
- Vérifier `SUPABASE_SERVICE_KEY` (pas la anon key)
- Vérifier que `gpu_render_jobs` a des rows avec `status='pending'`

### NVENC not found
- Vérifier `NVIDIA_DRIVER_CAPABILITIES=compute,utility,video`
- Vérifier GPU type (doit être NVIDIA avec NVENC support)
- Logs doivent montrer `/dev/nvidia-caps` avec au moins 1 device

### Upload failed
- Vérifier `VPS_UPLOAD_URL` et `VPS_UPLOAD_TOKEN` (voir logs PM2 du VPS pour le token)
- Tester manuellement : `curl -X POST https://purpleai.duckdns.org/api/upload-video` → doit retourner `{"error":"Unauthorized"}`
- Vérifier que `video-storage-api` tourne sur VPS : `pm2 list | grep video-storage`
- Si VPS fail, le handler utilise Supabase Storage en fallback (check logs)

---

## Coût estimé (pay-per-use)

- **RTX 4090** : ~$0.49/h (démarrage : 30-60s, arrêt manuel ou auto)
- **Vidéo courte** (10 scènes, 60s) : ~2-3 min → ~$0.02-0.04
- **Vidéo longue** (30 scènes, 3 min) : ~5-8 min → $0.04-0.07

Compare CPU VPS : 15-20 min pour la même vidéo = **6-10x plus rapide sur GPU** ⚡

---

## Configuration dans RunPod Dashboard

URL : https://www.runpod.io/console/pods

1. **Templates** → **New Template**
2. **Name** : `purple-gpu-render-worker`
3. **Image** : `ghcr.io/goonidz/purple-runpod-handler:cuda12.2`
4. **Environment Variables** : Copier-coller les **7 variables** ci-dessus (RUNPOD_MODE, SUPABASE_*, VPS_*, NVIDIA_*)
5. **Expose HTTP Ports** : (vide)
6. **Expose TCP Ports** : (vide)
7. **Container Disk** : 10 GB minimum
8. **Volume Disk** : (optionnel, pour cache)
9. **Save Template**

Puis dans **Pods** → **Deploy** → Choisir le template + GPU type (RTX 4090 recommandé).

---

**Tout est prêt !** Lance un Pod et teste avec le site. 🚀
