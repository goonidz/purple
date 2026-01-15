# Documentation GPU Rendering - Index

Ce document référence toute la documentation pour le système de rendu GPU (RunPod Serverless).

---

## 📖 Guides Principaux

### 1. [RUNPOD_POD_CONFIG.md](../RUNPOD_POD_CONFIG.md)
**Configuration complète RunPod (Serverless + Pod)**

- ✅ Architecture Serverless vs Pod
- ✅ Configuration de l'Endpoint RunPod
- ✅ Variables d'environnement
- ✅ Optimisations et performances
- ✅ Comparaison coûts
- ✅ Troubleshooting

**À consulter pour** : Configuration initiale, comparaison modes, debugging

---

### 2. [runpod-handler/SERVERLESS_DEPLOY.md](../runpod-handler/SERVERLESS_DEPLOY.md)
**Guide de déploiement Serverless (pas-à-pas)**

- 🚀 Quick Start (build + deploy)
- 📦 Build de l'image Docker custom
- 🔧 Configuration RunPod Endpoint
- 📊 Migrations DB
- 🔄 Workflow Handler → DB → Frontend
- 🐛 Debugging
- ✅ Checklist déploiement

**À consulter pour** : Déployer une mise à jour, comprendre le workflow complet

---

### 3. [runpod-handler/ZOOM_IMPLEMENTATION.md](../runpod-handler/ZOOM_IMPLEMENTATION.md)
**Détails techniques zoom GPU (CuPy vs OpenCV)**

- ⚡ CuPy GPU + HTTP/2 (version actuelle)
- 🔄 OpenCV CPU (backup)
- 📊 Comparaison performances
- 🎨 Qualité subpixel

**À consulter pour** : Comprendre les optimisations zoom, performances benchmarks

---

### 4. [runpod-handler/README.md](../runpod-handler/README.md)
**Vue d'ensemble du handler**

- 🚀 Architecture Serverless
- ⚡ Technologies utilisées
- 💰 Coûts
- 📊 Monitoring
- 🐛 Troubleshooting rapide

**À consulter pour** : Comprendre le handler, monitoring, quick troubleshooting

---

## 🗂️ Guides Complémentaires

### 5. [HOW_TO_DEPLOY.md](./HOW_TO_DEPLOY.md)
**Déploiement général de l'app (Frontend + Backend + Edge Functions)**

- Frontend (Docker + nginx VPS)
- Supabase Edge Functions
- Video Render Service (VPS)
- **Video Storage API (VPS)** - Upload illimité

**À consulter pour** : Déploiement complet de l'infrastructure

---

### 6. [video-storage-api/DEPLOY.md](../video-storage-api/DEPLOY.md)
**Déploiement de l'API de stockage vidéo (VPS)**

- Configuration Nginx (upload illimité)
- Service Node.js/Express
- PM2 management
- Upload depuis RunPod handler

**À consulter pour** : Configurer le VPS pour uploads vidéo

---

### 7. [SUPABASE_MIGRATIONS.md](./SUPABASE_MIGRATIONS.md)
**Appliquer des migrations DB via API**

- Scripts Node.js pour migrations
- Méthode cURL rapide
- Exemples de migrations courantes

**À consulter pour** : Appliquer une migration quand `supabase db push` fail

---

## 🔄 Workflow Complet

### Modification du handler

1. **Éditer** `runpod-handler/handler.py`
2. **Build** `cd runpod-handler && ./build-serverless.sh`
3. **Redémarrer** workers RunPod (Terminate dans Dashboard)
4. **Tester** un rendu GPU

**Docs** : [SERVERLESS_DEPLOY.md](../runpod-handler/SERVERLESS_DEPLOY.md)

---

### Ajout d'une colonne DB

1. **Créer** migration SQL dans `supabase/migrations/`
2. **Créer** script `scripts/apply-*.cjs`
3. **Appliquer** `node scripts/apply-*.cjs`
4. **Mettre à jour** TypeScript types si nécessaire

