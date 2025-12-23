#!/bin/bash

# Script pour configurer le nettoyage automatique des images Supabase sur le serveur VPS
# À exécuter une fois sur le serveur après le déploiement

set -e

echo "🧹 Configuration du nettoyage automatique des images Supabase..."

# Vérifier que nous sommes dans le bon répertoire
if [ ! -f "scripts/cleanup-supabase-images.js" ]; then
  echo "❌ Erreur: Ce script doit être exécuté depuis la racine du projet"
  exit 1
fi

# Vérifier que SUPABASE_SERVICE_ROLE_KEY est dans .env.production
if [ ! -f ".env.production" ]; then
  echo "⚠️  .env.production n'existe pas, création..."
  touch .env.production
fi

if ! grep -q "SUPABASE_SERVICE_ROLE_KEY" .env.production; then
  echo "⚠️  SUPABASE_SERVICE_ROLE_KEY non trouvée dans .env.production"
  echo ""
  echo "📝 Ajoute-la manuellement:"
  echo "   1. Récupère la clé depuis: https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api"
  echo "   2. Ajoute dans .env.production:"
  echo "      SUPABASE_SERVICE_ROLE_KEY=ta_clé_ici"
  echo ""
  read -p "Appuie sur Entrée quand c'est fait..."
fi

# Rendre le script exécutable
chmod +x scripts/cleanup-supabase-images.js

# Obtenir le chemin absolu du projet
PROJECT_DIR=$(pwd)
CLEANUP_SCRIPT="$PROJECT_DIR/scripts/cleanup-supabase-images.js"
LOG_FILE="$PROJECT_DIR/cleanup-images.log"

echo ""
echo "📋 Configuration du cron job..."
echo "   Script: $CLEANUP_SCRIPT"
echo "   Log: $LOG_FILE"
echo "   Schedule: Tous les jours à 2h du matin UTC"
echo ""

# Vérifier si le cron job existe déjà
CRON_CMD="0 2 * * * cd $PROJECT_DIR && node $CLEANUP_SCRIPT >> $LOG_FILE 2>&1"

if crontab -l 2>/dev/null | grep -q "cleanup-supabase-images.js"; then
  echo "⚠️  Un cron job existe déjà pour le nettoyage"
  echo "   Pour le modifier manuellement: crontab -e"
else
  # Ajouter le cron job
  (crontab -l 2>/dev/null; echo ""; echo "# Nettoyage automatique des images Supabase (plus de 7 jours)"; echo "$CRON_CMD") | crontab -
  echo "✅ Cron job ajouté avec succès!"
fi

echo ""
echo "📝 Pour vérifier le cron job:"
echo "   crontab -l"
echo ""
echo "📝 Pour voir les logs:"
echo "   tail -f $LOG_FILE"
echo ""
echo "📝 Pour tester manuellement:"
echo "   cd $PROJECT_DIR && node scripts/cleanup-supabase-images.js"
echo ""
echo "✅ Configuration terminée!"
