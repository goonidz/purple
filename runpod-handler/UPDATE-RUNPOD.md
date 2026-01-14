# 🚀 Comment mettre à jour RunPod

## Architecture

```
main branch     → VPS (video-render-service)
runpod branch   → RunPod Serverless (GPU rendering)
```

Les deux sont **séparés** - un push sur `main` n'affecte pas RunPod et vice versa.

---

## 📋 Pour mettre à jour RunPod

### Étape 1 : Faire vos modifications sur `main`

```bash
# Modifier les fichiers dans runpod-handler/
git add .
git commit -m "Description des changements"
git push origin main
```

### Étape 2 : Déployer sur RunPod

```bash
# Merger main dans runpod et pusher
git checkout runpod
git merge main
git push origin runpod
git checkout main
```

### Étape 3 : Vérifier le build

1. Aller sur [RunPod Dashboard](https://www.runpod.io/console/serverless)
2. Cliquer sur l'endpoint **"purple"**
3. Onglet **"Builds"**
4. Attendre que le build soit **"Completed"**

---

## ⚡ Commande rapide (tout en un)

```bash
# Depuis la branche main, après avoir fait vos commits
git checkout runpod && git merge main && git push origin runpod && git checkout main
```

---

## 🔧 Fichiers concernés

| Fichier | Description |
|---------|-------------|
| `runpod-handler/handler.py` | Code Python du handler |
| `runpod-handler/Dockerfile` | Image Docker (FFmpeg, NVENC, etc.) |
| `runpod-handler/requirements.txt` | Dépendances Python |

---

## 📊 Temps de build estimés

| Modification | Temps de build |
|--------------|----------------|
| Seulement `handler.py` | ~2-3 min (cache Docker) |
| `Dockerfile` modifié | ~12-15 min (recompile FFmpeg) |
| `requirements.txt` modifié | ~3-5 min |

---

## 🐛 Debugging

### Voir les logs d'un job
1. RunPod Dashboard → endpoint → **"Logs"**
2. Ou **"Requests"** → cliquer sur un job → voir les logs

### Logs attendus (si NVENC fonctionne)
```
[GPU Handler] GPU detected: NVIDIA GeForce RTX 4090, 24564 MiB
[GPU Handler] ✅ NVENC GPU encoder available and working!
[GPU Handler] Using encoder: h264_nvenc (GPU: True)
```

### Logs si fallback CPU
```
[GPU Handler] ⚠️ NVENC not available, using CPU encoder (libx264)
[GPU Handler] Using encoder: libx264 (GPU: False)
```

---

## 🔑 Variables d'environnement RunPod

À configurer dans le Dashboard RunPod (Manage → Edit Endpoint → Environment Variables) :

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL de votre projet Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key Supabase |

---

## ⚠️ Ne pas oublier

- **Ne jamais push directement sur `runpod`** - toujours passer par `main` puis merger
- **Attendre que le build soit "Completed"** avant de tester
- **Le VPS n'est pas affecté** par les push sur `runpod`
