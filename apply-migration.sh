#!/bin/bash
set -e

# Supabase configuration
PROJECT_REF="laqgmqyjstisipsbljha"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMTAwNjIxNiwiZXhwIjoyMDQ2NTgyMjE2fQ.5VhxJFt4TZPxJqj3YfVMZq0iL-jB2TA-ZGOCMPNfYBE"

echo "🔍 Vérification de l'état de la table channels..."

# Vérifier les colonnes existantes
curl -s "${SUPABASE_URL}/rest/v1/rpc/exec" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT column_name FROM information_schema.columns WHERE table_name = '\''channels'\'' AND column_name IN ('\''script_preset_id'\'', '\''tts_preset_id'\'', '\''project_preset_id'\'', '\''thumbnail_preset_id'\'', '\''thumbnail_preset_enabled'\'')"
  }' 2>&1 | head -20

echo -e "\n\n🚀 Application de la migration SQL directement..."

# Appliquer la migration via psql avec l'URL de connexion directe
PGPASSWORD="bwzZSFoqMDrqhR71" psql \
  "postgresql://postgres.laqgmqyjstisipsbljha:bwzZSFoqMDrqhR71@aws-0-eu-west-3.pooler.supabase.com:6543/postgres" \
  -c "
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;

COMMENT ON COLUMN channels.script_preset_id IS 'Default script generation preset for this channel';
COMMENT ON COLUMN channels.tts_preset_id IS 'Default TTS voice preset for this channel';
COMMENT ON COLUMN channels.project_preset_id IS 'Default project configuration preset (scenes, prompts, image model, LoRA) for this channel';
COMMENT ON COLUMN channels.thumbnail_preset_id IS 'Default thumbnail generation preset for this channel';
COMMENT ON COLUMN channels.thumbnail_preset_enabled IS 'Whether to automatically use the thumbnail preset for this channel';
"

if [ $? -eq 0 ]; then
  echo "✅ Migration appliquée avec succès !"
else
  echo "❌ Erreur lors de l'application de la migration"
  exit 1
fi
