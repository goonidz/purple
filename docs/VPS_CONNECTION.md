# 🔌 Guide de connexion au VPS

> ⚠️ **Note de sécurité** : Suite à un incident de sécurité en janvier 2026 (cryptominer), le VPS est maintenant sécurisé avec fail2ban et authentification SSH par clé uniquement. Voir [VPS_SECURITY.md](./VPS_SECURITY.md) pour plus de détails.

## 📋 Informations du VPS

- **IP Publique** : `51.91.158.233`
- **Domaine** : `purpleai.duckdns.org`
- **Utilisateur** : `ubuntu`
- **Port SSH** : `22` (par défaut)
- **Authentification** : **Clé SSH uniquement** (mot de passe désactivé)

---

## 🔑 Connexion SSH

### Connexion principale

```bash
ssh ubuntu@51.91.158.233
```

Ou avec le domaine :

```bash
ssh ubuntu@purpleai.duckdns.org
```

### Si tu utilises une clé SSH spécifique

```bash
ssh -i ~/.ssh/votre_cle ubuntu@51.91.158.233
```

### Connexion avec mode verbose (pour débugger)

```bash
ssh -v ubuntu@51.91.158.233
```

---

## 📦 Services déployés sur le VPS

Le VPS héberge plusieurs services gérés par **PM2** :

| ID | Service | Port | Description |
|----|---------|------|-------------|
| 11 | `video-render-service` | 3000 | Service de rendu vidéo (FFmpeg) |
| 10 | `engui-studio` | - | Studio Engui |
| 5 | `transcription-service` | - | Service de transcription |
| 3 | `webhook-deploy` | - | Webhooks de déploiement |

---

## 🛠️ Commandes PM2 essentielles

### Voir tous les services

```bash
pm2 list
```

### Voir les logs d'un service

```bash
# Logs en temps réel (Ctrl+C pour quitter)
pm2 logs video-render-service

# Dernières 100 lignes
pm2 logs video-render-service --lines 100

# Seulement les erreurs
pm2 logs video-render-service --err --lines 50
```

### Redémarrer un service

```bash
pm2 restart video-render-service
```

### Arrêter un service

```bash
pm2 stop video-render-service
```

### Voir les détails d'un service

```bash
pm2 show video-render-service
```

### Sauvegarder la configuration PM2

```bash
pm2 save
```

---

## 🔍 Diagnostic des problèmes courants

### Problème : Port 3000 déjà utilisé

```bash
# Voir quel processus utilise le port 3000
sudo lsof -i :3000

# Tuer le processus qui bloque (remplace <PID> par le numéro affiché)
sudo kill -9 <PID>

# Ou en une commande
sudo kill -9 $(sudo lsof -t -i:3000)

# Redémarrer le service
pm2 restart video-render-service
```

### Problème : Service en erreur (status: errored)

```bash
# Voir les logs d'erreur
pm2 logs video-render-service --err --lines 100

# Supprimer et relancer le service
pm2 delete video-render-service
cd ~/video-render-service
pm2 start server.js --name video-render-service
pm2 save
```

### Problème : Erreur 429 (Too Many Requests)

```bash
# Chercher l'erreur 429 dans les logs
pm2 logs video-render-service --lines 500 | grep -A 10 "429"

# Ou dans les fichiers de logs
cat ~/.pm2/logs/video-render-service-error.log | grep -A 20 "429"
cat ~/.pm2/logs/video-render-service-out.log | grep -A 20 "429"
```

### Problème : Service ne démarre pas

```bash
# Vérifier les dépendances
cd ~/video-render-service
npm install

# Tester le service manuellement (sans PM2)
node server.js

# Si ça fonctionne, relancer avec PM2
pm2 start server.js --name video-render-service
pm2 save
```

---

## 📂 Chemins importants

| Élément | Chemin |
|---------|--------|
| Service de rendu | `~/video-render-service/` |
| Logs PM2 (output) | `~/.pm2/logs/video-render-service-out.log` |
| Logs PM2 (erreur) | `~/.pm2/logs/video-render-service-error.log` |
| File d'attente | `~/video-render-service/render-queue.json` |
| Vidéos rendues | `~/video-render-service/videos/` |

---

## 🧹 Maintenance

### Nettoyer les vieux fichiers (vidéos > 3 jours)

```bash
cd ~/video-render-service
node cleanup.js
```

### Vérifier l'espace disque

```bash
df -h
```

### Vérifier la RAM disponible

```bash
free -h
```

### Vérifier la charge CPU

```bash
top
# ou
htop
```

---

## 🚀 Mettre à jour le service de rendu

### Depuis ton Mac (local)

```bash
# Aller dans le projet
cd "/Users/Tom/Documents/Cursor/VideoFlow 2"

# Copier le nouveau server.js sur le VPS
scp video-render-service/server.js ubuntu@51.91.158.233:~/video-render-service/server.js

# Se connecter au VPS
ssh ubuntu@51.91.158.233

# Sur le VPS, redémarrer le service
pm2 restart video-render-service
pm2 logs video-render-service --lines 20
```

---

## 🆘 En cas de problème bloquant

### Redémarrer complètement PM2

```bash
pm2 kill
cd ~/video-render-service
pm2 start server.js --name video-render-service
pm2 save
pm2 startup
```

### Vérifier les processus Node qui tournent

```bash
ps aux | grep node
```

### Redémarrer le VPS (en dernier recours)

```bash
sudo reboot
```

Puis reconnecte-toi après 1-2 minutes :

```bash
ssh ubuntu@51.91.158.233
pm2 list
```

---

## 📞 URLs et endpoints

| Service | URL |
|---------|-----|
| Health check | `http://51.91.158.233:3000/health` |
| API Render | `http://51.91.158.233:3000/render` |
| Queue status | `http://51.91.158.233:3000/queue/status` |
| Resource check | `http://51.91.158.233:3000/resources` |

---

## 💡 Astuces

- **Garde toujours `pm2 logs` ouvert** quand tu testes un rendu pour voir les erreurs en temps réel
- **Utilise `pm2 monit`** pour voir l'utilisation CPU/RAM en temps réel
- **Les logs PM2 sont limités en taille**, utilise `pm2 flush` pour les vider si besoin
- **Sauvegarde toujours avec `pm2 save`** après avoir modifié des services

---

## 🔐 Sécurité

- **Ne jamais exposer les clés API** dans les logs ou les commandes
- **Utiliser HTTPS** pour le domaine principal (déjà configuré via nginx)
- **Le service de rendu écoute sur 0.0.0.0:3000** (accessible depuis l'extérieur)
- **Limiter l'accès au port 3000** via firewall si nécessaire (actuellement ouvert)

---

## 📚 Liens utiles

- [Documentation PM2](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Documentation FFmpeg](https://ffmpeg.org/documentation.html)
- [Documentation Node.js](https://nodejs.org/en/docs/)
