# Documentation - Système de Rendu Vidéo VideoFlow

## Vue d'ensemble

Le système de rendu vidéo VideoFlow utilise une architecture distribuée avec :
- **Frontend React** : Interface utilisateur pour lancer les rendus
- **Supabase Edge Function** : Orchestrateur qui démarre les jobs de rendu
- **Service FFmpeg sur VPS** : Service Node.js qui effectue le rendu réel avec FFmpeg
- **Stockage VPS** : Les vidéos sont servies directement depuis le VPS (pas d'upload Supabase)

## Architecture

```
Frontend (React)
    ↓
Supabase Edge Function (render-video)
    ↓
Service FFmpeg sur VPS (Node.js + FFmpeg)
    ↓
Fichier vidéo sur VPS → URL publique
    ↓
Frontend (polling du statut)
```

## Flux de rendu vidéo

### 1. Démarrage du rendu (Frontend)

**Fichier** : `src/pages/Index.tsx`

L'utilisateur clique sur "Rendu vidéo" :
- Vérifie que toutes les images sont générées
- Vérifie qu'un fichier audio est présent
- Appelle `renderVideo()` depuis `src/lib/videoRender.ts`

**Fonction** : `handleRenderVideo()`

### 2. Appel Edge Function (Frontend → Supabase)

**Fichier** : `src/lib/videoRender.ts`

La fonction `renderVideo()` :
1. Vérifie l'authentification utilisateur
2. Rafraîchit la session si nécessaire
3. Appelle l'Edge Function `render-video` avec :
   - `projectId`
   - `framerate` (sélectionnable dans l'UI : 1, 5, 10, 15, 23.976, 24, 25, 29.97, 30 fps)
   - `width`, `height`
   - `subtitleSettings` (actuellement désactivé)

**Retour** : `jobId` et `statusUrl` (URL pour poller le statut)

### 3. Polling du statut (Frontend)

**Fichier** : `src/lib/videoRender.ts`

La fonction `waitForJobCompletion()` :
- Poll le service FFmpeg toutes les 2 secondes
- Affiche la progression
- Retourne le résultat final avec `videoUrl`

**Endpoint pollé** : `http://VPS_IP:3000/status/:jobId`

### 4. Orchestration (Edge Function)

**Fichier** : `supabase/functions/render-video/index.ts`

L'Edge Function :
1. **Authentifie l'utilisateur** (extrait le JWT token du header Authorization)
2. **Récupère les données du projet** depuis Supabase :
   - Scènes avec images
   - URL de l'audio
3. **Appelle le service FFmpeg** sur le VPS :
   - POST `http://VPS_IP:3000/render`
   - Retourne immédiatement un `jobId` (pas d'attente)
4. **Retourne le `jobId`** au frontend

**Important** : L'Edge Function ne fait QUE démarrer le job, elle n'attend pas la fin (évite les timeouts).

### 5. Rendu vidéo (Service FFmpeg sur VPS)

**Fichier** : `video-render-service/server.js`

Le service est **asynchrone** :

#### Endpoint `/render` (POST)
- Crée un `jobId` unique
- Retourne immédiatement le `jobId` (status: 'pending')
- Lance le rendu en arrière-plan

#### Processus de rendu (`processRenderJob()`)

**Étapes** :
1. **Télécharge l'audio** depuis Supabase Storage
2. **Télécharge toutes les images** des scènes
3. **Rend chaque scène avec effet Ken Burns** :
   - Scale up 6x (ex: 1440x810 → 8640x4860)
   - Applique zoompan avec effet Ken Burns
   - Scale down vers la résolution cible
   - **Effets disponibles** : zoom_in, zoom_out, zoom_in_left, zoom_out_right, zoom_in_top, zoom_out_bottom
4. **Concatène tous les segments** vidéo
5. **Ajoute l'audio** synchronisé
6. **Encode avec compression** :
   - Preset: `medium`
   - CRF: `28` (bon compromis qualité/taille)
   - Format: MP4 (H.264 + AAC)
7. **Génère l'URL VPS** au lieu d'uploader sur Supabase
8. **Met à jour le statut du job** (status: 'completed', videoUrl)

#### Endpoint `/status/:jobId` (GET)
- Retourne le statut actuel du job
- Inclut : status, progress, videoUrl, duration, fileSize

#### Endpoint `/videos/*` (GET)
- Serve les fichiers vidéo statiques depuis le dossier `temp/`
- Accessible publiquement via `http://VPS_IP:3000/videos/...`

## Effets vidéo

### Effet Ken Burns (Zoom)

#### Problème du jiggle/jitter

Le problème classique avec FFmpeg `zoompan` : les zooms sont saccadés à cause de :
- Erreurs de précision en virgule flottante
- Positionnement sub-pixel
- Chroma subsampling

#### Solution implémentée

**Approche** : Scale up → Zoom → Scale down

1. **Scale up 6x** : L'image est upscalée à 6x la résolution cible
   - Exemple : 1440x810 → 8640x4860
   - Plus de pixels = moins d'erreurs d'arrondi

2. **Zoompan à haute résolution** : L'effet Ken Burns est appliqué à la résolution upscalée
   - Zoom fluide grâce à la précision supplémentaire

3. **Scale down** : Retour à la résolution cible
   - Le fichier final a la taille normale (pas 6x plus gros)

**Formules de zoom** :
- Zoom in : `1 + 0.08 * on / totalFrames` (1.0 → 1.08)
- Zoom out : `1.08 - 0.08 * on / totalFrames` (1.08 → 1.0)
- Positions x/y : `(iw-iw/zoom)/2` pour centré, `/4` pour décalé

**Variations** : 6 types d'effets qui alternent selon le numéro de scène

### Effet Pan

#### Problème initial : Saccades sur scènes longues

**Problème** : Sur les scènes longues (>= 10 secondes), le pan était trop lent, causant un mouvement pixel par pixel visible et des saccades.

**Causes** :
- Pan amount fixe (4%) trop petit pour les scènes longues
- Zoom fixe (1.2x) ne fournissait pas assez de marge pour un pan rapide
- Mouvement trop lent = visible pixel par pixel

#### Solution implémentée (v2.0)

**1. Zoom adaptatif selon la durée** :
- Scènes < 10s : 1.2x zoom (20%)
- Scènes 10-20s : 1.6x zoom (60%)
- Scènes 20-30s : 1.9x zoom (90%)
- Scènes > 30s : 2.2x zoom (120%)

Plus de zoom = plus de marge = possibilité de pan plus rapide sans dépasser les bords.

**2. Pan amount adaptatif** :
- Scènes < 10s : 4% (pan simple)
- Scènes 10-20s : 25% par segment (3x plus rapide)
- Scènes 20-30s : 30% par segment
- Scènes > 30s : 35% par segment

**3. Multi-pans pour scènes longues** :
- Scènes >= 10s : Division en plusieurs segments avec directions différentes
  - 10-20s : 2 pans (changement de direction au milieu)
  - 20-30s : 3 pans
  - > 30s : 4 pans
- Chaque segment panne sur une distance significative (25-35% de l'image)
- Directions variées : pan_left, pan_right, pan_up, pan_down

**Résultat** :
- Mouvement 3-6x plus rapide sur les scènes longues
- Plus de saccades pixel par pixel
- Animation plus dynamique et fluide
- Changement de direction pour maintenir l'intérêt visuel

**Note** : Le preprocessing (scale/crop pour remplir le frame) est appliqué pour éviter les bandes noires, mais le zoom dans l'effet pan lui-même n'est pas un zoom croissant (contrairement à Ken Burns), c'est juste un zoom fixe pour créer de la marge.

## Infrastructure VPS

### Spécifications du serveur

**Fournisseur** : OVH  
**Modèle** : VPS-3  
**OS/Distribution** : Ubuntu 22.04  
**vCores** : 8  
**RAM** : 24 GB  
**Stockage** : 200 GB  
**IP Publique** : 51.91.158.233  
**Domaine** : purpleai.duckdns.org (gratuit via DuckDNS)

### Services déployés

- **Frontend VideoFlow** : Docker container accessible via `http://purpleai.duckdns.org`
  - Nginx sur l'hôte fait le proxy vers Docker (port 8080 interne)
  - Configuration automatique via scripts de déploiement

- **Service de rendu vidéo** : Node.js + FFmpeg sur le port 3000
  - Accessible via `http://51.91.158.233:3000` ou `http://purpleai.duckdns.org:3000`
  - Géré par PM2, démarre automatiquement au boot

- **Webhook GitHub** : Service Node.js sur le port 9000
  - Déploiement automatique à chaque push GitHub
  - Géré par PM2

### Logiciels installés

- **Docker** : v29.1.3 (pour le frontend)
- **Nginx** : 1.18.0 (reverse proxy)
- **Node.js** : v20.19.6
- **npm** : 10.8.2
- **FFmpeg** : 4.4.2
- **PM2** : 6.0.14 (gestionnaire de processus)

### Accès SSH

```bash
ssh ubuntu@51.91.158.233
```

**Note** : Utiliser `ubuntu` (pas `root`) comme utilisateur SSH.

## Configuration

### Variables d'environnement (VPS)

**Fichier** : `video-render-service/.env`

```bash
# Supabase
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_SERVICE_ROLE_KEY=votre_service_role_key

# VPS Public URL (pour les URLs de vidéos)
# Peut utiliser l'IP directe ou le domaine DuckDNS
VPS_PUBLIC_URL=http://51.91.158.233:3000
# Ou avec le domaine (si nginx est configuré pour proxy le port 3000) :
# VPS_PUBLIC_URL=http://purpleai.duckdns.org:3000

# Port du service
PORT=3000
```

### Secrets Supabase (Edge Function)

**Commandes** :
```bash
# Utiliser l'IP directe (recommandé pour le service vidéo)
npx supabase secrets set FFMPEG_SERVICE_URL=http://51.91.158.233:3000

# Ou utiliser le domaine DuckDNS (si nginx proxy le port 3000)
# npx supabase secrets set FFMPEG_SERVICE_URL=http://purpleai.duckdns.org:3000

npx supabase secrets set FFMPEG_SERVICE_API_KEY=votre_api_key_optional
```

**Note** : Le service de rendu vidéo fonctionne actuellement avec l'IP directe (`51.91.158.233:3000`). Le domaine DuckDNS (`purpleai.duckdns.org`) est utilisé pour le frontend web. Les deux fonctionnent en parallèle.

## Nettoyage automatique

### Script de nettoyage

**Fichier** : `video-render-service/cleanup.js`

Le script supprime automatiquement les fichiers vidéo de plus de 3 jours.

**Fonctionnement** :
- Parcourt récursivement le dossier `temp/`
- Vérifie la date de modification de chaque fichier
- Supprime les fichiers > 3 jours
- Supprime les dossiers vides

### Configuration cron

**Commande** :
```bash
crontab -e
```

**Ligne à ajouter** :
```
0 2 * * * cd /home/ubuntu/video-render-service && node cleanup.js >> /home/ubuntu/video-render-service/cleanup.log 2>&1
```

**Exécution** : Tous les jours à 2h du matin

### Nettoyage manuel

```bash
node ~/video-render-service/cleanup.js
```

## Gestion des fichiers

### Structure des fichiers sur VPS

```
~/video-render-service/
├── temp/
│   └── render_TIMESTAMP_ID/
│       ├── audio.mp3
│       ├── images/
│       │   └── scene_0.jpg, scene_1.jpg, ...
│       ├── segments/
│       │   └── segment_0.mp4, segment_1.mp4, ...
│       ├── concat.txt
│       └── output.mp4  ← Fichier final (servi via /videos/)
├── server.js
├── cleanup.js
└── .env
```

### URLs des vidéos

**Format** : `http://VPS_IP:3000/videos/render_TIMESTAMP_ID/output.mp4`

**Exemple** : `http://51.91.158.233:3000/videos/render_1766146493798_15psmvp0e/output.mp4`

**Durée de vie** : 3 jours (suppression automatique)

## Problèmes résolus

### 1. Timeout Edge Function

**Problème** : Les Edge Functions Supabase ont une limite de ~60 secondes, mais les rendus peuvent prendre plusieurs minutes/heures.

**Solution** : Architecture asynchrone
- Edge Function retourne immédiatement un `jobId`
- Le frontend poll le statut
- Pas de timeout possible

### 2. Jiggle/Jitter du zoom

**Problème** : Les zooms FFmpeg étaient saccadés à cause de la précision.

**Solution** : Scale up 6x → Zoom → Scale down
- Plus de précision pendant le zoom
- Zoom fluide sans jiggle

### 3. Taille des fichiers (Supabase Storage)

**Problème** : Les vidéos 1080p dépassaient la limite Supabase (50 MB free, 5 GB standard upload).

**Solution** : 
- Fichiers servis directement depuis le VPS
- Pas d'upload Supabase
- Compression avec CRF 28
- Nettoyage automatique après 3 jours

### 4. Authentification Edge Function

**Problème** : Erreur 401 "Auth session missing" lors de l'appel Edge Function.

**Solution** : Extraction du JWT token et passage direct à `getUser(token)`
```typescript
const token = authHeader.replace('Bearer ', '');
const { data: { user } } = await supabaseAuth.auth.getUser(token);
```

### 5. Pan effect trop lent sur scènes longues

**Problème** : Sur les scènes longues (>= 10s), le pan était trop lent, causant un mouvement pixel par pixel visible et des saccades.

**Solution** :
- Zoom adaptatif : 1.6x à 2.2x selon la durée (au lieu de 1.2x fixe)
- Pan amount augmenté : 25-35% au lieu de 4% pour les scènes longues
- Multi-pans : Division en 2-4 segments avec directions différentes
- Résultat : Mouvement 3-6x plus rapide, plus fluide, sans saccades

### 6. Service de rendu vidéo pointant vers mauvais répertoire

**Problème** : Le service PM2 pointait vers `/home/ubuntu/video-render-service/` au lieu de `~/purple/video-render-service/` (le repo git).

**Solution** :
- Supprimer l'ancien service PM2
- Relancer depuis le bon répertoire (`~/purple/video-render-service/`)
- Installer les dépendances npm si manquantes
- Vérifier avec `pm2 info video-render` que le chemin est correct

### 7. Modals non responsive

**Problème** : Les modals dépassaient de l'écran et n'étaient pas scrollables.

**Solution** :
- Modification du composant de base `DialogContent` pour être responsive
- Layout flex avec zone scrollable pour le contenu
- Boutons d'action fixés en bas, toujours visibles
- Positionnement adaptatif : `inset` sur mobile, centré sur desktop

## Commandes utiles

### VPS

```bash
# Voir les logs du service
pm2 logs video-render

# Redémarrer le service
pm2 restart video-render

# Voir l'espace disque
df -h

# Voir les fichiers dans temp (avec taille)
du -sh ~/video-render-service/temp/*

# Tester le nettoyage manuellement
node ~/video-render-service/cleanup.js

# Vérifier le cron job
crontab -l
```

### Déploiement

```bash
# Déployer l'Edge Function
cd "/Users/Tom/Documents/Cursor/VideoFlow 2"
export SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env | cut -d '=' -f2)
npx supabase functions deploy render-video --no-verify-jwt

# Copier les fichiers sur le VPS
scp video-render-service/server.js ubuntu@51.91.158.233:~/video-render-service/server.js
scp video-render-service/cleanup.js ubuntu@51.91.158.233:~/video-render-service/cleanup.js
```

## Paramètres de rendu

### Compression

- **Preset** : `medium` (bon compromis vitesse/compression)
- **CRF** : `28` (Higher = smaller file, 23 = high quality, 28 = good balance)
- **Format** : MP4 (H.264 + AAC)

### Effet Ken Burns

- **Zoom amount** : 8% (1.0 → 1.08)
- **Scale factor** : 6x (pour éliminer le jiggle)
- **6 types d'effets** : zoom_in, zoom_out, zoom_in_left, zoom_out_right, zoom_in_top, zoom_out_bottom

### Résolutions supportées

- 1440x810 (16:9)
- 1920x1080 (Full HD)
- Autres résolutions personnalisées

## Limitations connues

1. **Fichiers temporaires** : Les fichiers restent sur le VPS pendant 3 jours (espace disque)
2. **Accès public** : Les URLs sont publiques (pas de protection par défaut)
3. **Pas de CDN** : Les vidéos sont servies directement depuis le VPS (pas de cache CDN)

## Améliorations futures possibles

1. **Protection des URLs** : Ajouter un token d'authentification pour les URLs
2. **CDN** : Intégrer Cloudflare ou autre CDN
3. **Compression adaptative** : Ajuster CRF selon la durée de la vidéo
4. **Multiple VPS** : Load balancing pour plusieurs serveurs
5. **Notifications** : Notifier l'utilisateur quand le rendu est terminé

## Version tracking

Le service de rendu vidéo inclut un système de version pour faciliter le debugging et vérifier quelle version tourne.

### Vérifier la version

**Via l'endpoint health** :
```bash
curl http://localhost:3000/health
# Retourne : {"status":"ok","version":"v2.0-pan-fix-25-35percent","timestamp":"..."}
```

**Via les logs PM2** :
```bash
pm2 logs video-render --lines 5
# Affiche : Service Version: v2.0-pan-fix-25-35percent
```

**Dans le code** :
Le service définit `SERVICE_VERSION` dans `server.js` et l'affiche au démarrage et dans l'endpoint `/health`.

### Historique des versions

- **v2.0-pan-fix-25-35percent** : Pan amount augmenté à 25-35%, zoom adaptatif, multi-pans
- Versions précédentes : Pan fixe 4%, zoom fixe 1.2x

## Support

En cas de problème :
1. Vérifier la version du service : `curl http://localhost:3000/health`
2. Vérifier les logs PM2 : `pm2 logs video-render`
3. Vérifier les logs Edge Function dans le dashboard Supabase
4. Vérifier l'espace disque : `df -h`
5. Vérifier que le service pointe vers le bon répertoire : `pm2 info video-render | grep "script path"`
6. Vérifier que les dépendances sont installées : `ls -la ~/purple/video-render-service/node_modules`
