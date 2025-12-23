# Services VPS - VideoFlow

## Vue d'ensemble

Tous les services sont hébergés sur un VPS OVH :

| Service | Port | Description | PM2 Name |
|---------|------|-------------|----------|
| **Frontend** | 80 (nginx) | Site web VideoFlow | Docker container |
| **Video Render** | 3000 | Rendu vidéo avec FFmpeg | `video-render` |
| **Webhook Deploy** | 9000 | Déploiement auto GitHub | `webhook-deploy` |

## Informations VPS

| Info | Valeur |
|------|--------|
| **Fournisseur** | OVH |
| **OS** | Ubuntu 22.04 |
| **vCores** | 8 |
| **RAM** | 24 GB |
| **Stockage** | 200 GB |
| **IP Publique** | 51.91.158.233 |
| **Domaine** | purpleai.duckdns.org |

### Accès SSH

```bash
ssh ubuntu@51.91.158.233
```

---

## 1. Frontend (Docker + Nginx)

**Port** : 80 (public via nginx reverse proxy)

Le frontend React est servi via Docker, avec Nginx en reverse proxy.

### Fichiers
- `/home/ubuntu/purple/` - Code source
- Nginx config dans `/etc/nginx/`

### URLs
- http://purpleai.duckdns.org
- http://51.91.158.233

### Commandes
```bash
# Voir les containers Docker
docker ps

# Logs
docker logs <container_id>
```

---

## 2. Video Render Service

**Port** : 3000  
**PM2 Name** : `video-render`  
**Répertoire** : `~/purple/video-render-service/`

Service Node.js qui rend les vidéos avec FFmpeg (effet Ken Burns, pan, etc.)

### URLs
- Health check : http://51.91.158.233:3000/health
- Vidéos : http://51.91.158.233:3000/videos/...

### API Endpoints
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/health` | État du service |
| POST | `/render` | Lancer un rendu (async) |
| GET | `/status/:jobId` | Statut d'un job |
| GET | `/videos/*` | Servir les vidéos |

### Commandes
```bash
cd ~/purple/video-render-service

# Logs
pm2 logs video-render

# Redémarrer
pm2 restart video-render

# Status
pm2 status
```

### Nettoyage automatique
- Cron job à 2h du matin
- Supprime les vidéos > 3 jours

### Documentation complète
→ `video-render-service/README.md`  
→ `VIDEO_RENDERING_DOCUMENTATION.md`

---

## 3. Webhook Deploy Service

**Port** : 9000  
**PM2 Name** : `webhook-deploy`

Reçoit les webhooks GitHub pour déployer automatiquement le site.

### Commandes
```bash
pm2 logs webhook-deploy
pm2 restart webhook-deploy
```

---

## Commandes PM2 générales

```bash
# Voir tous les services
pm2 status

# Logs de tous les services
pm2 logs

# Redémarrer tous les services
pm2 restart all

# Sauvegarder la config PM2 (pour auto-start au reboot)
pm2 save

# Voir les ressources
pm2 monit
```

---

## Firewall (UFW)

Ports ouverts :
```bash
sudo ufw status
```

| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | HTTP (Frontend) |
| 443 | HTTPS |
| 3000 | Video Render |
| 9000 | Webhook |

### Ouvrir un nouveau port
```bash
sudo ufw allow PORT/tcp
```

---

## Espace disque

```bash
# Voir l'espace disque
df -h

# Voir la taille des dossiers
du -sh ~/purple/*

# Voir les fichiers temporaires
du -sh ~/purple/video-render-service/temp/*
du -sh ~/purple/transcription-service/temp/*
```

---

## Logs centralisés

```bash
# Tous les logs PM2
pm2 logs

# Logs spécifiques
pm2 logs video-render
pm2 logs transcription-service
pm2 logs webhook-deploy

# Logs avec timestamp
pm2 logs --timestamp
```

---

## Mise à jour du code

```bash
cd ~/purple
git pull

# Redémarrer les services si nécessaire
pm2 restart video-render
pm2 restart transcription-service
```

---

## Troubleshooting

### Service ne démarre pas
```bash
# Vérifier les erreurs
pm2 logs <service-name> --lines 50

# Vérifier le chemin
pm2 info <service-name>
```

### Port déjà utilisé
```bash
# Trouver quel process utilise le port
sudo lsof -i :PORT
sudo netstat -tulpn | grep PORT

# Tuer le process
kill -9 PID
```

### Mémoire insuffisante
```bash
# Voir la mémoire
free -h

# Voir les process gourmands
htop
```

### Espace disque plein
```bash
# Nettoyage manuel des vidéos
node ~/purple/video-render-service/cleanup.js

# Nettoyage des logs PM2
pm2 flush
```
