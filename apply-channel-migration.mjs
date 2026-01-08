import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://laqgmqyjstisipsbljha.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMTAwNjIxNiwiZXhwIjoyMDQ2NTgyMjE2fQ.5VhxJFt4TZPxJqj3YfVMZq0iL-jB2TA-ZGOCMPNfYBE';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  console.log('🔍 Vérification des colonnes existantes...');
  
  // Vérifier si les colonnes existent
  const { data: checkData, error: checkError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT column_name 
      FROM information_schema.columns
      WHERE table_name = 'channels' 
        AND column_name IN ('script_preset_id', 'tts_preset_id', 'project_preset_id', 'thumbnail_preset_id', 'thumbnail_preset_enabled');
    `
  });

  if (checkError) {
    console.log('⚠️  Fonction RPC non disponible, essai direct...');
  } else {
    console.log('Colonnes existantes:', checkData);
  }

  console.log('\n🚀 Application de la migration...');
  
  const migrationSQL = `
-- Add preset reference columns to channels table
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;

-- Add comments for documentation
COMMENT ON COLUMN channels.script_preset_id IS 'Default script generation preset for this channel';
COMMENT ON COLUMN channels.tts_preset_id IS 'Default TTS voice preset for this channel';
COMMENT ON COLUMN channels.project_preset_id IS 'Default project configuration preset (scenes, prompts, image model, LoRA) for this channel';
COMMENT ON COLUMN channels.thumbnail_preset_id IS 'Default thumbnail generation preset for this channel';
COMMENT ON COLUMN channels.thumbnail_preset_enabled IS 'Whether to automatically use the thumbnail preset for this channel';
  `;

  // Essayer d'exécuter via une edge function
  const { data, error } = await supabase.functions.invoke('exec-sql', {
    body: { sql: migrationSQL }
  });

  if (error) {
    console.log('❌ Erreur via edge function:', error.message);
    console.log('\n📝 Migration SQL à exécuter manuellement:');
    console.log(migrationSQL);
  } else {
    console.log('✅ Migration appliquée avec succès !');
    console.log('Résultat:', data);
  }
}

applyMigration().catch(console.error);
