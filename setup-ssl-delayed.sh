#!/bin/bash

# Script de configuration SSL avec gestion du rate limit Let's Encrypt
# Usage: ./setup-ssl-delayed.sh

set +e

echo "🔒 Configuration SSL avec gestion du rate limit..."

DOMAIN="purpleai.duckdns.org"

# Vérifier si le certificat existe déjà
if sudo test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem; then
    echo "✅ Certificat SSL existe déjà pour ${DOMAIN}"
    exit 0
fi

# Vérifier le rate limit Let's Encrypt
echo "⏳ Vérification du rate limit Let's Encrypt..."
RATE_LIMIT_INFO=$(sudo certbot certificates 2>&1 | grep -i "rate limit" || echo "")

if echo "$RATE_LIMIT_INFO" | grep -qi "rate limit\|too many"; then
    echo "⚠️  Rate limit Let's Encrypt détecté"
    echo "   Il faut attendre avant de réessayer"
    echo "   Let's Encrypt limite à 5 échecs par heure par domaine"
    echo ""
    echo "📋 Solutions:"
    echo "   1. Attendre 1 heure avant de réessayer"
    echo "   2. Utiliser un autre domaine temporairement"
    echo "   3. Vérifier que le domaine pointe bien vers ce serveur"
    echo ""
    echo "   Pour réessayer plus tard:"
    echo "   ./setup-ssl-auto.sh"
    exit 1
fi

# Vérifier que nginx fonctionne
if ! sudo systemctl is-active --quiet nginx; then
    echo "❌ Nginx n'est pas actif"
    exit 1
fi

# Vérifier que le domaine est accessible
echo "🧪 Test d'accessibilité..."
if ! curl -s -I http://${DOMAIN} --max-time 10 > /dev/null 2>&1; then
    echo "⚠️  Le domaine n'est pas accessible"
    echo "   Vérifiez: nslookup ${DOMAIN}"
    echo "   L'IP devrait être: $(hostname -I | awk '{print $1}')"
    exit 1
fi

# Obtenir le certificat
echo "🔐 Obtention du certificat SSL..."
sudo certbot --nginx -d ${DOMAIN} \
    --non-interactive \
    --agree-tos \
    --email admin@${DOMAIN} \
    --redirect

if [ $? -eq 0 ]; then
    echo "✅ SSL configuré avec succès!"
    echo "🌐 https://${DOMAIN}"
else
    echo "❌ Échec. Vérifiez les logs: sudo tail -50 /var/log/letsencrypt/letsencrypt.log"
    exit 1
fi
