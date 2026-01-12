# Migration VPS - Reset et Redéploiement

**Date** : 2026-01-11  
**Raison** : Malware cryptominer persistant avec mécanisme de relance non identifié  
**Downtime** : ~30 minutes  
**Statut** : ✅ MIGRATION RÉUSSIE (11 jan 2026, 22:23 UTC)

---

## 📋 Ce qui s'est réellement passé

1. **Nettoyage manuel** : Échec (malware relancé sous nouveaux noms)
2. **Première réinstallation** : Échec (problème KVM QWERTY + UFW blocage SSH)
3. **Deuxième réinstallation** : ✅ Succès (SSH key only, pas de UFW)

**Durée totale** : 3 heures (dont 2h30 troubleshooting)  
**Résultat** : VPS propre, sécurisé, tous services opérationnels

---

## ⚠️ LEÇONS IMPORTANTES

### ❌ Ce qui a posé problème
1. **Console KVM** : Clavier QWERTY/AZERTY incompatible avec caractères spéciaux
2. **UFW** : A bloqué SSH 2 fois → VPS inaccessible
3. **Mot de passe au boot** : Nécessite console KVM (voir point 1)

### ✅ Solution qui a fonctionné
1. **SSH key only** : Pas de mot de passe du tout
2. **Pas de UFW** : fail2ban + SSH keys suffisent
3. **Script automatique** : Installation en une seule commande

---

---

## 🚀 TL;DR - Version Rapide

```bash
# 1. Reset VPS sur OVH Manager (Ubuntu 22.04/24.04)
# 2. Une fois reset, connecte-toi et lance :

ssh ubuntu@51.91.158.233  # (ou root@ si Ubuntu n'existe pas)

# Installation complète en une seule fois
curl -fsSL https://get.docker.com | sh && \
sudo usermod -aG docker ubuntu && \
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && \
sudo apt-get install -y nodejs nginx git && \
sudo npm install -g pm2 && \
git clone https://github.com/TON_USERNAME/TON_REPO.git ~/purple && \
cd ~/purple && \
echo "DUCKDNS_DOMAIN=purpleai
DUCKDNS_TOKEN=TON_TOKEN_ICI" > ~/.duckdns && \
~/purple/update-duckdns.sh && \
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/purple/update-duckdns.sh >> ~/duckdns.log 2>&1") | crontab - && \
cd ~/purple/video-render-service && npm install && pm2 start server.js --name video-render-service && \
cd ~/purple && ./webhook-setup.sh && pm2 start webhook-server.js --name webhook-deploy && \
pm2 save && sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu && \
echo "VITE_SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TA_CLE_PUBLIQUE" > .env.production && \
./deploy.sh && \
echo "tmpfs /tmp tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab && \
echo "none /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab && \
sudo mount -o remount,noexec /tmp && \
sudo mount -o remount,noexec /dev/shm && \
sudo apt-get install -y fail2ban && \
sudo sed -i 's/^#*PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
sudo systemctl restart sshd && \
echo "✅ Migration terminée !"

# 3. Teste : http://purpleai.duckdns.org
```

**Note** : Remplace `TON_USERNAME/TON_REPO`, `TON_TOKEN_ICI`, et `TA_CLE_PUBLIQUE` par tes vraies valeurs !

---

## ⚠️ PHASE 1 : CE QU'IL FAUT SAVOIR

### ✅ Rien à sauvegarder ! Tout est sur GitHub + Supabase

**Pourquoi ?**
- ✅ **Code source** → Sur GitHub
- ✅ **Données utilisateur** → Dans Supabase (cloud)
- ✅ **Edge Functions** → Déployées sur Supabase
- ✅ **Vidéos rendues** → Temporaires, seront recréées
- ✅ **Configuration** → Dans le repo (`scripts/`, `docs/`)

### 📝 Juste besoin de ces infos (tu les as déjà)

- **Token DuckDNS** : Va sur https://www.duckdns.org (connecté) pour le retrouver
- **IP VPS** : `51.91.158.233`
- **Domaine** : `purpleai.duckdns.org`
- **Supabase Project** : `laqgmqyjstisipsbljha`
- **GitHub repo** : Ton repo actuel

