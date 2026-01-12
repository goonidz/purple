#!/bin/bash

# VPS Configuration Backup (avant reset)
# Sauvegarde les infos importantes du VPS avant réinstallation

VPS_IP="51.91.158.233"
BACKUP_DIR="$HOME/vps-backup-$(date +%Y%m%d-%H%M%S)"

echo "🔍 Récupération des configurations du VPS..."
echo "📁 Dossier de sauvegarde : $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# DuckDNS
echo "📡 Récupération config DuckDNS..."
ssh ubuntu@$VPS_IP 'cat ~/.duckdns' > "$BACKUP_DIR/duckdns-config.txt" 2>/dev/null || echo "❌ Impossible de récupérer .duckdns"

# Webhook
echo "🔗 Récupération config Webhook..."
ssh ubuntu@$VPS_IP 'cat ~/purple/.env.webhook' > "$BACKUP_DIR/webhook-env.txt" 2>/dev/null || echo "❌ Impossible de récupérer .env.webhook"

# PM2 services
echo "⚙️  Liste des services PM2..."
ssh ubuntu@$VPS_IP 'pm2 list' > "$BACKUP_DIR/pm2-services.txt" 2>/dev/null || echo "❌ Impossible de lister PM2"

# Git remotes
echo "📦 Informations Git..."
ssh ubuntu@$VPS_IP 'cd ~/purple && git remote -v' > "$BACKUP_DIR/git-remotes.txt" 2>/dev/null || echo "❌ Impossible de récupérer git remotes"

# Résumé
echo ""
echo "✅ Sauvegarde terminée dans : $BACKUP_DIR"
echo ""
echo "📋 Récapitulatif :"
echo "─────────────────────────────────────────────────"

if [ -f "$BACKUP_DIR/duckdns-config.txt" ]; then
    echo "🌐 DuckDNS :"
    cat "$BACKUP_DIR/duckdns-config.txt"
else
    echo "⚠️  Token DuckDNS : Récupère-le sur https://www.duckdns.org"
fi

echo ""
echo "📌 Informations importantes :"
echo "  - IP VPS : $VPS_IP"
echo "  - Domaine : purpleai.duckdns.org"
echo "  - Projet Supabase : laqgmqyjstisipsbljha"

if [ -f "$BACKUP_DIR/git-remotes.txt" ]; then
    echo ""
    echo "📦 Repository Git :"
    cat "$BACKUP_DIR/git-remotes.txt"
fi

echo ""
echo "─────────────────────────────────────────────────"
echo "✅ Tu peux maintenant réinstaller le VPS !"
echo "📖 Guide : docs/VPS_RESET_MIGRATION.md"
