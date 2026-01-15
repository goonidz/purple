# Déploiement RunPod Serverless

Ce guide explique comment déployer et mettre à jour le système de rendu GPU Serverless.

## Architecture

```
Frontend → Edge Function (render-video-gpu)
              ↓
          RunPod Serverless API
              ↓
          Worker (image Docker custom)
              ↓
          Handler Python (handler.py)
              ↓ (real-time updates)
          Supabase DB (gpu_render_jobs)
              ↓ (Realtime subscription)
          Frontend (progress bar + current_step)
```

---

## 🚀 Quick Start (Déploiement complet)

### 1. Build l'image Docker custom

```bash
cd runpod-handler
./build-serverless.sh
```

**Ce que fait le script** :
- Build pour `linux/amd64`
- Push vers `ghcr.io/goonidz/videoflow-gpu-serverless:latest`
- Tag avec timestamp (ex: `20260115-150539`)

### 2. Redémarre les workers RunPod

Va dans **RunPod Dashboard** → **Serverless** → `sr4lev8xioj0pv` → **Workers** :
- Termine tous les workers actifs 🗑️
- De nouveaux workers vont pull la nouvelle image

### 3. Déploie l'Edge Function (si modifiée)

```bash
cd "/Users/Tom/Documents/Cursor/VideoFlow 2"
supabase functions deploy render-video-gpu --no-verify-jwt
```

### 4. Teste

Lance un rendu GPU depuis le frontend et observe :
- ✅ Progress bar en temps réel
- ✅ Current step affiché ("Téléchargement...", "Scène 5/17...")
- ✅ Vidéo finale dans "Rendus finaux"

---

## 📦 Build de l'image Docker

### Dockerfile.serverless

```dockerfile
FROM lestermfp/runpod-ffmpeg-cuda:latest

WORKDIR /app

# Copy files
COPY handler.py /app/handler.py
COPY requirements.txt /app/requirements.txt

# Install dependencies (baked into image)
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir -r requirements.txt

CMD ["python3", "-u", "handler.py"]
```

### build-serverless.sh

```bash
#!/bin/bash
# Build et push l'image custom pour RunPod Serverless

docker buildx build \
  --platform linux/amd64 \
  --push \
  -f Dockerfile.serverless \
  -t ghcr.io/goonidz/videoflow-gpu-serverless:latest \
  -t ghcr.io/goonidz/videoflow-gpu-serverless:$(date +%Y%m%d-%H%M%S) \
  .
```

### Authentification GHCR

Si `push access denied` :

```bash
echo $GITHUB_PAT | docker login ghcr.io -u goonidz --password-stdin
```

Ton GitHub Personal Access Token doit avoir :
- ✅ `read:packages`
- ✅ `write:packages`

---

## 🔧 Configuration RunPod Endpoint

### Environment Variables

Dans RunPod Dashboard → Serverless → `sr4lev8xioj0pv` → **Settings** :

```bash
SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VPS_UPLOAD_URL=https://purpleai.duckdns.org/api/upload-video
VPS_UPLOAD_TOKEN=3d8973d677721dba2bd2b32bde3de73e3112a0c6daf0b5b51b8e87f1780fca30
NVIDIA_VISIBLE_DEVICES=all
NVIDIA_DRIVER_CAPABILITIES=compute,utility,video
```

### Workers Config

- **Min Workers** : 0 (auto-scale)
- **Max Workers** : 3
- **Idle Timeout** : 5s
- **Execution Timeout** : 600s (10 min)
- **GPU** : A40 (16 GB VRAM)

---

## 📊 Migrations DB

Colonnes requises dans `gpu_render_jobs` :

