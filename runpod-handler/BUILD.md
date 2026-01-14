# Build et déployer l'image RunPod GPU Worker

## Prérequis

1. Docker installé sur ton Mac
2. Authentifié sur GitHub Container Registry (GHCR)

```bash
# Se connecter à GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u goonidz --password-stdin
```

## Build et push l'image

```bash
cd "/Users/Tom/Documents/Cursor/VideoFlow 2"

# Build pour linux/amd64 (RunPod) et push vers GHCR
docker buildx build --platform linux/amd64 \
  -t ghcr.io/goonidz/purple-runpod-handler:latest \
  -t ghcr.io/goonidz/purple-runpod-handler:v$(date +%Y%m%d) \
  -f runpod-handler/Dockerfile \
  --push \
  .
```

## Créer le template RunPod

1. Va sur **RunPod Dashboard** → **Templates** → **New Template**

2. Configure :
   - **Name** : `purple-gpu-worker-v2`
   - **Image** : `ghcr.io/goonidz/purple-runpod-handler:latest`
   - **Environment Variables** :
     ```
     RUNPOD_MODE=worker
     SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
     SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTg4MjA2MSwiZXhwIjoyMDgxNDU4MDYxfQ.8WIZ3w_ouqXivqQms7sqjnxnTdA06hcwym966LYeh4w
     ```
   - **Container Disk** : 10 GB
   - **Volume** : 50 GB (optionnel, pour cache)

3. **Save Template**

## Lancer un Pod avec le template

1. **Pods** → **Deploy**
2. Sélectionne le template `purple-gpu-worker-v2`
3. Choisis un GPU :
   - **RTX 4090** : ~$0.49/h (3 sessions NVENC max)
   - **A6000** : ~$0.79/h (NVENC illimité)
4. **Deploy**

Le Pod va :
- Démarrer avec l'image
- Détecter le GPU et NVENC
- Se connecter à Supabase
- Commencer à poll `gpu_render_jobs` pour des jobs

## Performance attendue

| Étape | Temps | Amélioration |
|-------|-------|--------------|
| Téléchargement 17 images | 3-5s | 10x plus rapide (parallèle) |
| Processing 17 scènes | 15-20s | 3x plus rapide (3 workers) |
| Concat + audio + upload | 3-5s | - |
| **Total** | **25-30s** | **2x plus rapide que VPS CPU** |

## Troubleshooting

### Image not found
- Vérifie que l'image est publique sur GHCR
- Ou configure RunPod avec tes credentials GitHub

### NVENC errors
- Assure-toi d'utiliser un GPU NVIDIA
- RTX 4090 limite : 3 sessions max
- Si besoin d'illimité : utilise A6000

### Worker ne claim pas de jobs
- Vérifie `RUNPOD_MODE=worker`
- Vérifie `SUPABASE_SERVICE_KEY` (pas anon key)
- Vérifie que des jobs pending existent dans `gpu_render_jobs`

## Mise à jour de l'image

Quand tu modifies le code :

```bash
# 1. Commit et push sur GitHub
git add runpod-handler/handler.py
git commit -m "Update: ..."
git push

# 2. Rebuild et push l'image
docker buildx build --platform linux/amd64 \
  -t ghcr.io/goonidz/purple-runpod-handler:latest \
  -f runpod-handler/Dockerfile \
  --push \
  .

# 3. Redémarre les Pods RunPod pour qu'ils pull la nouvelle image
```
