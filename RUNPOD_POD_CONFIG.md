# Configuration RunPod (Pod & Serverless)

Ce document couvre **deux modes de déploiement** :
1. **RunPod Serverless** (recommandé) - Auto-scaling, pay-per-second
2. **RunPod Pod** (legacy) - Polling persistant

## ⚡ Mode Serverless (Recommandé - Janvier 2026)

### ✅ Déploiement Serverless actif

1. **Migration DB** : `gpu_render_jobs` table avec colonnes Serverless ✅
   - `job_id` : RunPod job ID
   - `status_url` : RunPod status URL  
   - `current_step` : Étape en cours (temps réel)
   - `metadata` : Métadonnées du rendu
2. **Edge Function** : `render-video-gpu` (mode Serverless) ✅  
   URL: `https://laqgmqyjstisipsbljha.supabase.co/functions/v1/render-video-gpu`
3. **Image Docker Custom** : `ghcr.io/goonidz/videoflow-gpu-serverless:latest` ✅  
   - Toutes les dépendances pre-installées (démarrage instant)
   - CuPy, httpx, FFmpeg, NVENC support
4. **RunPod Endpoint** : `sr4lev8xioj0pv` ✅
5. **Real-time Progress** : Supabase Realtime subscriptions ✅

### Avantages Serverless vs Pod
- ✅ **Auto-scaling** : Workers démarrent/stoppent automatiquement
- ✅ **Pay-per-second** : Pas de coût quand idle
- ✅ **Démarrage instant** : ~5-10s (image custom pré-buildée)
- ✅ **Progress temps réel** : `current_step` + `progress` dans DB
- ✅ **Pas de polling** : HTTP trigger direct depuis Edge Function

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
- 🚀 **Pas de limite de taille** (`client_max_body_size 0` = illimité dans Nginx)
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

### 4. Optimisations et Performances

**Version actuelle (Janvier 2026)** :
- ✅ **Downloads HTTP/2** : `httpx` avec asyncio pour télécharger toutes les images en parallèle (~32s pour 102 images)
- ✅ **GPU Zoom CuPy** : Interpolation bilinear (order=1) sur GPU (~1-2s par scène)
- ✅ **Streaming FFmpeg** : Frames streamées directement à FFmpeg (pas de disk I/O)
- ✅ **20 workers** : Processing parallèle de 20 scènes simultanément
- ✅ **Upload VPS illimité** : Nginx configuré sans limite de taille

**Performances réelles (GPU A40)** :
- 102 scènes (9 minutes vidéo) : **~3 minutes** de rendering total
  - Download images : ~32s
  - Processing scènes : ~200s
  - Upload VPS : ~60s

**Dépendances clés** :
- `httpx[http2]>=0.27.0` : Downloads HTTP/2 multiplexing
- `cupy-cuda11x>=11.0.0` : GPU acceleration (CUDA 11.8 compatible)
- `opencv-python-headless>=4.8.0` : Fallback CPU + image loading

Voir `runpod-handler/ZOOM_IMPLEMENTATION.md` pour comparaison technique détaillée.

---

## Configuration RunPod Serverless Endpoint

### 1. Image Docker Custom

**Image** : `ghcr.io/goonidz/videoflow-gpu-serverless:latest`

Cette image contient **toutes les dépendances pré-installées** :
- CuPy (CUDA 11.8)
- httpx[http2]
- FFmpeg avec NVENC
- runpod Python SDK

**Pourquoi une image custom ?**
- ⚡ **Démarrage instant** : ~5-10s (vs 2-3 min pour `pip install`)
- 💰 **Économies** : Pas de temps facturé pour l'installation
- 🔒 **Reproductible** : Même environnement à chaque fois

### 2. Build de l'image custom

Quand tu modifies `handler.py` ou `requirements.txt` :

```bash
cd runpod-handler
./build-serverless.sh
```

Le script :
1. Build l'image pour `linux/amd64`
2. Push vers GitHub Container Registry (GHCR)
3. Tag avec `latest` + timestamp

**Important** : L'image doit être **publique** ou RunPod doit avoir les credentials GHCR.

### 3. Configuration de l'Endpoint RunPod

