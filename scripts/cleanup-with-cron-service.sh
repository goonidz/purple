#!/bin/bash

# Script pour configurer automatiquement le nettoyage avec un service externe
# Utilise l'API de cron-job.org (gratuit) ou un autre service

SERVICE_ROLE_KEY="${1:-}"
SUPABASE_URL="https://laqgmqyjstisipsbljha.supabase.co"

if [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "❌ Erreur: Clé service role requise"
  echo ""
  echo "Usage: $0 [SERVICE_ROLE_KEY]"
  echo ""
  echo "Pour obtenir la clé:"
  echo "  1. Va sur: https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api"
  echo "  2. Copie la clé 'service_role' (celle qui est secrète)"
  echo ""
  echo "Ensuite, configure manuellement sur cron-job.org:"
  echo "  - URL: ${SUPABASE_URL}/functions/v1/cleanup-old-images"
  echo "  - Method: POST"
  echo "  - Headers: Authorization: Bearer [TA_CLÉ]"
  echo "  - Schedule: Daily à 02:00 UTC"
  exit 1
fi

echo "✅ Configuration pour cron-job.org:"
echo ""
echo "1. Va sur: https://cron-job.org"
echo "2. Crée un compte gratuit"
echo "3. Crée un nouveau cron job avec:"
echo ""
echo "   Title: Cleanup Old Images VideoFlow"
echo "   Address: ${SUPABASE_URL}/functions/v1/cleanup-old-images"
echo "   Method: POST"
echo "   Headers:"
echo "     Content-Type: application/json"
echo "     Authorization: Bearer ${SERVICE_ROLE_KEY}"
echo "   Schedule: Daily à 02:00 UTC"
echo ""
echo "✅ C'est tout ! Le nettoyage s'exécutera automatiquement."
