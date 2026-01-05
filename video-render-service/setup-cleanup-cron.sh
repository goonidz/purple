#!/bin/bash

# Script pour configurer le nettoyage automatique des fichiers de rendu sur le serveur VPS
# Nettoie les dossiers de jobs de plus de 4 jours (images, audio, segments, rendu final)
# À exécuter une fois sur le serveur après le déploiement

set -e

echo "🧹 Configuration du nettoyage automatique des fichiers de rendu..."

# Vérifier que nous sommes dans le bon répertoire
if [ ! -f "cleanup.js" ]; then
  echo "❌ Erreur: Ce script doit être exécuté depuis video-render-service/"
  exit 1
fi

# Rendre le script exécutable
chmod +x cleanup.js

# Obtenir le chemin absolu du projet
PROJECT_DIR=$(pwd)
CLEANUP_SCRIPT="$PROJECT_DIR/cleanup.js"
LOG_FILE="$PROJECT_DIR/cleanup.log"

echo ""
echo "📋 Configuration du cron job..."
echo "   Script: $CLEANUP_SCRIPT"
echo "   Log: $LOG_FILE"
echo "   Schedule: Tous les jours à 2h du matin UTC"
echo "   Nettoie: Dossiers de jobs de plus de 4 jours"
echo ""

# Vérifier si le cron job existe déjà
CRON_CMD="0 2 * * * cd $PROJECT_DIR && node $CLEANUP_SCRIPT >> $LOG_FILE 2>&1"

if crontab -l 2>/dev/null | grep -q "cleanup.js"; then
  echo "⚠️  Un cron job existe déjà pour le nettoyage"
  echo "   Pour le modifier manuellement: crontab -e"
  echo ""
  echo "   Cron actuel:"
  crontab -l 2>/dev/null | grep "cleanup.js"
else
  # Ajouter le cron job
  (crontab -l 2>/dev/null; echo ""; echo "# Nettoyage automatique des fichiers de rendu (plus de 4 jours)"; echo "$CRON_CMD") | crontab -
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
echo "   cd $PROJECT_DIR && node cleanup.js"
echo ""
echo "✅ Configuration terminée!"
