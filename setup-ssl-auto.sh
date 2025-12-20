#!/bin/bash

# Script de configuration SSL automatique avec diagnostic complet
# Usage: ./setup-ssl-auto.sh

set +e  # Ne pas échouer sur les erreurs pour mieux diagnostiquer

echo "🔒 Configuration SSL automatique avec diagnostic..."

DOMAIN="purpleai.duckdns.org"
CURRENT_IP=$(hostname -I | awk '{print $1}')

# Vérifier que Certbot est installé
if ! command -v certbot &> /dev/null; then
    echo "📦 Installation de Certbot..."
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
fi

# Vérifier si le certificat existe déjà
if sudo test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem; then
    echo "✅ Certificat SSL existe déjà pour ${DOMAIN}"
    exit 0
fi

# Étape 1: Vérifier et mettre à jour DuckDNS
echo "🌐 Vérification DuckDNS..."
if [ -f ~/.duckdns ]; then
    source ~/.duckdns
    if [ ! -z "$DUCKDNS_DOMAIN" ] && [ ! -z "$DUCKDNS_TOKEN" ]; then
        echo "   Mise à jour de l'IP DuckDNS..."
        RESPONSE=$(curl -s --max-time 10 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" 2>&1)
        if [ "$RESPONSE" = "OK" ]; then
            echo "   ✅ DuckDNS mis à jour"
        else
            echo "   ⚠️  DuckDNS: $RESPONSE"
        fi
        # Attendre que DNS se propage
        echo "   ⏳ Attente de la propagation DNS (30 secondes)..."
        sleep 30
    fi
fi

# Étape 2: Vérifier que nginx fonctionne
echo "🔍 Vérification nginx..."
if ! sudo systemctl is-active --quiet nginx; then
    echo "   ⚠️  Nginx n'est pas actif, démarrage..."
    sudo systemctl start nginx
    sleep 2
fi

if ! sudo systemctl is-active --quiet nginx; then
    echo "   ❌ Impossible de démarrer nginx"
    exit 1
fi

# Étape 3: Vérifier que le domaine est accessible
echo "🧪 Test d'accessibilité du domaine..."
if curl -s -I http://${DOMAIN} --max-time 10 > /dev/null 2>&1; then
    echo "   ✅ Domaine accessible"
else
    echo "   ⚠️  Domaine non accessible depuis ce serveur"
    echo "   Vérification de la résolution DNS..."
    DNS_IP=$(nslookup ${DOMAIN} 2>/dev/null | grep -A 1 "Name:" | grep "Address:" | awk '{print $2}' | head -1)
    if [ "$DNS_IP" = "$CURRENT_IP" ]; then
        echo "   ✅ DNS pointe vers la bonne IP ($CURRENT_IP)"
    else
        echo "   ⚠️  DNS pointe vers: $DNS_IP (attendu: $CURRENT_IP)"
        echo "   Le DNS peut prendre quelques minutes à se propager"
    fi
fi

# Étape 4: Vérifier que nginx répond localement
echo "🔍 Test nginx local..."
if curl -s -I http://localhost --max-time 5 > /dev/null 2>&1; then
    echo "   ✅ Nginx répond localement"
else
    echo "   ❌ Nginx ne répond pas localement"
    echo "   Vérification: sudo systemctl status nginx"
    exit 1
fi

# Étape 5: Obtenir le certificat SSL
echo ""
echo "🔐 Obtention du certificat SSL pour ${DOMAIN}..."

# Essayer d'abord avec nginx
echo "   Tentative avec plugin nginx..."
sudo certbot --nginx -d ${DOMAIN} \
    --non-interactive \
    --agree-tos \
    --email admin@${DOMAIN} \
    --redirect \
    --quiet 2>&1

if [ $? -eq 0 ]; then
    echo "   ✅ Certificat obtenu avec succès!"
else
    echo "   ⚠️  Échec avec plugin nginx, tentative avec standalone..."
    
    # Arrêter nginx temporairement pour standalone
    sudo systemctl stop nginx
    
    # Obtenir le certificat en mode standalone
    sudo certbot certonly --standalone -d ${DOMAIN} \
        --non-interactive \
        --agree-tos \
        --email admin@${DOMAIN} \
        --quiet 2>&1
    
    if [ $? -eq 0 ]; then
        echo "   ✅ Certificat obtenu en mode standalone!"
        
        # Redémarrer nginx
        sudo systemctl start nginx
        
        # Configurer nginx manuellement pour SSL
        echo "   ⚙️  Configuration nginx pour SSL..."
        
        # Lire la configuration actuelle
        NGINX_CONFIG="/etc/nginx/sites-available/videoflow"
        if [ -f "$NGINX_CONFIG" ]; then
            # Créer une sauvegarde
            sudo cp "$NGINX_CONFIG" "${NGINX_CONFIG}.backup"
            
            # Ajouter la configuration SSL
            sudo tee -a "$NGINX_CONFIG" > /dev/null <<EOF

# SSL Configuration (added by setup-ssl-auto.sh)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
    }

    location /health {
        proxy_pass http://localhost:8080/health;
        access_log off;
    }
}

# Redirection HTTP vers HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$server_name\$request_uri;
}
EOF
            
            # Tester la configuration
            if sudo nginx -t; then
                sudo systemctl reload nginx
                echo "   ✅ Nginx configuré pour SSL"
            else
                echo "   ❌ Erreur dans la configuration nginx"
                sudo cp "${NGINX_CONFIG}.backup" "$NGINX_CONFIG"
                sudo systemctl start nginx
                exit 1
            fi
        fi
    else
        echo "   ❌ Échec de l'obtention du certificat"
        sudo systemctl start nginx
        echo ""
        echo "📋 Vérifications à faire:"
        echo "   1. Vérifier les logs: sudo tail -50 /var/log/letsencrypt/letsencrypt.log"
        echo "   2. Vérifier DNS: nslookup ${DOMAIN}"
        echo "   3. Vérifier nginx: sudo systemctl status nginx"
        exit 1
    fi
fi

# Vérifier que le certificat existe maintenant
if sudo test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem; then
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
else
    echo "❌ Le certificat n'a pas été créé"
    exit 1
fi
