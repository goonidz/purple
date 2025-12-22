# Video Render Service

Service Node.js pour le rendu vidéo avec FFmpeg.

## Installation

```bash
npm install
```

## Configuration

Copiez `.env.example` vers `.env` et configurez :

```bash
cp .env.example .env
nano .env
```

## Démarrage

### Mode développement
```bash
npm start
```

### Mode production avec PM2
```bash
npm run pm2:start
```

### Voir les logs
```bash
npm run pm2:logs
```

### Redémarrer
```bash
npm run pm2:restart
```

### Arrêter
```bash
npm run pm2:stop
```

## Configuration du firewall

```bash
sudo ufw allow 3000/tcp
```

## Configuration de l'URL publique

Ajoutez dans `.env` :
```
VPS_PUBLIC_URL=http://51.91.158.233:3000
```

## Nettoyage automatique

Les fichiers vidéo sont automatiquement supprimés après 3 jours.

### Configuration du cron job pour le nettoyage automatique

```bash
# Éditer le crontab
crontab -e

# Ajouter cette ligne pour nettoyer tous les jours à 2h du matin
0 2 * * * cd /home/ubuntu/video-render-service && node cleanup.js >> /home/ubuntu/video-render-service/cleanup.log 2>&1
```

### Nettoyage manuel

```bash
node cleanup.js
```

## API

### POST /render

Rend une vidéo à partir de scènes, audio et sous-titres.

**Body:**
```json
{
  "scenes": [
    {
      "startTime": 0,
      "endTime": 5,
      "imageUrl": "https://...",
      "text": "Texte de la scène"
    }
  ],
  "audioUrl": "https://...",
  "subtitleSettings": {
    "enabled": true,
    "fontSize": 18,
    "color": "#ffffff",
    "backgroundColor": "#000000",
    "opacity": 0.8,
    "x": 50,
    "y": 85
  },
  "videoSettings": {
    "width": 1920,
    "height": 1080,
    "framerate": 25,
    "format": "mp4"
  },
  "projectId": "uuid",
  "userId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "videoUrl": "https://...",
  "jobId": "render_...",
  "duration": 123.45
}
```



