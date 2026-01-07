# Configuration HTTPS pour purpleai.duckdns.org

Ce guide explique comment activer HTTPS gratuitement avec Let's Encrypt pour votre domaine DuckDNS.

## Prérequis

- Accès SSH au VPS (51.91.158.233)
- Le domaine `purpleai.duckdns.org` doit pointer vers l'IP du VPS
- Ports 80 et 443 ouverts sur le firewall

## Installation automatique (recommandé)

1. **Copier les fichiers sur le VPS**

```bash
# Depuis votre machine locale
scp nginx-purpleai.conf ubuntu@51.91.158.233:/home/ubuntu/
scp scripts/setup-https.sh ubuntu@51.91.158.233:/home/ubuntu/
```

2. **Se connecter au VPS et exécuter le script**

```bash
ssh ubuntu@51.91.158.233
chmod +x setup-https.sh
sudo ./setup-https.sh
```

Le script va :
- Installer Certbot et le plugin Nginx
- Configurer Nginx pour purpleai.duckdns.org
- Obtenir automatiquement le certificat SSL
- Configurer la redirection HTTP → HTTPS

## Installation manuelle

### Étape 1 : Installer Certbot

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

### Étape 2 : Configurer Nginx

```bash
# Copier la configuration
sudo cp nginx-purpleai.conf /etc/nginx/sites-available/purpleai

# Activer le site
sudo ln -s /etc/nginx/sites-available/purpleai /etc/nginx/sites-enabled/

# Tester la configuration
sudo nginx -t

# Recharger Nginx
sudo systemctl reload nginx
```

### Étape 3 : Ouvrir les ports (si nécessaire)

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### Étape 4 : Obtenir le certificat SSL

```bash
sudo certbot --nginx -d purpleai.duckdns.org
```

Certbot va vous demander :
- Une adresse email (pour les notifications de renouvellement)
- Si vous acceptez les conditions d'utilisation
- Si vous voulez rediriger HTTP vers HTTPS (recommandé : Oui)

Certbot va automatiquement :
- Obtenir le certificat Let's Encrypt
- Modifier la config Nginx pour ajouter HTTPS
- Configurer la redirection HTTP → HTTPS
- Ajouter un cron pour le renouvellement automatique

## Vérification

### Tester HTTPS

```bash
curl -I https://purpleai.duckdns.org
```

Vous devriez voir `HTTP/2 200` ou similaire.

### Tester la redirection HTTP → HTTPS

```bash
curl -I http://purpleai.duckdns.org
```

Vous devriez voir `HTTP/1.1 301 Moved Permanently` avec `Location: https://purpleai.duckdns.org/...`

### Tester le service de rendu vidéo

```bash
curl https://purpleai.duckdns.org/api/render/health
```

## Mise à jour de la configuration

### Mettre à jour VPS_PUBLIC_URL

Dans `video-render-service/.env` sur le VPS :

```env
VPS_PUBLIC_URL=https://purpleai.duckdns.org/api/render
```

Puis redémarrer le service :

```bash
cd /home/ubuntu/video-render-service
npm run pm2:restart
```

### Mettre à jour le frontend

Si le frontend fait des appels directs au service de rendu, mettre à jour l'URL pour utiliser HTTPS.

## Renouvellement automatique

Let's Encrypt renouvelle automatiquement les certificats tous les 90 jours. Certbot installe un cron job qui vérifie et renouvelle les certificats automatiquement.

### Tester le renouvellement

```bash
sudo certbot renew --dry-run
```

Si cette commande fonctionne, le renouvellement automatique fonctionnera aussi.

## Dépannage

### Le certificat n'est pas obtenu

1. Vérifier que le domaine pointe bien vers le VPS :
   ```bash
   dig purpleai.duckdns.org
   ```

2. Vérifier que les ports 80 et 443 sont ouverts :
   ```bash
   sudo ufw status
   ```

3. Vérifier les logs Nginx :
   ```bash
   sudo tail -f /var/log/nginx/purpleai-error.log
   ```

### Le certificat expire

Les certificats Let's Encrypt sont valides 90 jours. Le renouvellement automatique devrait fonctionner, mais vous pouvez forcer le renouvellement :

```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Erreur "Too many certificates"

Let's Encrypt limite à 50 certificats par domaine par semaine. Si vous avez fait trop de tentatives, attendez quelques heures.

## Coûts

- **Let's Encrypt** : Gratuit
- **Certbot** : Gratuit
- **Renouvellement** : Gratuit et automatique
- **Total** : 0€

## Sécurité

Une fois HTTPS activé :
- Toutes les communications sont chiffrées
- Les certificats sont reconnus par tous les navigateurs
- La redirection HTTP → HTTPS force l'utilisation de HTTPS
- Les certificats sont renouvelés automatiquement

## Support

Pour plus d'informations :
- [Documentation Let's Encrypt](https://letsencrypt.org/docs/)
- [Documentation Certbot](https://certbot.eff.org/)
- [Documentation Nginx](https://nginx.org/en/docs/)