### 💡 Le principe

```
Reset VPS → Installer prérequis → git clone → ./deploy.sh → ✅ Terminé !
```

---

## 🔄 PHASE 2 : RESET DU VPS SUR OVH

### 2.1 Se connecter à l'espace client OVH

1. Va sur : https://www.ovh.com/manager/
2. Connecte-toi avec tes identifiants OVH
3. Va dans **Bare Metal Cloud** → **Serveurs dédiés** (ou **VPS** selon ton offre)
4. Sélectionne ton serveur `51.91.158.233`

### 2.2 Lancer la réinstallation

1. Dans le menu de gauche, clique sur **Réinstaller**
2. Choisis **Ubuntu 22.04 LTS** ou **Ubuntu 24.04 LTS** (recommandé)
3. ⚠️ **IMPORTANT** : Configure une **clé SSH** pour éviter les mots de passe
   - Si tu as déjà une clé : Sélectionne-la
   - Sinon : Upload ta clé publique (`~/.ssh/id_ed25519.pub`)
4. Clique sur **Confirmer**
5. ⏱️ **Attends 5-10 minutes** (OVH va réinstaller)

### 2.3 Vérifier l'accès SSH

```bash
# Depuis ton Mac, teste la connexion
ssh ubuntu@51.91.158.233

# Si ça ne marche pas avec 'ubuntu', essaye 'root'
ssh root@51.91.158.233
```

**Si demande de mot de passe** : Vérifie tes emails OVH pour les credentials temporaires.

---

## 🚀 PHASE 3 : REDÉPLOIEMENT (VPS PROPRE)

### 3.1 Installation des prérequis (une seule fois)

```bash
# Se connecter au VPS
ssh ubuntu@51.91.158.233

# Mettre à jour le système
sudo apt-get update && sudo apt-get upgrade -y

# Installer Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Installer Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Installer PM2
sudo npm install -g pm2

# Installer Git
sudo apt-get install -y git

# Installer nginx
sudo apt-get install -y nginx

# Configurer le firewall
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw allow 3000/tcp # Video Render Service
sudo ufw allow 9000/tcp # Webhook
sudo ufw --force enable

# SÉCURITÉ : Bloquer /tmp et /dev/shm
echo "tmpfs /tmp tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab
echo "none /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab
sudo mount -o remount,noexec /tmp
sudo mount -o remount,noexec /dev/shm

# SÉCURITÉ : Installer fail2ban
sudo apt-get install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# SÉCURITÉ : Désactiver SSH par mot de passe
sudo sed -i 's/^#*PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#*ChallengeResponseAuthentication yes/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Déconnecte-toi et reconnecte-toi pour appliquer le groupe Docker
exit
```

### 3.2 Cloner le repository

```bash
# Reconnecte-toi
ssh ubuntu@51.91.158.233

# Cloner le repo (remplace par ton repo si différent)
cd ~
git clone https://github.com/goonidz/purple.git
cd purple
```

### 3.3 Configurer DuckDNS

```bash
# Créer le fichier de config DuckDNS
cat > ~/.duckdns << 'EOF'
DUCKDNS_DOMAIN=purpleai
DUCKDNS_TOKEN=TON_TOKEN_DUCKDNS_ICI
EOF

# Tester la mise à jour DuckDNS
~/purple/update-duckdns.sh

# Ajouter au cron (toutes les 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/purple/update-duckdns.sh >> ~/duckdns.log 2>&1") | crontab -
```

### 3.4 Configurer et démarrer le Video Render Service

```bash
cd ~/purple/video-render-service

# Installer les dépendances
npm install

# Démarrer avec PM2
pm2 start server.js --name video-render-service
pm2 save
pm2 startup  # Copie-colle la commande affichée pour l'auto-start au boot
```

### 3.5 Configurer le Webhook GitHub

```bash
cd ~/purple

# Configurer le webhook
./webhook-setup.sh

# Démarrer le webhook avec PM2
pm2 start webhook-server.js --name webhook-deploy
pm2 save
```

