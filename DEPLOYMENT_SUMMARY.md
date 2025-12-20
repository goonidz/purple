# Résumé de la configuration VideoFlow

## Configuration complète réalisée

Ce document résume toute la configuration effectuée pour déployer VideoFlow sur un VPS Linux avec Docker, nginx, DuckDNS, déploiement automatique et SSL.

## Ce qui a été configuré

### 1. Déploiement Docker du Frontend

- **Container Docker** : Frontend React compilé et servi via nginx
- **Port interne** : 8080 (accessible uniquement en local)
- **Port externe** : 80 (via nginx sur l'hôte)
- **Script** : `deploy.sh` - Build et démarrage automatique

### 2. Configuration nginx (Reverse Proxy)

- **Rôle** : Proxy les requêtes vers le container Docker
- **Configuration** : `/etc/nginx/sites-available/videoflow`
- **Domaine** : `purpleai.duckdns.org` → proxy vers `localhost:8080`
- **Script** : `fix-nginx-docker.sh` - Configuration automatique

### 3. Nom de domaine DuckDNS (gratuit)

- **Domaine** : `purpleai.duckdns.org`
- **Mise à jour automatique** : Script cron toutes les 5 minutes
- **Scripts** : 
  - `update-duckdns.sh` - Mise à jour de l'IP
  - `setup-duckdns.sh` - Configuration initiale complète

### 4. Déploiement automatique (GitHub Webhook)

- **Service** : `webhook-server.js` (Node.js)
- **Port** : 9000
- **Fonctionnement** : 
  - Écoute les événements push GitHub
  - Exécute automatiquement `git pull` + `deploy.sh`
  - Le site se met à jour automatiquement
- **Gestion** : PM2 (démarrage automatique au boot)

### 5. Service de rendu vidéo

- **Service** : `video-render-service/server.js` (Node.js + FFmpeg)
- **Port** : 3000
- **Accès** : `http://51.91.158.233:3000` (IP directe)
- **Fonctionnement** : 
  - Reçoit les requêtes de rendu depuis Supabase Edge Functions
  - Rend les vidéos avec FFmpeg (effet Ken Burns)
  - Sert les vidéos directement depuis le VPS
- **Gestion** : PM2 (démarrage automatique au boot)

## Architecture complète

```
┌─────────────────────────────────────────────┐
│  Internet                                   │
└─────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────┐
│  purpleai.duckdns.org (DuckDNS)             │
│  → 51.91.158.233                            │
└─────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────┐
│  VPS Linux (Ubuntu 22.04)                   │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │  Nginx (port 80)                      │ │
│  │  - Proxy vers Docker:8080             │ │
│  │  - Gère le domaine DuckDNS            │ │
│  └───────────────────────────────────────┘ │
│           ↓                                 │
│  ┌───────────────────────────────────────┐ │
│  │  Docker Container (port 8080)         │ │
│  │  - Frontend React (VideoFlow)         │ │
│  │  - nginx interne                      │ │
│  └───────────────────────────────────────┘ │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │  Service Rendu Vidéo (port 3000)      │ │
│  │  - Node.js + FFmpeg                   │ │
│  │  - Accessible via IP:3000             │ │
│  │  - PM2                                │ │
│  └───────────────────────────────────────┘ │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │  Webhook GitHub (port 9000)           │ │
│  │  - Déploiement automatique             │ │
│  │  - PM2                                │ │
│  └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## URLs d'accès

- **Frontend web** : `http://purpleai.duckdns.org`
- **Service vidéo** : `http://51.91.158.233:3000`
- **Webhook** : `http://51.91.158.233:9000/webhook` (interne GitHub)

## Scripts de déploiement

### Scripts principaux

1. **`deploy.sh`** : Déploiement principal
   - Build l'image Docker
   - Démarre le container sur le port 8080
   - Exécute `fix-nginx-docker.sh` automatiquement

2. **`fix-nginx-docker.sh`** : Configuration nginx + Docker
   - Arrête nginx et Docker
   - Redémarre Docker sur le port 8080
   - Configure nginx pour proxy vers Docker
   - Met à jour DuckDNS
   - Teste la configuration

3. **`setup-duckdns.sh`** : Configuration DuckDNS complète
   - Crée le fichier `.duckdns`
   - Configure le script de mise à jour
   - Configure le cron job
   - Installe et configure nginx
   - Configure le firewall

4. **`update-duckdns.sh`** : Mise à jour IP DuckDNS
   - Appelle l'API DuckDNS
   - Met à jour l'IP automatiquement
   - Exécuté toutes les 5 minutes via cron

5. **`webhook-server.js`** : Serveur webhook GitHub
   - Écoute les événements push
   - Exécute `git pull` + `deploy.sh`
   - Géré par PM2

## Workflow de déploiement

### Déploiement automatique (recommandé)

1. **Sur votre machine locale** :
   ```bash
   git add .
   git commit -m "Vos modifications"
   git push origin main
   ```

2. **Sur le VPS (automatique)** :
   - GitHub envoie un webhook
   - `webhook-server.js` reçoit l'événement
   - Exécute `git pull origin main`
   - Exécute `deploy.sh`
   - `deploy.sh` exécute `fix-nginx-docker.sh`
   - Le site est mis à jour automatiquement

### Déploiement manuel

```bash
cd ~/purple
git pull origin main
./deploy.sh
```

## Services PM2

Tous les services Node.js sont gérés par PM2 :

```bash
# Voir tous les services
pm2 status

# Services actifs :
# - video-render : Service de rendu vidéo (port 3000)
# - webhook-deploy : Webhook GitHub (port 9000)

# Logs
pm2 logs video-render
pm2 logs webhook-deploy

# Redémarrer
pm2 restart video-render
pm2 restart webhook-deploy
```

## Configuration des ports

- **Port 80** : Nginx (frontend web via domaine)
- **Port 3000** : Service de rendu vidéo (IP directe)
- **Port 8080** : Docker container (interne uniquement, proxy par nginx)
- **Port 9000** : Webhook GitHub (interne)

## Fichiers de configuration

- **Docker** : `Dockerfile`, `nginx.conf`, `docker-compose.yml`
- **Nginx** : `/etc/nginx/sites-available/videoflow`
- **DuckDNS** : `~/.duckdns` (token et domaine)
- **Environnement** : `.env.production` (variables Supabase)
- **Webhook** : `.env.webhook` (secret webhook)

## Maintenance

### Vérifier que tout fonctionne

```bash
# Services Docker
sudo docker ps

# Services nginx
sudo systemctl status nginx

# Services PM2
pm2 status

# Logs
sudo docker logs videoflow
pm2 logs webhook-deploy
pm2 logs video-render
```

### Mettre à jour manuellement

```bash
cd ~/purple
git pull origin main
./deploy.sh
```

### Redémarrer tous les services

```bash
# Docker
sudo docker restart videoflow

# Nginx
sudo systemctl restart nginx

# PM2
pm2 restart all
```

## Corrections apportées

### Bouton de copie dans CreateFromScratch

Le bouton "Copier" a été corrigé pour fonctionner sur HTTP (sites non sécurisés) :
- Utilise l'API Clipboard moderne si disponible
- Fallback vers `document.execCommand('copy')` si l'API n'est pas disponible
- Sélection automatique du texte en dernier recours
- Gestion d'erreurs complète avec messages utilisateur

### Service de rendu vidéo

Le service de rendu vidéo fonctionne avec le site :
- Accessible via `http://51.91.158.233:3000` (IP directe)
- Les Edge Functions Supabase appellent ce service
- Les vidéos sont servies directement depuis le VPS
- Le frontend poll le statut et affiche les vidéos une fois terminées

## Support

Pour toute question, consultez :
- `DEPLOYMENT.md` : Guide de déploiement détaillé
- `VIDEO_RENDERING_DOCUMENTATION.md` : Documentation du service de rendu vidéo
- `DUCKDNS_SETUP.md` : Guide de configuration DuckDNS
- `DEPLOYMENT_SUMMARY.md` : Ce fichier (résumé complet)