Dashboard URL : https://www.runpod.io/console/serverless

#### Settings
- **Name** : `purple-gpu-render-serverless`
- **Endpoint ID** : `sr4lev8xioj0pv`
- **Container Image** : `ghcr.io/goonidz/videoflow-gpu-serverless:latest`
- **GPU Types** : A40, A100, L40 (datacenter GPUs avec NVENC illimité)

#### Environment Variables

```bash
# Supabase (pour real-time DB updates)
SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# VPS Video Storage (upload illimité)
VPS_UPLOAD_URL=https://purpleai.duckdns.org/api/upload-video
VPS_UPLOAD_TOKEN=3d8973d677721dba2bd2b32bde3de73e3112a0c6daf0b5b51b8e87f1780fca30

# GPU
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=compute,utility,video
```

#### Workers Configuration
- **Min Workers** : 0 (pas de workers quand idle)
- **Max Workers** : 3 (ajuste selon budget)
- **Idle Timeout** : 5 secondes
- **Execution Timeout** : 600 secondes (10 min max par rendu)
- **GPU Memory** : 16 GB (A40 recommandé)

### 4. Edge Function Configuration

Dans Supabase Dashboard → Edge Functions → `render-video-gpu` :

**Environment Secrets** :
```bash
RUNPOD_API_KEY=<ta clé API RunPod>
RUNPOD_ENDPOINT_ID=sr4lev8xioj0pv
```

### 5. Workflow Serverless complet

1. **Frontend** : User clique "Render" avec GPU ON
2. **Edge Function** `render-video-gpu` :
   - Crée un job dans `gpu_render_jobs` (status=pending, progress=0)
   - Récupère le `dbJobId`
   - POST `https://api.runpod.ai/v2/sr4lev8xioj0pv/run` avec payload + `dbJobId`
3. **RunPod** :
   - Auto-scale un worker (A40) en ~5-10s
   - Charge l'image custom (déjà buildée)
   - Exécute `handler(job)` avec le payload
4. **Handler Python** :
   - Reçoit `dbJobId` dans `job['input']['dbJobId']`
   - Update `gpu_render_jobs` en temps réel :
     - `current_step`: "Téléchargement de l'audio...", "Scène 5/17...", etc.
     - `progress`: 0-100%
   - Render vidéo avec CuPy + NVENC
   - Upload vers VPS
   - Update final : `status=completed`, `video_url`, `metadata`
5. **Frontend** :
   - Subscribe Realtime à `gpu_render_jobs` (via `useGpuRenderJobs` hook)
   - Affiche progress bar + `current_step` en temps réel
   - Montre vidéo finale quand `status=completed`

### 6. Real-time Progress Tracking

**Colonnes DB `gpu_render_jobs`** :
- `current_step` (TEXT) : "Téléchargement de 17 images...", "Scène 10/17 terminée...", "Upload de la vidéo..."
- `progress` (INTEGER) : 0-100%
- `job_id` (TEXT) : RunPod job ID
- `status_url` (TEXT) : RunPod status URL (pour debugging)
- `metadata` (JSONB) : `{ duration, fileSizeMB, resolution, encoder, gpuAccelerated }`

**Frontend subscription** :
```typescript
supabase
  .channel('gpu-render-jobs')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'gpu_render_jobs',
    filter: `project_id=eq.${projectId}`
  }, (payload) => {
    // Update UI avec progress + current_step
  })
```

---

### 5. GPU Requirements
- **Type** : NVIDIA GPU datacenter (A40, A100, L40 recommandés)
- **CUDA Version** : 11.8+ (handler compatible CUDA 11.x et 12.x)
- **NVENC** : Unlimited sessions sur datacenter GPUs (vs 3-5 sessions sur consumer GPUs)

**Recommandation** : A40 sur RunPod = excellent rapport qualité/prix (~$0.40/h)

### 6. Ports
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

## Test Serverless end-to-end

1. **Vérifier l'Endpoint** : RunPod Dashboard → Serverless → `sr4lev8xioj0pv`
   - Status : **Active**
   - Workers disponibles : 0 (idle) ou 1+ (actif)

