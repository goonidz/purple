#!/bin/bash

# Script d'installation HTTPS pour purpleai.duckdns.org
# À exécuter sur le VPS avec les droits sudo

set -e

DOMAIN="purpleai.duckdns.org"
NGINX_CONFIG="/etc/nginx/sites-available/purpleai"
NGINX_ENABLED="/etc/nginx/sites-enabled/purpleai"

echo "🔒 Configuration HTTPS pour $DOMAIN"
echo ""

# Vérifier que le script est exécuté avec sudo
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Ce script doit être exécuté avec sudo"
    exit 1
fi

# Étape 1: Installer Certbot
echo "📦 Installation de Certbot..."
apt update
apt install -y certbot python3-certbot-nginx

# Étape 2: Copier la configuration Nginx
echo "📝 Configuration de Nginx..."
if [ -f "$NGINX_CONFIG" ]; then
    echo "⚠️  La configuration existe déjà. Voulez-vous la remplacer ? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "❌ Installation annulée"
        exit 1
    fi
fi

# Copier depuis le répertoire courant (si le fichier existe)
if [ -f "nginx-purpleai.conf" ]; then
    cp nginx-purpleai.conf "$NGINX_CONFIG"
elif [ -f "../nginx-purpleai.conf" ]; then
    cp ../nginx-purpleai.conf "$NGINX_CONFIG"
else
    echo "⚠️  Fichier nginx-purpleai.conf non trouvé. Création d'une configuration de base..."
    cat > "$NGINX_CONFIG" << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name purpleai.duckdns.org;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/render/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        client_max_body_size 100M;
    }
}
EOF
fi

# Activer le site
if [ ! -L "$NGINX_ENABLED" ]; then
    ln -s "$NGINX_CONFIG" "$NGINX_ENABLED"
fi

# Tester la configuration Nginx
echo "🧪 Test de la configuration Nginx..."
nginx -t

# Recharger Nginx
echo "🔄 Rechargement de Nginx..."
systemctl reload nginx

# Étape 3: Vérifier que les ports sont ouverts
echo "🔍 Vérification des ports..."
if ! ufw status | grep -q "443/tcp"; then
    echo "📌 Ouverture du port 443..."
    ufw allow 443/tcp
fi

if ! ufw status | grep -q "80/tcp"; then
    echo "📌 Ouverture du port 80..."
    ufw allow 80/tcp
fi

# Étape 4: Obtenir le certificat SSL
echo ""
echo "🔐 Obtention du certificat SSL avec Let's Encrypt..."
echo "⚠️  Assurez-vous que le domaine $DOMAIN pointe bien vers cette machine !"
echo ""
read -p "Continuer ? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Installation annulée"
    exit 1
fi

# Exécuter Certbot
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@purpleai.duckdns.org --redirect

echo ""
echo "✅ Installation terminée !"
echo ""
echo "📋 Vérifications :"
echo "   - Testez HTTPS : curl -I https://$DOMAIN"
echo "   - Testez la redirection : curl -I http://$DOMAIN"
echo "   - Vérifiez le renouvellement : certbot renew --dry-run"
echo ""
echo "🔄 Le certificat sera renouvelé automatiquement tous les 90 jours"
