#!/bin/bash

# Script de configuration rapide DuckDNS
# Usage: ./setup-duckdns.sh

set -e

echo "🚀 Configuration DuckDNS pour VideoFlow..."

# Variables (remplacer par vos valeurs)
DUCKDNS_DOMAIN="purpleai"
DUCKDNS_TOKEN="b7971357-d439-478b-83af-7ec43496c03e"
DUCKDNS_FULL_DOMAIN="purpleai.duckdns.org"

echo "📝 Configuration:"
echo "   Domaine: $DUCKDNS_FULL_DOMAIN"
echo "   Token: ${DUCKDNS_TOKEN:0:10}..."
echo ""

# Créer le fichier de configuration
echo "📄 Création du fichier ~/.duckdns..."
cat > ~/.duckdns << EOF
DUCKDNS_DOMAIN=$DUCKDNS_DOMAIN
DUCKDNS_TOKEN=$DUCKDNS_TOKEN
EOF

chmod 600 ~/.duckdns
echo "✅ Fichier ~/.duckdns créé"

# Copier le script de mise à jour
echo "📋 Copie du script de mise à jour..."
if [ -f ~/purple/update-duckdns.sh ]; then
    cp ~/purple/update-duckdns.sh ~/
    chmod +x ~/update-duckdns.sh
    echo "✅ Script copié"
else
    echo "⚠️  Script update-duckdns.sh non trouvé dans ~/purple"
    echo "   Assurez-vous d'avoir fait: git pull origin main"
fi

# Tester la mise à jour
echo ""
echo "🧪 Test de mise à jour DuckDNS..."
if [ -f ~/update-duckdns.sh ]; then
    ~/update-duckdns.sh
    if [ $? -eq 0 ]; then
        echo "✅ Mise à jour DuckDNS réussie!"
    else
        echo "❌ Erreur lors de la mise à jour DuckDNS"
    fi
fi

# Configurer le cron job
echo ""
echo "⏰ Configuration du cron job..."
(crontab -l 2>/dev/null | grep -v "update-duckdns.sh"; echo "*/5 * * * * $HOME/update-duckdns.sh >> $HOME/duckdns.log 2>&1") | crontab -
echo "✅ Cron job configuré (mise à jour toutes les 5 minutes)"

# Installer nginx si nécessaire
echo ""
if ! command -v nginx &> /dev/null; then
    echo "📦 Installation de nginx..."
    sudo apt-get update
    sudo apt-get install -y nginx
    echo "✅ nginx installé"
else
    echo "✅ nginx déjà installé"
fi

# Configurer nginx
echo ""
echo "⚙️  Configuration nginx..."
if [ -f ~/purple/nginx-videoflow.conf ]; then
    # Copier la configuration
    sudo cp ~/purple/nginx-videoflow.conf /etc/nginx/sites-available/videoflow
    
    # Remplacer le nom de domaine dans le fichier
    sudo sed -i "s/videoflow.duckdns.org/$DUCKDNS_FULL_DOMAIN/g" /etc/nginx/sites-available/videoflow
    
    # Activer le site
    sudo ln -sf /etc/nginx/sites-available/videoflow /etc/nginx/sites-enabled/
    
    # Supprimer la config par défaut si elle existe
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Tester la configuration
    if sudo nginx -t; then
        sudo systemctl restart nginx
        echo "✅ nginx configuré et redémarré"
    else
        echo "❌ Erreur dans la configuration nginx"
        exit 1
    fi
else
    echo "⚠️  Fichier nginx-videoflow.conf non trouvé"
    echo "   Assurez-vous d'avoir fait: git pull origin main"
fi

# Configurer le firewall
echo ""
echo "🔥 Configuration du firewall..."
sudo ufw allow 80/tcp 2>/dev/null || true
sudo ufw allow 443/tcp 2>/dev/null || true
sudo ufw reload 2>/dev/null || true
echo "✅ Ports 80 et 443 ouverts"

echo ""
echo "✅ Configuration complète!"
echo ""
echo "🌐 Votre site devrait être accessible sur:"
echo "   http://$DUCKDNS_FULL_DOMAIN"
echo ""
echo "📋 Prochaines étapes (optionnel):"
echo "   1. Configurer SSL avec Let's Encrypt:"
echo "      sudo apt-get install -y certbot python3-certbot-nginx"
echo "      sudo certbot --nginx -d $DUCKDNS_FULL_DOMAIN"
echo ""
echo "   2. Vérifier les logs:"
echo "      tail -f ~/duckdns.log"
echo "      sudo tail -f /var/log/nginx/videoflow-access.log"
echo ""