### 3.6 Déployer le Frontend

```bash
cd ~/purple

# Créer le fichier .env.production avec tes credentials Supabase
cat > .env.production << 'EOF'
VITE_SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TA_CLE_PUBLIQUE_ICI
EOF

# Lancer le déploiement
./deploy.sh
```

### 3.7 Configurer nginx + DuckDNS

```bash
# Le script fix-nginx-docker.sh s'occupe de tout
cd ~/purple
./fix-nginx-docker.sh
```

### 3.8 (Optionnel) Configurer SSL avec Let's Encrypt

```bash
cd ~/purple
./setup-ssl-auto.sh
```

---

## ✅ PHASE 4 : VÉRIFICATION

### 4.1 Vérifier les services

```bash
# PM2
pm2 status

# Docker
docker ps

# Nginx
sudo systemctl status nginx

# Health checks
curl http://localhost:3000/health
curl http://purpleai.duckdns.org
```

### 4.2 Tester l'application

1. Ouvre `http://purpleai.duckdns.org` (ou `https://` si SSL configuré)
2. Teste la génération de script
3. Teste la génération d'images
4. Teste le rendu vidéo

### 4.3 Vérifier la sécurité

```bash
# Vérifier /tmp et /dev/shm
mount | grep -E "/tmp|/dev/shm"
# Doit afficher "noexec"

# Vérifier fail2ban
sudo systemctl status fail2ban

# Vérifier SSH (ne doit plus accepter les mots de passe)
sudo grep -E "PasswordAuthentication|ChallengeResponseAuthentication" /etc/ssh/sshd_config
```

---

## 📊 CHECKLIST FINALE

- [ ] VPS réinstallé avec Ubuntu propre
- [ ] Clé SSH configurée (pas de mot de passe)
- [ ] Docker installé
- [ ] Node.js + PM2 installés
- [ ] Repository cloné
- [ ] DuckDNS configuré et fonctionnel
- [ ] Video Render Service démarré (PM2)
- [ ] Webhook déployé (PM2)
- [ ] Frontend déployé (Docker)
- [ ] Nginx configuré
- [ ] SSL configuré (optionnel)
- [ ] Firewall configuré (UFW)
- [ ] /tmp et /dev/shm en noexec
- [ ] fail2ban installé
- [ ] SSH par mot de passe désactivé
- [ ] Application accessible en ligne
- [ ] Tests fonctionnels OK

---

## 🆘 TROUBLESHOOTING

### Si le webhook ne fonctionne pas

```bash
pm2 logs webhook-deploy
# Vérifier le secret dans .env.webhook correspond à GitHub
```

### Si le video render service ne démarre pas

```bash
cd ~/purple/video-render-service
npm install
pm2 restart video-render-service
pm2 logs video-render-service
```

### Si Docker ne fonctionne pas

```bash
sudo systemctl status docker
sudo systemctl restart docker
./deploy.sh
```

### Si DuckDNS ne se met pas à jour

```bash
# Vérifier le token
cat ~/.duckdns
# Tester manuellement
~/purple/update-duckdns.sh
# Vérifier la résolution DNS
nslookup purpleai.duckdns.org
```

---

## 📞 CONTACTS D'URGENCE

- **Documentation complète** : `docs/HOW_TO_DEPLOY.md`
- **Architecture** : `DEPLOYMENT.md`
- **Sécurité VPS** : `docs/VPS_SECURITY.md`
- **Support OVH** : https://www.ovh.com/manager/

---

## ⏱️ TIMELINE ESTIMÉE

- **Reset VPS (OVH)** : 5-10 min (automatique)
- **Installation + Déploiement** : 5-10 min (script automatique)
- **Tests & vérifications** : 5 min
- **TOTAL** : ~20-25 minutes

**Avec SSL** : Ajoute 5 minutes pour `./setup-ssl-auto.sh`

---

**✅ Après migration, ton VPS sera propre, sécurisé et le malware sera DÉFINITIVEMENT éliminé !**
