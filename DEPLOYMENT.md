# Guide de déploiement VideoFlow sur VPS Linux

Ce guide explique comment déployer l'application VideoFlow sur un VPS Linux avec Docker, nginx, DuckDNS et déploiement automatique.

## Vue d'ensemble du déploiement

Le projet VideoFlow est déployé avec une architecture complète :

- **Frontend React** : Container Docker avec nginx, accessible via domaine DuckDNS
- **Service de rendu vidéo** : Node.js + FFmpeg sur le port 3000 (géré par PM2)
- **Webhook GitHub** : Déploiement automatique à chaque push (port 9000, géré par PM2)
- **Nom de domaine** : `purpleai.duckdns.org` (gratuit via DuckDNS)

Tous les services sont configurés automatiquement via les scripts de déploiement.

## Prérequis

### Sur le VPS

1. **Docker installé**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   sudo usermod -aG docker $USER
   ```

2. **Docker Compose** (optionnel, pour utiliser docker-compose.yml)
   ```bash
   sudo apt-get update
   sudo apt-get install docker-compose-plugin
   ```

3. **Git** (pour cloner le repository)
   ```bash
   sudo apt-get install git
   ```

4. **Port 80 disponible** (vérifier qu'aucun service n'utilise déjà le port 80)
   ```bash
   sudo netstat -tulpn | grep :80
   ```

## Configuration

### 1. Cloner le repository

```bash
git clone https://github.com/goonidz/VideoFlow.git
cd VideoFlow
```

### 2. Créer le fichier .env.production

Créez un fichier `.env.production` à la racine du projet avec vos variables d'environnement :

```bash
cat > .env.production << EOF
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=votre_cle_publique_supabase
EOF
```

**Important** : Remplacez les valeurs par vos vraies credentials Supabase.

### 3. Vérifier les credentials

Vous pouvez trouver vos credentials Supabase dans :
- Dashboard Supabase → Settings → API
- `VITE_SUPABASE_URL` : Project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` : `anon` public key

## Déploiement

### Option 1 : Utiliser le script de déploiement (recommandé)

```bash
./deploy.sh
```

Le script va automatiquement :
- Vérifier les variables d'environnement
- Builder l'image Docker
- Arrêter l'ancien container
- Démarrer le nouveau container
- Nettoyer les anciennes images

### Option 2 : Utiliser Docker Compose

```bash
# Charger les variables d'environnement
export $(cat .env.production | grep -v '^#' | xargs)

# Builder et démarrer
docker compose up -d --build
```

### Option 3 : Commandes Docker manuelles

```bash
# Charger les variables d'environnement
export $(cat .env.production | grep -v '^#' | xargs)

# Builder l'image
docker build \
    --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
    --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
    -t videoflow:latest .

# Arrêter l'ancien container (si existe)
docker stop videoflow 2>/dev/null || true
docker rm videoflow 2>/dev/null || true

# Démarrer le nouveau container
docker run -d \
    --name videoflow \
    -p 80:80 \
    --restart unless-stopped \
    videoflow:latest
```

## Vérification

### Vérifier que le container tourne

```bash
docker ps | grep videoflow
```

### Vérifier les logs

```bash
docker logs videoflow
# Ou en temps réel
docker logs -f videoflow
```

### Tester l'application

Ouvrez votre navigateur et allez sur :
```
http://VOTRE_IP_VPS
```

Ou si vous avez configuré un nom de domaine :
```
http://votre-domaine.com
```

### Health check

```bash
curl http://localhost/health
# Devrait retourner: healthy
```

## Déploiement automatique avec GitHub Webhook

Pour que votre site se mette à jour automatiquement à chaque push sur GitHub :

### Installation

1. **Installer Node.js** (si pas déjà installé) :
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Installer PM2** (gestionnaire de processus) :
   ```bash
   sudo npm install -g pm2
   ```

3. **Configurer le webhook** :
   ```bash
   cd ~/purple
   chmod +x webhook-setup.sh
   ./webhook-setup.sh
   ```

4. **Démarrer le serveur webhook** :
   ```bash
   pm2 start webhook-server.js --name webhook-deploy
   pm2 save
   pm2 startup  # Pour démarrer automatiquement au boot
   ```

5. **Configurer le firewall** :
   ```bash
   sudo ufw allow 9000/tcp
   ```

