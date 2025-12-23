#!/bin/bash

# Script pour ajouter automatiquement SUPABASE_SERVICE_ROLE_KEY dans .env.production
# À exécuter sur le serveur VPS

SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTg4MjA2MSwiZXhwIjoyMDgxNDU4MDYxfQ.8WIZ3w_ouqXivqQms7sqjnxnTdA06hcwym966LYeh4w"

ENV_FILE=".env.production"

echo "🔑 Ajout de SUPABASE_SERVICE_ROLE_KEY dans $ENV_FILE..."

# Créer le fichier s'il n'existe pas
if [ ! -f "$ENV_FILE" ]; then
  touch "$ENV_FILE"
  echo "✅ Fichier $ENV_FILE créé"
fi

# Vérifier si la clé existe déjà
if grep -q "SUPABASE_SERVICE_ROLE_KEY" "$ENV_FILE"; then
  echo "⚠️  SUPABASE_SERVICE_ROLE_KEY existe déjà dans $ENV_FILE"
  echo "   Mise à jour de la valeur..."
  # Supprimer l'ancienne ligne
  sed -i '/^SUPABASE_SERVICE_ROLE_KEY=/d' "$ENV_FILE"
fi

# Ajouter la nouvelle clé
echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY" >> "$ENV_FILE"
echo "✅ Clé ajoutée avec succès dans $ENV_FILE"

echo ""
echo "📝 Pour vérifier:"
echo "   grep SUPABASE_SERVICE_ROLE_KEY $ENV_FILE"
