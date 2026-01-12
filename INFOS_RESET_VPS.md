# 📋 Informations pour Reset VPS

**Date sauvegarde** : 2026-01-11 22:50

---

## 🔑 Informations critiques

### DuckDNS
- **Domaine** : `purpleai.duckdns.org`
- **Token** : `b7971357-d439-478b-83af-7ec43496c03e`

### VPS
- **IP** : `51.91.158.233`
- **OS à installer** : Ubuntu 22.04 LTS ou 24.04 LTS
- **Clé SSH** : `~/.ssh/id_ed25519.pub`

### GitHub
- **Repository** : `git@github.com:goonidz/purple.git`
- **Clone command** : `git clone git@github.com:goonidz/purple.git ~/purple`

### Supabase
- **Project Ref** : `laqgmqyjstisipsbljha`
- **URL** : `https://laqgmqyjstisipsbljha.supabase.co`

---

## 🚀 Commandes rapides après reset

### 1. Installation complète (une seule commande)

```bash
ssh ubuntu@51.91.158.233

# Copie-colle TOUT d'un coup (modifie TA_CLE_PUBLIQUE_SUPABASE)
curl -fsSL https://get.docker.com | sh && \
sudo usermod -aG docker ubuntu && \
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && \
sudo apt-get install -y nodejs nginx git && \
sudo npm install -g pm2 && \
git clone git@github.com:goonidz/purple.git ~/purple && \
cd ~/purple && \
echo "DUCKDNS_DOMAIN=purpleai
DUCKDNS_TOKEN=b7971357-d439-478b-83af-7ec43496c03e" > ~/.duckdns && \
~/purple/update-duckdns.sh && \
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/purple/update-duckdns.sh >> ~/duckdns.log 2>&1") | crontab - && \
cd ~/purple/video-render-service && npm install && pm2 start server.js --name video-render-service && \
cd ~/purple && ./webhook-setup.sh && pm2 start webhook-server.js --name webhook-deploy && \
pm2 save && sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu && \
echo "VITE_SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TA_CLE_PUBLIQUE_SUPABASE" > .env.production && \
./deploy.sh && \
echo "tmpfs /tmp tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab && \
echo "none /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab && \
sudo mount -o remount,noexec /tmp && \
sudo mount -o remount,noexec /dev/shm && \
sudo apt-get install -y fail2ban && \
sudo sed -i 's/^#*PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
sudo systemctl restart sshd && \
echo "✅ Migration terminée !"
```

**⚠️ ATTENTION** : Remplace `TA_CLE_PUBLIQUE_SUPABASE` par ta vraie clé !

### 2. Où trouver la clé publique Supabase ?

1. Va sur https://app.supabase.com
2. Sélectionne ton projet `laqgmqyjstisipsbljha`
3. Va dans **Settings** → **API**
4. Copie la clé **`anon` / `public`**

---

## ✅ Vérification après déploiement

```bash
# Vérifier les services
pm2 status
docker ps
curl http://localhost:3000/health
curl http://purpleai.duckdns.org

# Vérifier la sécurité
mount | grep -E "/tmp|/dev/shm"  # Doit afficher "noexec"
sudo systemctl status fail2ban   # Doit être "active (running)"
```

---

## 📞 Liens utiles

- **OVH Manager** : https://www.ovh.com/manager/
- **DuckDNS** : https://www.duckdns.org
- **Supabase Dashboard** : https://app.supabase.com
- **GitHub Repo** : https://github.com/goonidz/purple

---

## 📖 Documentation complète

- `docs/VPS_RESET_MIGRATION.md` - Guide détaillé de migration
- `docs/HOW_TO_DEPLOY.md` - Guide de déploiement
- `docs/VPS_SECURITY.md` - Sécurité et incident malware

---

**Sauvegarde complète dans** : `~/vps-backup-20260111-225021/`
