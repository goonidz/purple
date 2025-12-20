# Instructions DuckDNS à exécuter sur le VPS

Ces instructions doivent être exécutées sur votre VPS après avoir créé votre compte DuckDNS.

## Prérequis

1. Avoir créé un compte DuckDNS sur https://www.duckdns.org
2. Avoir noté votre Token DuckDNS
3. Avoir choisi un sous-domaine (ex: `videoflow`)

## Étapes d'installation

### 1. Récupérer les fichiers depuis GitHub

```bash
cd ~/purple
git pull origin main
```

### 2. Configurer le fichier .duckdns

```bash
# Créer le fichier de configuration
cat > ~/.duckdns << EOF
DUCKDNS_DOMAIN=videoflow
DUCKDNS_TOKEN=votre-token-ici
EOF

# Remplacez "videoflow" par votre sous-domaine
# Remplacez "votre-token-ici" par votre vrai token DuckDNS
```

### 3. Configurer le script de mise à jour

```bash
# Copier le script
cp ~/purple/update-duckdns.sh ~/
chmod +x ~/update-duckdns.sh

# Tester le script
~/update-duckdns.sh
```

Vous devriez voir : `DuckDNS IP updated successfully`

### 4. Configurer le cron job

```bash
# Éditer le crontab
crontab -e

# Ajouter cette ligne (ajustez le chemin si nécessaire)
*/5 * * * * /home/ubuntu/update-duckdns.sh >> /home/ubuntu/duckdns.log 2>&1
```

Cela mettra à jour l'IP toutes les 5 minutes.

### 5. Installer nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 6. Configurer nginx

```bash
# Copier la configuration
sudo cp ~/purple/nginx-videoflow.conf /etc/nginx/sites-available/videoflow

# Modifier le nom de domaine dans le fichier
sudo nano /etc/nginx/sites-available/videoflow
# Remplacez "videoflow.duckdns.org" par votre domaine (ex: monapp.duckdns.org)

# Activer le site
sudo ln -s /etc/nginx/sites-available/videoflow /etc/nginx/sites-enabled/

# Supprimer la configuration par défaut (optionnel)
sudo rm /etc/nginx/sites-enabled/default

# Tester la configuration
sudo nginx -t

# Si le test est OK, redémarrer nginx
sudo systemctl restart nginx
```

### 7. Configurer le firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

### 8. Tester l'accès

Ouvrez votre navigateur et allez sur :
```
http://votre-domaine.duckdns.org
```

### 9. (Optionnel) Configurer SSL avec Let's Encrypt

```bash
# Installer Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Obtenir le certificat SSL
sudo certbot --nginx -d votre-domaine.duckdns.org

# Suivez les instructions à l'écran
# Le certificat sera renouvelé automatiquement
```

Après SSL, votre site sera accessible en HTTPS.

## Vérifications

```bash
# Vérifier que DuckDNS pointe vers la bonne IP
nslookup votre-domaine.duckdns.org

# Vérifier les logs nginx
sudo tail -f /var/log/nginx/videoflow-access.log

# Vérifier les logs DuckDNS
tail -f ~/duckdns.log

# Vérifier le statut nginx
sudo systemctl status nginx
```

## Dépannage

### Le domaine ne fonctionne pas

1. Vérifiez que DuckDNS pointe vers la bonne IP : `nslookup votre-domaine.duckdns.org`
2. Vérifiez les logs nginx : `sudo tail -f /var/log/nginx/videoflow-error.log`
3. Vérifiez que nginx tourne : `sudo systemctl status nginx`
4. Vérifiez que le container Docker tourne : `sudo docker ps`

### L'IP n'est pas mise à jour

1. Vérifiez le fichier `.duckdns` : `cat ~/.duckdns`
2. Testez le script manuellement : `~/update-duckdns.sh`
3. Vérifiez les logs cron : `tail -f ~/duckdns.log`
