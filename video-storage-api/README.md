# Video Storage API

API endpoint pour recevoir les uploads de vidéos depuis les workers RunPod GPU.

## Installation sur VPS

### 1. Installer les dépendances

```bash
cd /home/ubuntu/VideoFlow/video-storage-api
npm install
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
nano .env
```

Générer un token sécurisé :
```bash
openssl rand -hex 32
```

### 3. Créer le dossier de stockage

```bash
sudo mkdir -p /var/www/rendered-videos
sudo chown ubuntu:ubuntu /var/www/rendered-videos
sudo chmod 755 /var/www/rendered-videos
```

### 4. Configurer nginx

Ajouter dans `/etc/nginx/sites-available/default` :

```nginx
# Serve rendered videos
location /rendered-videos/ {
    alias /var/www/rendered-videos/;
    
    # Enable CORS
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods 'GET, OPTIONS';
    
    # Cache videos for 1 year
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# Proxy to video storage API
location /api/upload-video {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    
    # Important: allow large file uploads
    client_max_body_size 500M;
}
```

Recharger nginx :
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Démarrer le service avec PM2

```bash
pm2 start server.js --name video-storage-api
pm2 save
```

### 6. Vérifier que ça fonctionne

```bash
curl http://localhost:3001/health
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

## Configuration RunPod

Dans les variables d'environnement du Pod RunPod, ajouter :

```bash
VPS_UPLOAD_URL=http://51.91.158.233/api/upload-video
VPS_UPLOAD_TOKEN=your-secure-token-from-env-file
```

## API Endpoints

### POST /api/upload-video

Upload une vidéo.

**Headers:**
- `Authorization: Bearer <token>`
- `Content-Type: multipart/form-data`

**Body:**
- `video`: Fichier vidéo (max 500 MB)

**Response:**
```json
{
  "success": true,
  "url": "http://51.91.158.233/rendered-videos/1234567890-abcdef.mp4",
  "filename": "1234567890-abcdef.mp4",
  "size": 12345678,
  "sizeMB": 11.77
}
```

### DELETE /api/delete-video/:filename

Supprimer une vidéo (optionnel, pour cleanup).

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true
}
```

### GET /health

Vérifier l'état du service.

**Response:**
```json
{
  "status": "ok",
  "videosDir": "/var/www/rendered-videos",
  "freeSpaceGB": "123.45",
  "publicUrlBase": "http://51.91.158.233/rendered-videos"
}
```