6. **Configurer le webhook GitHub** :
   - Allez sur : https://github.com/goonidz/purple/settings/hooks
   - Cliquez sur "Add webhook"
   - **Payload URL** : `http://51.91.158.233:9000/webhook`
   - **Content type** : `application/json`
   - **Secret** : Copiez le secret depuis `.env.webhook` (variable `WEBHOOK_SECRET`)
   - **Events** : Sélectionnez "Just the push event"
   - Cliquez sur "Add webhook"

### Vérification

Testez le webhook :
```bash
# Voir les logs du webhook
pm2 logs webhook-deploy

# Vérifier le statut
pm2 status
```

Maintenant, à chaque fois que vous faites un `git push` sur GitHub, le site se mettra à jour automatiquement !

## Mise à jour de l'application

### Méthode 1 : Déploiement automatique (recommandé)

Si vous avez configuré le webhook, il suffit de :
```bash
# Sur votre machine locale
git push origin main
# Le VPS se mettra à jour automatiquement !
```

### Méthode 2 : Script de déploiement manuel

```bash
# Pull les dernières modifications
git pull origin main

# Relancer le déploiement
./deploy.sh
```

### Méthode 2 : Docker Compose

```bash
git pull origin main
export $(cat .env.production | grep -v '^#' | xargs)
docker compose up -d --build
```

### Méthode 3 : Manuelle

```bash
git pull origin main
export $(cat .env.production | grep -v '^#' | xargs)
docker build --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" -t videoflow:latest .
docker stop videoflow
docker rm videoflow
docker run -d --name videoflow -p 80:80 --restart unless-stopped videoflow:latest
```

## Gestion du container

### Arrêter l'application

```bash
docker stop videoflow
```

### Démarrer l'application

```bash
docker start videoflow
```

### Redémarrer l'application

```bash
docker restart videoflow
```

### Supprimer le container

```bash
docker stop videoflow
docker rm videoflow
```

### Supprimer l'image

```bash
docker rmi videoflow:latest
```

## Configuration du firewall

Si vous utilisez UFW (Ubuntu Firewall), autorisez le port 80 :

```bash
sudo ufw allow 80/tcp
sudo ufw reload
```

## Configuration avec nom de domaine DuckDNS (gratuit)

DuckDNS offre des sous-domaines gratuits (ex: `videoflow.duckdns.org`). Voici comment le configurer :

### 1. Créer le compte DuckDNS

1. Allez sur https://www.duckdns.org
2. Connectez-vous avec GitHub ou Google
3. Créez un sous-domaine (ex: `videoflow`)
4. **Notez votre Token** affiché en haut de la page

Votre domaine sera : `videoflow.duckdns.org` (remplacez `videoflow` par votre choix)

### 2. Configurer le script de mise à jour automatique

Sur le VPS :

```bash
# Créer le fichier de configuration
cat > ~/.duckdns << EOF
DUCKDNS_DOMAIN=videoflow
DUCKDNS_TOKEN=votre-token-ici
EOF

# Copier le script de mise à jour
cp ~/purple/update-duckdns.sh ~/
chmod +x ~/update-duckdns.sh

# Tester le script
~/update-duckdns.sh
```

### 3. Configurer le cron job

Pour mettre à jour automatiquement l'IP toutes les 5 minutes :

```bash
# Éditer le crontab
crontab -e

# Ajouter cette ligne (remplacez /home/ubuntu par votre home directory)
*/5 * * * * /home/ubuntu/update-duckdns.sh >> /home/ubuntu/duckdns.log 2>&1
```

### 4. Installer nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 5. Configurer nginx

```bash
# Copier la configuration
sudo cp ~/purple/nginx-videoflow.conf /etc/nginx/sites-available/videoflow

# Modifier le nom de domaine dans le fichier si nécessaire
sudo nano /etc/nginx/sites-available/videoflow
# Remplacez "videoflow.duckdns.org" par votre domaine

# Activer le site
sudo ln -s /etc/nginx/sites-available/videoflow /etc/nginx/sites-enabled/

# Tester la configuration
sudo nginx -t

# Redémarrer nginx
sudo systemctl restart nginx
```

