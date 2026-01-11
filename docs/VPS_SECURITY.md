# 🛡️ Sécurité VPS - Guide complet

## 📋 Table des matières
- [Incident de sécurité (Janvier 2026)](#incident-de-sécurité-janvier-2026)
- [Comment se connecter au VPS](#comment-se-connecter-au-vps)
- [Mesures de sécurité en place](#mesures-de-sécurité-en-place)
- [Surveillance et maintenance](#surveillance-et-maintenance)
- [Procédures d'urgence](#procédures-durgence)

---

## 🚨 Incident de sécurité (Janvier 2026)

### Ce qui s'est passé

Le **11 janvier 2026**, un **cryptominer malveillant** a été découvert sur le VPS :

- **Symptômes** : CPU à 800%+, génération de scripts échouée avec "Pas de job ID reçu du VPS"
- **Malware trouvé** :
  - `/dev/shm/ekA112` (2.6 MB, cryptominer)
  - `/dev/shm/0lpHEH4G` (actif depuis le 7 janvier)
  - `/tmp/lrt` (1.3 MB, mécanisme de relance)
- **Temps CPU consommé** : 6315+ heures (264 jours cumulés sur plusieurs cores)
- **Charge CPU** : `load average: 8.81` (vs. normal ~1.0)

### Comment ils sont entrés

**Attaque SSH par force brute** :

```
5748 tentatives depuis 118.179.210.234 (Chine)
1287 tentatives depuis 116.153.88.36
416 tentatives depuis 68.183.2.33
... (10 000+ tentatives au total)
```

**Causes** :
1. ❌ Port SSH (22) ouvert sur internet
2. ❌ Authentification par **mot de passe** activée
3. ❌ Pas de **fail2ban** pour bloquer les attaques
4. ❌ Mot de passe Ubuntu probablement faible ou commun

**Résultat** : Les bots ont réussi à deviner le mot de passe et ont installé le cryptominer.

### Actions correctives

✅ **Malware supprimé** : Tous les processus malveillants ont été tués
✅ **fail2ban installé** : Bannit automatiquement les attaquants après 5 tentatives
✅ **Authentification SSH sécurisée** : Mot de passe désactivé, seulement clés SSH
✅ **`/dev/shm` protégé** : Monté en `noexec` pour empêcher l'exécution de malwares
✅ **Services redémarrés** : Tous les services PM2 fonctionnent normalement

---

## 🔐 Comment se connecter au VPS

### 📍 Informations de connexion

- **IP** : `51.91.158.233`
- **Domaine** : `purpleai.duckdns.org`
- **Utilisateur** : `ubuntu`
- **Port SSH** : `22` (par défaut)
- **Authentification** : **Clé SSH uniquement** (mot de passe désactivé)

### 🔑 Connexion SSH (depuis Mac/Linux)

```bash
# Méthode 1 : Via IP
ssh ubuntu@51.91.158.233

# Méthode 2 : Via nom de domaine
ssh ubuntu@purpleai.duckdns.org

# Si tu as plusieurs clés SSH
ssh -i ~/.ssh/id_ed25519 ubuntu@51.91.158.233
```

### 🪟 Connexion SSH (depuis Windows)

**Option 1 : PowerShell / CMD**

```powershell
ssh ubuntu@51.91.158.233
```

**Option 2 : PuTTY**

1. Télécharge [PuTTY](https://www.putty.org/)
2. Host Name : `51.91.158.233`
3. Port : `22`
4. Connection type : `SSH`
5. Authentification : Charge ta clé SSH privée (format `.ppk`)

### 🆘 Si tu ne peux pas te connecter

**Problème : "Permission denied (publickey)"**

→ Ta clé SSH n'est pas reconnue. Solutions :

```bash
# Vérifier que ta clé SSH existe
ls -la ~/.ssh/

# Vérifier les permissions (doivent être 600)
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub

# Tester la connexion en mode verbose
ssh -v ubuntu@51.91.158.233
```

**Problème : Clé SSH perdue**

→ Tu dois passer par le panneau de contrôle de ton hébergeur (OVH, Hostinger, etc.) pour :
1. Accéder à la console KVM (accès direct au serveur)
2. Réinitialiser le mot de passe root
3. Ajouter une nouvelle clé SSH

---

## 🛡️ Mesures de sécurité en place

### 1️⃣ **fail2ban** - Protection contre les attaques par force brute

**Status** :
```bash
sudo systemctl status fail2ban
sudo fail2ban-client status sshd
```

**Configuration** :
- Bannit automatiquement après **5 tentatives** échouées
- Durée du ban : **10 minutes** (par défaut)
- Les IPs bannies sont ajoutées au firewall

**Voir les IPs bannies** :
```bash
sudo fail2ban-client status sshd
sudo fail2ban-client get sshd banned
```

**Débannir une IP** (si tu t'es bloqué par erreur) :
```bash
sudo fail2ban-client set sshd unbanip <IP>
```

### 2️⃣ **SSH sécurisé** - Clés SSH uniquement

**Configuration** (`/etc/ssh/sshd_config`) :
```
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
```

**Conséquences** :
- ✅ Impossible de se connecter avec un mot de passe
- ✅ Seules les clés SSH autorisées peuvent se connecter
- ✅ Même si quelqu'un devine ton mot de passe, il ne peut pas entrer

**Clés SSH autorisées** (`~/.ssh/authorized_keys`) :
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIckcMHdbciiy1TczoTTzRH4JwGiyW2XvxDlpTL9eF+I tom@mac
```

### 3️⃣ **`/dev/shm` protégé** - Empêche l'exécution de malwares

**Configuration** (`/etc/fstab`) :
```
none /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0
```

**Conséquences** :
- ✅ Impossible d'exécuter des binaires depuis `/dev/shm/`
- ✅ Le malware ne peut plus se cacher en mémoire partagée
- ✅ Protection même après reboot

**Vérifier** :
```bash
mount | grep /dev/shm
```

Devrait afficher : `noexec,nosuid,nodev`

### 4️⃣ **UFW Firewall** - Limiter les ports ouverts

**Status** :
```bash
sudo ufw status
```

**Ports autorisés** :
- `22/tcp` (SSH)
- `80/tcp` (HTTP)
- `443/tcp` (HTTPS)
- `3000/tcp` (video-render-service)
- `9000/tcp` (webhook-deploy)

**Bloquer un port** :
```bash
sudo ufw deny <port>
sudo ufw reload
```

---

## 📊 Surveillance et maintenance

### 🔍 Vérifier l'état du VPS

**CPU et RAM** :
```bash
# Voir la charge CPU
uptime

# Voir la RAM disponible
free -h

# Voir les processus qui consomment le plus
top
# ou
htop
```

**Processus suspects** :
```bash
# Voir les processus par CPU
ps aux --sort=-%cpu | head -10

# Voir les processus par RAM
ps aux --sort=-%mem | head -10

# Chercher des processus suspects
ps aux | grep "/dev/shm\|/tmp"
```

**Connexions réseau** :
```bash
# Voir les connexions actives
sudo ss -tunp

# Voir les connexions suspectes (hors services connus)
sudo ss -tunp | grep -v ":22\|:80\|:443\|:3000\|:9000"
```

### 📋 Logs importants

**Logs SSH (tentatives de connexion)** :
```bash
sudo tail -f /var/log/auth.log
sudo grep "sshd" /var/log/auth.log | grep "Failed"
```

**Logs fail2ban (attaques bloquées)** :
```bash
sudo tail -f /var/log/fail2ban.log
```

**Logs services PM2** :
```bash
pm2 logs
pm2 logs video-render-service --lines 100
```

### 🔔 Alertes automatiques (optionnel)

**Installer un monitoring** :

```bash
# Option 1 : Netdata (monitoring temps réel)
bash <(curl -Ss https://my-netdata.io/kickstart.sh)

# Option 2 : Glances (monitoring CLI)
sudo apt install glances
glances
```

**Configurer des alertes email** (via fail2ban) :

```bash
sudo nano /etc/fail2ban/jail.local
```

Ajouter :
```ini
[DEFAULT]
destemail = ton-email@example.com
sendername = Fail2Ban VPS
action = %(action_mwl)s
```

---

## 🆘 Procédures d'urgence

### 🚨 Malware détecté

**1. Identifier le processus** :
```bash
ps aux --sort=-%cpu | head -10
ps aux | grep "/dev/shm\|/tmp"
```

**2. Tuer le processus** :
```bash
sudo kill -9 <PID>
```

**3. Supprimer les fichiers** :
```bash
sudo rm -f /dev/shm/*
sudo rm -f /tmp/<fichier-suspect>
```

**4. Vérifier les mécanismes de persistance** :
```bash
# Crontabs
crontab -l
sudo crontab -l

# Services systemd
systemctl --user list-unit-files --state=enabled
sudo systemctl list-unit-files --state=enabled | grep -v "systemd\|dbus"

# Scripts de démarrage
sudo find /etc/rc*.d /etc/init.d -type f -mtime -30
```

**5. Bloquer `/dev/shm` (si pas déjà fait)** :
```bash
sudo mount -o remount,noexec /dev/shm
echo "none /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab
```

### 🔒 Verrouillage d'urgence

**Si tu suspectes une intrusion en cours** :

```bash
# 1. Bannir toutes les connexions SSH (sauf la tienne)
sudo ufw deny 22
sudo ufw allow from <TON-IP> to any port 22

# 2. Arrêter tous les services non essentiels
pm2 stop all
sudo systemctl stop docker

# 3. Analyser les connexions actives
sudo ss -tunp
who
w

# 4. Déconnecter les sessions suspectes
sudo pkill -u <utilisateur>

# 5. Changer TOUS les mots de passe
passwd ubuntu
sudo passwd root
```

### 🔄 Redémarrage complet

**Si tout est compromis** :

```bash
# 1. Sauvegarder les données importantes
cd ~
tar -czf backup-$(date +%Y%m%d).tar.gz purple/ video-render-service/

# 2. Redémarrer le VPS
sudo reboot

# 3. Après reboot, vérifier l'état
uptime
ps aux --sort=-%cpu | head -10
sudo fail2ban-client status sshd
```

---

## 📚 Ressources supplémentaires

- [fail2ban Documentation](https://www.fail2ban.org/wiki/index.php/Main_Page)
- [SSH Hardening Guide](https://www.ssh.com/academy/ssh/hardening)
- [Linux Security Checklist](https://www.cyberciti.biz/tips/linux-security.html)

---

## 📞 Support

En cas de problème critique :
1. Consulter ce document
2. Vérifier les logs (`/var/log/auth.log`, `/var/log/fail2ban.log`)
3. Contacter le support de ton hébergeur (OVH, Hostinger, etc.)

---

**Dernière mise à jour** : 11 janvier 2026  
**Statut** : ✅ VPS sécurisé et opérationnel
