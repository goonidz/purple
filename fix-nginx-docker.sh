#!/bin/bash

# Script de correction automatique nginx + Docker + DuckDNS
# Ce script résout tous les problèmes de configuration

set -e

echo "🔧 Correction automatique de la configuration..."

# Arrêter nginx temporairement
sudo systemctl stop nginx 2>/dev/null || true

# Arrêter et supprimer le container Docker
sudo docker stop videoflow 2>/dev/null || true
sudo docker rm videoflow 2>/dev/null || true

# Redémarrer Docker sur le port 8080 (interne uniquement)
echo "🐳 Démarrage Docker sur le port 8080..."
sudo docker run -d \
    --name videoflow \
    -p 127.0.0.1:8080:80 \
    --restart unless-stopped \
    videoflow:latest

# Attendre que Docker soit prêt
sleep 2

# Vérifier que Docker répond
if ! curl -s http://localhost:8080/health > /dev/null; then
    echo "⚠️  Docker ne répond pas encore, attente supplémentaire..."
    sleep 3
fi

# Mettre à jour la configuration nginx
echo "⚙️  Configuration nginx..."
sudo cp ~/purple/nginx-videoflow.conf /etc/nginx/sites-available/videoflow 2>/dev/null || true

# Remplacer le domaine
sudo sed -i 's/videoflow.duckdns.org/purpleai.duckdns.org/g' /etc/nginx/sites-available/videoflow 2>/dev/null || true

# Remplacer tous les proxy_pass vers 8080 (regex pour matcher n'importe quel port)
sudo sed -i -E 's|proxy_pass http://localhost:[0-9]+|proxy_pass http://localhost:8080|g' /etc/nginx/sites-available/videoflow 2>/dev/null || true

# Activer le site
sudo ln -sf /etc/nginx/sites-available/videoflow /etc/nginx/sites-enabled/ 2>/dev/null || true
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Tester la configuration
if sudo nginx -t; then
    echo "✅ Configuration nginx valide"
    sudo systemctl start nginx
    sudo systemctl enable nginx
    echo "✅ nginx démarré"
else
    echo "❌ Erreur dans la configuration nginx"
    sudo nginx -t
    exit 1
fi

# Mettre à jour DuckDNS
echo "🌐 Mise à jour DuckDNS..."
if [ -f ~/.duckdns ]; then
    source ~/.duckdns
    if [ ! -z "$DUCKDNS_DOMAIN" ] && [ ! -z "$DUCKDNS_TOKEN" ]; then
        RESPONSE=$(curl -s --max-time 10 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" 2>&1)
        if [ "$RESPONSE" = "OK" ]; then
            echo "✅ DuckDNS mis à jour"
        else
            echo "⚠️  DuckDNS: $RESPONSE (peut prendre quelques minutes pour se propager)"
        fi
    fi
fi

# Tester localement
echo "🧪 Tests..."
if curl -s http://localhost:8080/health > /dev/null; then
    echo "✅ Docker répond sur le port 8080"
else
    echo "⚠️  Docker ne répond pas encore"
fi

if curl -s http://localhost/health > /dev/null; then
    echo "✅ nginx proxy fonctionne"
else
    echo "⚠️  nginx proxy ne répond pas encore"
fi

# Configuration SSL (si pas déjà configuré)
echo ""
echo "🔒 Vérification SSL..."
if [ ! -f /etc/letsencrypt/live/purpleai.duckdns.org/fullchain.pem ]; then
    if [ -f ~/purple/setup-ssl.sh ]; then
        echo "   SSL non configuré. Pour activer SSL, exécutez:"
        echo "   cd ~/purple && ./setup-ssl.sh"
    fi
else
    echo "   ✅ SSL déjà configuré"
fi

echo ""
echo "✅ Configuration terminée!"
echo ""
echo "🌐 Votre site devrait être accessible sur:"
echo "   http://purpleai.duckdns.org"
if [ -f /etc/letsencrypt/live/purpleai.duckdns.org/fullchain.pem ]; then
    echo "   https://purpleai.duckdns.org (SSL activé)"
fi
echo ""
echo "📋 Vérifications:"
echo "   sudo docker ps"
echo "   sudo systemctl status nginx"
echo "   curl -I http://localhost"
echo "   curl -I http://purpleai.duckdns.org"
echo ""
