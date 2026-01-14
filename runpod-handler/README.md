# RunPod GPU Video Rendering Handler

Ce dossier contient le handler RunPod Serverless pour le rendu vidéo accéléré par GPU.

## Architecture

```
Frontend (Toggle GPU ON)
    ↓
Edge Function (render-video-gpu)
    ↓
RunPod Serverless API
    ↓
Ce Handler (FFmpeg + NVENC)
    ↓
Supabase Storage (vidéo finale)
```

## Fichiers

- `handler.py` - Point d'entrée RunPod Serverless
- `Dockerfile` - Image Docker avec CUDA + FFmpeg NVENC
- `requirements.txt` - Dépendances Python

## Déploiement sur RunPod

### 1. Créer un compte RunPod

1. Aller sur [runpod.io](https://runpod.io)
2. Créer un compte
3. Ajouter des crédits

### 2. Construire et pousser l'image Docker

```bash
# Depuis ce dossier
docker build -t your-dockerhub/videoflow-gpu:latest .
docker push your-dockerhub/videoflow-gpu:latest
```

### 3. Créer un Endpoint Serverless

1. Aller dans **Serverless** > **Endpoints**
2. Cliquer sur **New Endpoint**
3. Configurer:
   - **Name**: `videoflow-gpu`
   - **Docker Image**: `your-dockerhub/videoflow-gpu:latest`
   - **GPU Type**: RTX 4090 ou A100 (recommandé)
   - **Max Workers**: 3-5 selon budget
   - **Idle Timeout**: 30 secondes
   - **Execution Timeout**: 600 secondes (10 min)

4. **Environment Variables** (dans l'onglet Advanced):
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```

5. Cliquer **Deploy**

### 4. Récupérer les credentials

1. Copier l'**Endpoint ID** (ex: `abc123xyz`)
2. Aller dans **Settings** > **API Keys**
3. Créer ou copier votre **API Key**

### 5. Configurer Supabase

Dans le Dashboard Supabase > **Edge Functions** > **Secrets**:

```
RUNPOD_API_KEY=your-runpod-api-key
RUNPOD_ENDPOINT_ID=your-endpoint-id
```

## Test local

```bash
# Installer les dépendances
pip install -r requirements.txt

# Tester le handler (nécessite NVIDIA GPU)
python handler.py
```

## Coûts estimés

| GPU | Prix/sec | Vidéo 2min (~30 scenes) |
|-----|----------|-------------------------|
| RTX 4090 | $0.00044 | ~$0.02-0.05 |
| A100 | $0.00139 | ~$0.07-0.15 |

Le rendu est ~10-20x plus rapide qu'en CPU.

## Monitoring

- Dashboard RunPod: Voir les jobs en cours
- Logs: Dans l'onglet Logs de l'endpoint
- Supabase: Table `video_render_jobs` avec `metadata.renderType = 'gpu'`