2. **Frontend** : Créer un projet, activer GPU toggle, cliquer "Render"

3. **Observer les logs** :
   - Console Chrome : `🔔 [GPU] Realtime update... current_step: Téléchargement...`
   - RunPod Dashboard → Requests : Voir le job en cours
   - RunPod Dashboard → Workers → Logs : Voir les logs du handler

4. **Vérifier DB** :
   ```sql
   SELECT id, status, progress, current_step, video_url, metadata
   FROM gpu_render_jobs 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```

### Redémarrer un worker Serverless

Si l'image Docker a changé (rebuild) :

1. **RunPod Dashboard** → **Serverless** → `sr4lev8xioj0pv`
2. **Workers** tab
3. **Terminate** le worker actif (🗑️)
4. Un nouveau worker va démarrer automatiquement avec la nouvelle image

**Pas besoin de rebuild l'endpoint** - juste tuer les workers pour forcer le pull de `latest`.

---

## Troubleshooting

### Serverless

#### Worker reste "throttled"
- **Normal** : C'est l'état idle (pas de job en cours)
- Lance un rendu pour voir le worker passer à "running"

#### Erreur "Could not find column 'xxx' in schema cache"
- **Cause** : Migration DB manquante
- **Fix** : Appliquer la migration via `scripts/apply-*.cjs`
- Colonnes requises : `job_id`, `status_url`, `current_step`, `metadata`

#### Frontend ne voit pas le progress
- Vérifier que `current_step` est bien dans l'interface `GpuRenderJob` (TypeScript)
- Vérifier les logs console : doit afficher `current_step: ...`
- Vérifier que `GpuRenderJobIndicator` affiche bien `job.current_step`

#### Image Docker "push access denied"
- **Cause** : Pas de credentials GHCR
- **Fix** :
  ```bash
  echo $GITHUB_PAT | docker login ghcr.io -u goonidz --password-stdin
  ```
- Vérifier que le PAT a les permissions `read:packages` + `write:packages`

#### Handler ne met pas à jour la DB
- Vérifier que `SUPABASE_SERVICE_KEY` est set dans l'Endpoint
- Vérifier les logs handler : `[Serverless] Updating DB job...`
- Tester manuellement la connexion DB depuis le handler

### Pod (Legacy)

#### Le Pod ne claim pas de jobs

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

## Coût estimé

### Serverless (recommandé)
- **A40** : ~$0.00024/seconde (~$0.86/h si toujours actif)
- **Facturation** : Pay-per-second, auto-stop
- **Vidéo 17 scènes** (102 images, 2:34) : ~70s total → **$0.017** (~2 centimes)
- **Vidéo 100 scènes** (9 min) : ~200s total → **$0.048** (~5 centimes)

### Pod (legacy, pay-per-use)
- **RTX 4090** : ~$0.49/h (démarrage : 30-60s, arrêt manuel)
- **Vidéo courte** (10 scènes, 60s) : ~2-3 min → ~$0.02-0.04
- **Vidéo longue** (30 scènes, 3 min) : ~5-8 min → $0.04-0.07

### Comparaison CPU VPS
- **Même vidéo sur CPU** : 15-20 min
- **GPU Serverless** : ~3 min
- **Speedup** : **6-10x plus rapide** ⚡
- **Coût** : ~5 centimes vs gratuit (VPS déjà payé), mais **10x plus rapide**

---

## Serverless vs Pod : Comparaison

| Critère | Serverless (actuel) | Pod (legacy) |
|---------|---------------------|--------------|
| **Démarrage** | ~5-10s (image custom) | ~30-60s |
| **Coût idle** | $0 (auto-stop) | $0.49/h si oublié |
| **Scaling** | Auto (0-3 workers) | Manuel |
| **Progress tracking** | Real-time DB updates | Real-time DB updates |
| **Complexité** | Simple (HTTP trigger) | Moyenne (polling) |
| **Recommandé pour** | Production | Dev/Debug |

**Recommandation** : Utilise **Serverless** sauf si tu débug le handler (Pod plus facile à monitorer).

---

## Configuration dans RunPod Dashboard (Pod - Legacy)

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