**Docs** : [SUPABASE_MIGRATIONS.md](./SUPABASE_MIGRATIONS.md)

---

### Modification Edge Function

1. **Éditer** `supabase/functions/render-video-gpu/index.ts`
2. **Deploy** `supabase functions deploy render-video-gpu --no-verify-jwt`
3. **Tester** depuis le frontend

**Docs** : [HOW_TO_DEPLOY.md](./HOW_TO_DEPLOY.md)

---

## 🎯 Guides par Cas d'Usage

### Debugging un rendu lent
📖 [RUNPOD_POD_CONFIG.md](../RUNPOD_POD_CONFIG.md) → Section "Optimisations et Performances"  
📖 [ZOOM_IMPLEMENTATION.md](../runpod-handler/ZOOM_IMPLEMENTATION.md) → Comparaison performances

### Erreur "file too large"
📖 [video-storage-api/DEPLOY.md](../video-storage-api/DEPLOY.md) → Nginx configuration  
📖 [RUNPOD_POD_CONFIG.md](../RUNPOD_POD_CONFIG.md) → Section "VPS Video Storage API"

### Progress bar ne s'affiche pas
📖 [SERVERLESS_DEPLOY.md](../runpod-handler/SERVERLESS_DEPLOY.md) → Section "Frontend Real-time"  
📖 [RUNPOD_POD_CONFIG.md](../RUNPOD_POD_CONFIG.md) → Section "Real-time Progress Tracking"

### Worker ne démarre pas
📖 [SERVERLESS_DEPLOY.md](../runpod-handler/SERVERLESS_DEPLOY.md) → Section "Debugging"  
📖 [RUNPOD_POD_CONFIG.md](../RUNPOD_POD_CONFIG.md) → Section "Troubleshooting Serverless"

### Coût trop élevé
📖 [RUNPOD_POD_CONFIG.md](../RUNPOD_POD_CONFIG.md) → Section "Coût estimé"  
📖 [README.md](../runpod-handler/README.md) → Section "Coûts Serverless"

---

## 📚 Structure Complète

```
VideoFlow 2/
├── docs/
│   ├── HOW_TO_DEPLOY.md                    # Déploiement général
│   ├── SUPABASE_MIGRATIONS.md              # Migrations DB
│   └── GPU_RENDERING_DOCS.md               # Ce fichier
├── runpod-handler/
│   ├── handler.py                          # Handler Python
│   ├── Dockerfile.serverless               # Image custom
│   ├── build-serverless.sh                 # Script build
│   ├── README.md                           # Vue d'ensemble
│   ├── SERVERLESS_DEPLOY.md                # Guide déploiement
│   └── ZOOM_IMPLEMENTATION.md              # Détails zoom
├── video-storage-api/
│   └── DEPLOY.md                           # Upload VPS
├── RUNPOD_POD_CONFIG.md                    # Config complète
└── supabase/
    ├── functions/render-video-gpu/         # Edge Function
    └── migrations/                         # Migrations DB
```

---

## ✅ État Actuel (Janvier 2026)

### ✨ Fonctionnel
- ✅ RunPod Serverless auto-scaling
- ✅ Image Docker custom (démarrage ~5-10s)
- ✅ CuPy GPU zoom (bilinear)
- ✅ HTTP/2 downloads parallèles
- ✅ Progress temps réel (DB + Realtime)
- ✅ Current step affiché ("Scène 5/17...")
- ✅ Upload VPS illimité
- ✅ 20 workers parallèles
- ✅ Metadata enregistrées
- ✅ NVENC illimité (A40)

### 📊 Performances
- **102 scènes** (9 min vidéo) : **~3 minutes** total
- **Coût** : ~$0.05 (5 centimes)
- **Speedup vs CPU** : **6-10x**

### 🎯 Mode Recommandé
**RunPod Serverless** (auto-scale, pay-per-second, real-time progress)

---

**Système 100% opérationnel !** 🎉

Pour toute question, consulter les docs ci-dessus ou les sections Troubleshooting.
