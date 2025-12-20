#!/bin/bash

# Script de configuration SSL automatique avec Let's Encrypt
# Usage: ./setup-ssl.sh

set -e

echo "🔒 Configuration SSL avec Let's Encrypt..."

DOMAIN="purpleai.duckdns.org"

# Vérifier que nginx fonctionne
if ! sudo systemctl is-active --quiet nginx; then
    echo "❌ Nginx n'est pas actif. Démarrez nginx d'abord."
    exit 1
fi

# Installer Certbot si pas déjà installé
if ! command -v certbot &> /dev/null; then
    echo "📦 Installation de Certbot..."
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
    echo "✅ Certbot installé"
else
    echo "✅ Certbot déjà installé"
fi

# Vérifier si le certificat existe déjà
if sudo test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem; then
    echo "✅ Certificat SSL existe déjà pour ${DOMAIN}"
    echo "   Pour renouveler: sudo certbot renew"
    exit 0
fi

# Vérifier que le domaine est accessible
echo "🧪 Vérification de l'accessibilité du domaine..."
if ! curl -s -I http://${DOMAIN} > /dev/null 2>&1; then
    echo "⚠️  Le domaine ${DOMAIN} n'est pas accessible depuis ce serveur"
    echo "   Vérifiez que DuckDNS pointe vers la bonne IP:"
    echo "   nslookup ${DOMAIN}"
    echo "   L'IP devrait être: $(hostname -I | awk '{print $1}')"
    echo ""
    echo "   Si l'IP est différente, mettez à jour DuckDNS:"
    echo "   ~/update-duckdns.sh"
    exit 1
fi

# Vérifier que nginx répond sur le port 80
if ! curl -s http://localhost > /dev/null 2>&1; then
    echo "⚠️  Nginx ne répond pas sur le port 80"
    echo "   Vérifiez: sudo systemctl status nginx"
    exit 1
fi

# Obtenir le certificat SSL
echo "🔐 Obtention du certificat SSL pour ${DOMAIN}..."
echo "   (Cela peut prendre quelques secondes...)"

# Mode non-interactif avec email automatique
sudo certbot --nginx -d ${DOMAIN} \
    --non-interactive \
    --agree-tos \
    --email admin@${DOMAIN} \
    --redirect \
    --quiet 2>&1 || {
    echo ""
    echo "⚠️  Erreur lors de l'obtention du certificat"
    echo ""
    echo "📋 Vérifications à faire:"
    echo "   1. Vérifier que le domaine pointe vers ce serveur:"
    echo "      nslookup ${DOMAIN}"
    echo ""
    echo "   2. Vérifier que nginx fonctionne:"
    echo "      sudo systemctl status nginx"
    echo "      curl -I http://localhost"
    echo ""
    echo "   3. Vérifier que le port 80 est accessible:"
    echo "      sudo ss -tulpn | grep :80"
    echo ""
    echo "   4. Vérifier les logs Certbot:"
    echo "      sudo tail -50 /var/log/letsencrypt/letsencrypt.log"
    echo ""
    echo "   5. Essayer en mode interactif pour plus de détails:"
    echo "      sudo certbot --nginx -d ${DOMAIN}"
    exit 1
}

# Vérifier que nginx a été mis à jour
if sudo nginx -t; then
    sudo systemctl reload nginx
    echo "✅ Nginx rechargé avec la configuration SSL"
else
    echo "❌ Erreur dans la configuration nginx"
    exit 1
fi

# Vérifier le renouvellement automatique
if sudo test -f /etc/cron.d/certbot; then
    echo "✅ Renouvellement automatique configuré"
else
    echo "⚠️  Renouvellement automatique non détecté (peut être géré par systemd)"
fi

echo ""
echo "✅ SSL configuré avec succès!"
echo ""
echo "🌐 Votre site est maintenant accessible en HTTPS:"
echo "   https://${DOMAIN}"
echo ""
echo "📋 Vérifications:"
echo "   curl -I https://${DOMAIN}"
echo "   sudo certbot certificates"
echo ""
