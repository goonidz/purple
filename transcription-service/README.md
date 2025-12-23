# Transcription Service

Service Node.js pour la transcription audio/vidéo avec Whisper (OpenAI).

## Prérequis

- Node.js >= 20
- Python 3.8+
- FFmpeg
- GPU CUDA (optionnel, mais recommandé pour les performances)

## Installation

```bash
# Rendre le script exécutable
chmod +x install.sh

# Lancer l'installation
./install.sh
```

### Installation manuelle

```bash
# Python et Whisper
python3 -m venv venv
source venv/bin/activate
pip install openai-whisper faster-whisper

# Node.js
npm install
```

## Configuration

Créez un fichier `.env` :

```bash
PORT=3001
WHISPER_MODEL=medium
```

### Modèles disponibles

| Modèle | Taille | RAM GPU | Vitesse | Qualité |
|--------|--------|---------|---------|---------|
| tiny | 39M | ~1GB | Très rapide | Basse |
| base | 74M | ~1GB | Rapide | Moyenne |
| small | 244M | ~2GB | Moyen | Bonne |
| **medium** | 769M | ~5GB | Lent | **Très bonne** |
| large | 1550M | ~10GB | Très lent | Excellente |
| large-v2 | 1550M | ~10GB | Très lent | Excellente |
| large-v3 | 1550M | ~10GB | Très lent | Meilleure |

**Recommandation** : `medium` pour un bon équilibre qualité/vitesse.

## Démarrage

### Mode développement
```bash
source venv/bin/activate  # Activer Python venv
npm start
```

### Mode production avec PM2
```bash
source venv/bin/activate
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

## API

### GET /health

Vérification de l'état du service.

```bash
curl http://localhost:3001/health
```

**Response:**
```json
{
  "status": "ok",
  "version": "v1.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "engines": ["whisper", "faster-whisper"],
  "models": ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"]
}
```

### POST /transcribe

Lance une transcription asynchrone.

```bash
curl -X POST http://localhost:3001/transcribe \
  -H "Content-Type: application/json" \
  -d '{
    "audioUrl": "https://example.com/audio.mp3",
    "language": "fr",
    "model": "medium",
    "engine": "faster-whisper"
  }'
```

**Parameters:**
- `audioUrl` (required): URL du fichier audio/vidéo
- `language` (optional): Code langue (fr, en, etc.) ou "auto" pour détection automatique
- `model` (optional): Modèle Whisper (default: medium)
- `engine` (optional): "whisper" ou "faster-whisper" (default: whisper)

**Response:**
```json
{
  "success": true,
  "jobId": "transcribe_1234567890_abc123",
  "status": "pending",
  "message": "Transcription job started"
}
```

### POST /transcribe/upload

Upload un fichier et lance la transcription.

```bash
curl -X POST http://localhost:3001/transcribe/upload \
  -F "audio=@/path/to/audio.mp3" \
  -F "language=fr" \
  -F "model=medium"
```

### POST /transcribe/sync

Transcription synchrone (attend le résultat).

```bash
curl -X POST http://localhost:3001/transcribe/sync \
  -H "Content-Type: application/json" \
  -d '{
    "audioUrl": "https://example.com/audio.mp3",
    "language": "fr"
  }'
```

**Response:**
```json
{
  "success": true,
  "jobId": "transcribe_xxx",
  "text": "Bonjour, ceci est la transcription...",
  "language": "fr",
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 2.5,
      "text": "Bonjour,",
      "words": [...]
    }
  ],
  "full_text": "...",
  "language_code": "fr"
}
```

### GET /status/:jobId

Vérifie le statut d'un job.

```bash
curl http://localhost:3001/status/transcribe_1234567890_abc123
```

**Response (en cours):**
```json
{
  "success": true,
  "jobId": "transcribe_xxx",
  "status": "processing",
  "progress": 50,
  "message": "Transcribing with Whisper..."
}
```

**Response (terminé):**
```json
{
  "success": true,
  "jobId": "transcribe_xxx",
  "status": "completed",
  "progress": 100,
  "result": {
    "text": "...",
    "segments": [...],
    "language": "fr"
  }
}
```

### DELETE /cancel/:jobId

Annule un job en cours.

```bash
curl -X DELETE http://localhost:3001/cancel/transcribe_xxx
```

## Intégration VideoFlow

### Edge Function pour appeler le service

```typescript
// Dans supabase/functions/transcribe-audio/index.ts
const VPS_TRANSCRIPTION_URL = 'http://51.91.158.233:3001';

// Lancer la transcription
const response = await fetch(`${VPS_TRANSCRIPTION_URL}/transcribe/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    audioUrl: audioFileUrl,
    language: 'auto',
    model: 'medium',
    engine: 'faster-whisper'
  })
});

const result = await response.json();
```

## Performance

### Temps de transcription estimés (GPU NVIDIA)

| Durée audio | tiny | base | small | medium | large |
|-------------|------|------|-------|--------|-------|
| 1 min | 5s | 8s | 15s | 30s | 60s |
| 5 min | 20s | 35s | 60s | 2min | 4min |
| 10 min | 40s | 70s | 2min | 4min | 8min |
| 30 min | 2min | 3.5min | 6min | 12min | 24min |

**Note**: `faster-whisper` est généralement 2-4x plus rapide que `whisper` standard.

### Sans GPU (CPU only)

Les temps sont environ 10x plus longs. Recommandation: utiliser `tiny` ou `base` sans GPU.

## Troubleshooting

### Whisper not found
```bash
source venv/bin/activate
pip install openai-whisper
```

### CUDA out of memory
Utilisez un modèle plus petit ou passez en CPU:
```bash
# Force CPU
export CUDA_VISIBLE_DEVICES=""
```

### FFmpeg errors
```bash
sudo apt install ffmpeg
```

## Nettoyage automatique

Les fichiers temporaires sont automatiquement nettoyés après chaque job.
Les jobs sont supprimés de la mémoire après 24h.
