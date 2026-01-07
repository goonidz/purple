# Configuration HTTPS avec Cloudflare (Gratuit)

Cloudflare offre HTTPS gratuit via leur service de proxy. C'est une excellente alternative à DuckDNS pour obtenir HTTPS rapidement.

## Avantages de Cloudflare

✅ **HTTPS gratuit** - Certificats SSL automatiques  
✅ **DNS fiable** - Pas de problèmes comme DuckDNS  
✅ **CDN gratuit** - Accélération du site  
✅ **Protection DDoS** - Protection basique incluse  
✅ **Gestion de domaine** - Support pour vrais domaines et sous-domaines  

## Prérequis

- Un domaine (même gratuit via Freenom, ou un domaine payant)
- OU utiliser un sous-domaine Cloudflare (ex: `votre-site.pages.dev`)

## Option 1 : Utiliser un domaine existant

### Étape 1 : Créer un compte Cloudflare

1. Aller sur https://dash.cloudflare.com/sign-up
2. Créer un compte gratuit

### Étape 2 : Ajouter votre domaine

1. Dans le dashboard Cloudflare, cliquer sur "Add a site"
2. Entrer votre domaine (ex: `purpleai.duckdns.org` ou un vrai domaine)
3. Choisir le plan **Free**
4. Cloudflare va scanner vos DNS actuels

### Étape 3 : Changer les nameservers

Cloudflare vous donnera 2 nameservers (ex: `alice.ns.cloudflare.com` et `bob.ns.cloudflare.com`)

**Pour DuckDNS :**
- Aller sur https://www.duckdns.org
- Se connecter
- Modifier le domaine `purpleai`
- Changer les nameservers vers ceux de Cloudflare

**Pour un vrai domaine :**
- Aller chez votre registrar (GoDaddy, Namecheap, etc.)
- Modifier les nameservers du domaine

### Étape 4 : Configurer les DNS dans Cloudflare

Dans Cloudflare Dashboard → DNS → Records :

1. **A Record** :
   - Type: `A`
   - Name: `@` (ou `purpleai` pour sous-domaine)
   - IPv4 address: `51.91.158.233`
   - Proxy status: **Proxied** (orange cloud) ⚠️ **IMPORTANT**
   - TTL: Auto

2. **CNAME pour www** (optionnel) :
   - Type: `CNAME`
   - Name: `www`
   - Target: `purpleai.duckdns.org` (ou votre domaine)
   - Proxy status: **Proxied**
   - TTL: Auto

### Étape 5 : Activer SSL/TLS

1. Aller dans **SSL/TLS** → **Overview**
2. Choisir **Full (strict)** ou **Full**
   - **Full (strict)** : Utilise le certificat Cloudflare (recommandé)
   - **Full** : Accepte les certificats auto-signés
3. HTTPS sera automatiquement activé !

### Étape 6 : Configuration Nginx sur le VPS

Puisque Cloudflare gère HTTPS, vous pouvez configurer Nginx pour accepter les connexions Cloudflare :

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name purpleai.duckdns.org;

    # Logs
    access_log /var/log/nginx/purpleai-access.log;
    error_log /var/log/nginx/purpleai-error.log;

    # Fix pour les gros cookies/headers
    large_client_header_buffers 4 32k;
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;

    # Frontend - Proxy vers le container Docker
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # Cloudflare headers
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
        proxy_set_header CF-Ray $http_cf_ray;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Video Render Service API
    location /api/render/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # Timeouts longs pour le rendu vidéo
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        
        # Pas de limite de taille pour upload
        client_max_body_size 100M;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:8080/health;
        access_log off;
    }
}
```

**Note importante** : Avec Cloudflare, Nginx écoute seulement sur le port 80 (HTTP). Cloudflare gère HTTPS entre le client et leurs serveurs.

## Option 2 : Utiliser Cloudflare Pages (pour sites statiques)

Si votre frontend est statique, Cloudflare Pages offre :
- HTTPS automatique
- Déploiement gratuit
- CDN global

Mais pour votre cas (avec Docker + API), l'Option 1 est meilleure.

## Vérification

Après configuration :

1. **Tester HTTPS** :
   ```bash
   curl -I https://purpleai.duckdns.org
   ```

2. **Vérifier le certificat** :
   - Ouvrir https://purpleai.duckdns.org dans un navigateur
   - Cliquer sur le cadenas dans la barre d'adresse
   - Vérifier que le certificat est émis par Cloudflare

## Coûts

- **Plan Free** : 0€/mois
- **HTTPS** : Gratuit
- **CDN** : Gratuit
- **Protection DDoS** : Gratuite (basique)

## Avantages vs Let's Encrypt

| Feature | Let's Encrypt | Cloudflare |
|---------|---------------|------------|
| HTTPS | ✅ Gratuit | ✅ Gratuit |
| Configuration | ⚠️ Complexe | ✅ Simple |
| DNS | ❌ Externe | ✅ Intégré |
| CDN | ❌ Non | ✅ Oui |
| Renouvellement | ⚠️ Automatique mais peut échouer | ✅ Géré par Cloudflare |
| Problèmes DNS | ⚠️ Possible (DuckDNS) | ✅ Rare |

## Migration depuis DuckDNS

Si vous voulez migrer de DuckDNS vers Cloudflare :

1. Suivre les étapes ci-dessus
2. Changer les nameservers dans DuckDNS
3. Attendre la propagation DNS (quelques minutes à quelques heures)
4. HTTPS sera automatiquement activé !

## Support

- Documentation Cloudflare : https://developers.cloudflare.com/
- Support gratuit disponible (chat/email)