### 6. Configurer le firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp  # Pour SSL plus tard
sudo ufw reload
```

### 7. Tester l'accès

Ouvrez votre navigateur et allez sur :
```
http://videoflow.duckdns.org
```

### 8. Configuration SSL avec Let's Encrypt (optionnel mais recommandé)

```bash
# Installer Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Obtenir le certificat SSL
sudo certbot --nginx -d videoflow.duckdns.org

# Le certificat sera renouvelé automatiquement
```

Après SSL, votre site sera accessible en HTTPS : `https://videoflow.duckdns.org`

### Vérification

```bash
# Vérifier que DuckDNS pointe vers la bonne IP
nslookup videoflow.duckdns.org

# Vérifier les logs nginx
sudo tail -f /var/log/nginx/videoflow-access.log

# Vérifier les logs DuckDNS
tail -f ~/duckdns.log
```

## Configuration avec nom de domaine personnalisé (optionnel)

Si vous avez votre propre nom de domaine, vous pouvez :

1. **Configurer un reverse proxy avec nginx** (sur l'hôte, pas dans Docker)
2. **Utiliser Let's Encrypt pour SSL** avec Certbot

Exemple de configuration nginx sur l'hôte :

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Troubleshooting

### Le container ne démarre pas

```bash
# Vérifier les logs
docker logs videoflow

# Vérifier que le port 80 n'est pas déjà utilisé
sudo netstat -tulpn | grep :80
```

### L'application ne se charge pas

1. Vérifier que le container tourne : `docker ps`
2. Vérifier les logs : `docker logs videoflow`
3. Vérifier le firewall : `sudo ufw status`
4. Tester localement : `curl http://localhost/health`

### Erreurs de build

- Vérifier que toutes les variables d'environnement sont définies dans `.env.production`
- Vérifier les logs de build : `docker build --progress=plain -t videoflow:latest .`

### Problèmes de routing (404 sur les routes)

- Vérifier que `nginx.conf` est correctement configuré
- Vérifier que le fichier `index.html` est bien présent dans `/usr/share/nginx/html`

### Nettoyage

Pour nettoyer les images Docker inutilisées :

```bash
docker image prune -a
```

Pour tout nettoyer (attention, supprime tout) :

```bash
docker system prune -a
```

## Architecture complète

```
Internet
    ↓
purpleai.duckdns.org (DuckDNS gratuit)
    ↓
VPS Linux (51.91.158.233)
    ↓
┌─────────────────────────────────────┐
│  Nginx (port 80)                    │
│  - Proxy vers Docker (port 8080)    │
│  - Gère le domaine DuckDNS          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Docker Container (port 8080)       │
│  - Frontend React (VideoFlow)       │
│  - nginx interne pour servir les    │
│    fichiers statiques               │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Service Rendu Vidéo (port 3000)    │
│  - Node.js + FFmpeg                 │
│  - Accessible via IP:3000           │
│  - Géré par PM2                     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Webhook GitHub (port 9000)         │
│  - Déploiement automatique          │
│  - Géré par PM2                     │
└─────────────────────────────────────┘
```

### Services déployés

- **Frontend** : Docker container accessible via `http://purpleai.duckdns.org`
  - Nginx sur l'hôte fait le proxy vers Docker (port 8080 interne)
  - Configuration automatique via `fix-nginx-docker.sh`
  
- **Service de rendu vidéo** : Node.js + FFmpeg sur le port 3000
  - Accessible via `http://51.91.158.233:3000` ou `http://purpleai.duckdns.org:3000`
  - Géré par PM2, démarre automatiquement au boot
  - Les vidéos sont servies depuis le VPS (pas d'upload Supabase)

- **Webhook GitHub** : Service Node.js sur le port 9000
  - Écoute les événements push de GitHub
  - Déclenche automatiquement le déploiement
  - Géré par PM2

### Configuration automatique

Le script `fix-nginx-docker.sh` configure automatiquement :
- Arrêt de nginx et Docker
- Redémarrage de Docker sur le port 8080 (interne)
- Configuration nginx pour proxy vers Docker
- Mise à jour DuckDNS
- Tests de validation

Ce script s'exécute automatiquement à chaque déploiement via `deploy.sh`.

## Support

Pour toute question ou problème, consultez :
- Les logs Docker : `docker logs videoflow`
- La documentation Supabase : https://supabase.com/docs
- La documentation Docker : https://docs.docker.com