```sql
-- job_id : RunPod job ID
ALTER TABLE gpu_render_jobs ADD COLUMN IF NOT EXISTS job_id TEXT;

-- status_url : RunPod status URL
ALTER TABLE gpu_render_jobs ADD COLUMN IF NOT EXISTS status_url TEXT;

-- current_step : Étape en cours (real-time)
ALTER TABLE gpu_render_jobs ADD COLUMN IF NOT EXISTS current_step TEXT;

-- metadata : Infos du rendu (durée, taille, etc.)
ALTER TABLE gpu_render_jobs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Index
CREATE INDEX IF NOT EXISTS idx_gpu_render_jobs_job_id ON gpu_render_jobs(job_id);
```

**Appliquer avec** :

```bash
node scripts/apply-gpu-jobs-columns.cjs
node scripts/apply-gpu-jobs-metadata.cjs
```

---

## 🔄 Workflow Handler → DB

### handler.py

```python
def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    job_input = job.get('input', {})
    db_job_id = job_input.get('dbJobId')  # Passé par Edge Function

    def _cb(progress: int):
        # Update progress dans DB
        update_gpu_job(db_job_id, {"progress": progress})
    
    def _step_cb(step: str):
        # Update current_step dans DB
        update_gpu_job(db_job_id, {"current_step": step})
    
    # Render
    result = render_video_payload(job_input, progress_cb=_cb, step_cb=_step_cb)
    
    # Update final
    if result.get("success"):
        update_gpu_job(db_job_id, {
            "status": "completed",
            "progress": 100,
            "video_url": result["videoUrl"],
            "metadata": { ... }
        })
```

### Edge Function

```typescript
// Créer job dans DB
const { data: dbJob } = await supabase
  .from('gpu_render_jobs')
  .insert({ ... })
  .select()
  .single();

// Passer dbJobId au handler
renderData.dbJobId = dbJob.id;

// Trigger RunPod
await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
  body: JSON.stringify({ input: renderData })
});
```

---

## 🎨 Frontend Real-time

### useGpuRenderJobs Hook

```typescript
// Subscription Realtime
supabase
  .channel('gpu-render-jobs')
  .on('postgres_changes', {
    event: '*',
    table: 'gpu_render_jobs',
    filter: `project_id=eq.${projectId}`
  }, (payload) => {
    const job = payload.new;
    console.log('Progress:', job.progress, 'Step:', job.current_step);
    // Update UI
  })
```

### GpuRenderJobIndicator Component

```tsx
{job.current_step && (
  <div className="flex items-center gap-2 text-xs mb-2">
    <Loader2 className="h-3 w-3 animate-spin" />
    <span>{job.current_step}</span>
  </div>
)}
```

---

## 🐛 Debugging

### Logs Handler

**RunPod Dashboard** → **Serverless** → `sr4lev8xioj0pv` → **Requests** → Cliquer sur le job → **Logs**

### Logs Edge Function

**Supabase Dashboard** → **Edge Functions** → `render-video-gpu` → **Logs**

### Logs Frontend

Console Chrome :
```
🔔 [GPU] Realtime update: UPDATE xxx pending 20 current_step: Téléchargement de 17 images...
🔄 [GPU] Job updated: xxx status: pending progress: 20 current_step: Téléchargement...
```

---

## 📈 Monitoring

### DB Query

```sql
SELECT 
  id,
  status,
  progress,
  current_step,
  video_url,
  metadata,
  created_at,
  updated_at
FROM gpu_render_jobs
WHERE status = 'processing'
ORDER BY created_at DESC;
```

### RunPod Metrics

Dashboard → Serverless → Analytics :
- Request count
- Execution time
- Worker utilization
- Coûts

---

## ✅ Checklist Déploiement

- [ ] Build image : `./build-serverless.sh`
- [ ] Push réussi vers GHCR
- [ ] Terminate workers RunPod (pull nouvelle image)
- [ ] Migrations DB appliquées
- [ ] Edge Function déployée
- [ ] Frontend build/refresh
- [ ] Test end-to-end
- [ ] Vérifier logs (handler + DB)
- [ ] Vérifier progress bar temps réel

---

**C'est prêt !** 🎉
