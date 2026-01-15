# Déploiement Video Storage API sur VPS

## Étapes de déploiement

### 1. Se connecter au VPS

```bash
ssh ubuntu@51.91.158.233
```

### 2. Récupérer le code

```bash
cd /home/ubuntu
git clone https://github.com/goonidz/purple.git VideoFlow
# Ou si déjà cloné:
cd /home/ubuntu/VideoFlow
git pull origin main
```

### 3. Installer les dépendances

```bash
cd /home/ubuntu/VideoFlow/video-storage-api
npm install
```

### 4. Créer le fichier .env

```bash
nano .env
```

Contenu :
```env
VIDEO_STORAGE_PORT=3001
VIDEOS_DIR=/var/www/rendered-videos
PUBLIC_URL_BASE=http://51.91.158.233/rendered-videos
VIDEO_UPLOAD_TOKEN=<générer-avec-openssl-rand-hex-32>
```

Générer un token sécurisé :
```bash
openssl rand -hex 32
```

**IMPORTANT** : Copier ce token, il sera nécessaire pour RunPod !

### 5. Créer le dossier de stockage

```bash
sudo mkdir -p /var/www/rendered-videos
sudo chown ubuntu:ubuntu /var/www/rendered-videos
sudo chmod 755 /var/www/rendered-videos
```

### 6. Configurer nginx

```bash
sudo nano /etc/nginx/sites-available/default
```

Ajouter dans le bloc `server` :

```nginx
# Serve rendered videos (static files)
location /rendered-videos/ {
    alias /var/www/rendered-videos/;
    
    # Enable CORS
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods 'GET, OPTIONS';
    
    # Cache videos for 1 year
    expires 1y;
    add_header Cache-Control "public, immutable";
    
    # Auto-generate index for directory listing (optional)
    autoindex on;
}

# Proxy API endpoint for video uploads
location /api/upload-video {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    
    # CRITICAL: Allow large file uploads (500 MB)
    client_max_body_size 500M;
    
    # Increase timeouts for large uploads
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
}

# Also handle DELETE endpoint
location /api/delete-video {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    
    client_max_body_size 1M;
}
```

Tester et recharger nginx :
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 7. Démarrer le service avec PM2

```bash
cd /home/ubuntu/VideoFlow/video-storage-api
pm2 start server.js --name video-storage-api
pm2 save
```

### 8. Vérifier que ça fonctionne

```bash
# Test local
curl http://localhost:3001/health

# Test via nginx
curl http://51.91.158.233/api/upload-video
# Devrait retourner 401 Unauthorized (normal, pas de token)
```

---

## Configuration RunPod

### Dans le Pod Template RunPod :

Aller dans **Environment Variables** et ajouter :

```
VPS_UPLOAD_URL=http://51.91.158.233/api/upload-video
VPS_UPLOAD_TOKEN=<le-token-généré-étape-4>
```

**Note** : Le token doit être EXACTEMENT le même que dans le fichier `.env` du VPS.

---

## Vérification

### 1. Tester le health check

```bash
curl http://51.91.158.233/health
```

Devrait retourner :
```json
{
  "status": "ok",
  "videosDir": "/var/www/rendered-videos",
  "freeSpaceGB": "xxx.xx",
  "publicUrlBase": "http://51.91.158.233/rendered-videos"
}
```

### 2. Tester l'upload (avec un fichier test)

```bash
# Créer un fichier vidéo test
ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=25 -f lavfi -i sine=frequency=1000:duration=1 test.mp4

# Upload avec curl
curl -X POST http://51.91.158.233/api/upload-video \
  -H "Authorization: Bearer <votre-token>" \
  -F "video=@test.mp4"
```

Devrait retourner :
```json
{
  "success": true,
  "url": "http://51.91.158.233/rendered-videos/1234567890-abcdef.mp4",
  "filename": "1234567890-abcdef.mp4",
  "size": 12345,
  "sizeMB": 0.01
}
```

### 3. Vérifier que le fichier est accessible

Ouvrir l'URL retournée dans un navigateur. La vidéo devrait se lire.

---

## Maintenance

### Voir les logs

```bash
pm2 logs video-storage-api
```

### Redémarrer le service

```bash
pm2 restart video-storage-api
```

### Vérifier l'espace disque

```bash
df -h /var/www/rendered-videos
```

### Nettoyer les vieilles vidéos (manuel)

```bash
# Supprimer les vidéos de plus de 7 jours
find /var/www/rendered-videos -name "*.mp4" -mtime +7 -delete
```

### Configuration d'un cron pour cleanup automatique (optionnel)

```bash
crontab -e
```

Ajouter :
```cron
# Nettoyer les vidéos de plus de 30 jours tous les jours à 3h
0 3 * * * find /var/www/rendered-videos -name "*.mp4" -mtime +30 -delete
```

---

## Troubleshooting

### Erreur "413 Request Entity Too Large"

→ Augmenter `client_max_body_size` dans nginx (voir étape 6)

### Erreur "504 Gateway Timeout"

→ Augmenter les timeouts nginx :
```nginx
proxy_read_timeout 600s;
proxy_connect_timeout 600s;
proxy_send_timeout 600s;
```

### Erreur "ENOSPC: no space left on device"

→ Nettoyer l'espace disque :
```bash
df -h
du -sh /var/www/rendered-videos
# Supprimer les vieilles vidéos si nécessaire
```

### Le service ne démarre pas

→ Vérifier les logs PM2 :
```bash
pm2 logs video-storage-api --lines 100
```

→ Vérifier que le port 3001 n'est pas déjà utilisé :
```bash
sudo lsof -i :3001
```
