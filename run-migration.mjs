#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://laqgmqyjstisipsbljha.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMTAwNjIxNiwiZXhwIjoyMDQ2NTgyMjE2fQ.5VhxJFt4TZPxJqj3YfVMZq0iL-jB2TA-ZGOCMPNfYBE';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  console.log('🔍 Vérification de la structure actuelle de la table channels...\n');
  
  try {
    // Vérifier la structure actuelle
    const { data: existingChannels, error: fetchError } = await supabase
      .from('channels')
      .select('*')
      .limit(1);
    
    if (fetchError) {
      console.error('❌ Erreur lors de la lecture de la table channels:', fetchError.message);
      process.exit(1);
    }
    
    if (existingChannels && existingChannels.length > 0) {
      const firstChannel = existingChannels[0];
      console.log('Structure actuelle (première chaîne):', Object.keys(firstChannel));
      
      if (firstChannel.hasOwnProperty('project_preset_id')) {
        console.log('\n✅ Les colonnes de preset existent déjà !');
        console.log('Migration déjà appliquée.');
        process.exit(0);
      }
    }
    
    console.log('\n⚠️  Les colonnes de preset n\'existent pas encore.');
    console.log('🚀 Application de la migration SQL...\n');
    
    // Exécuter la migration
    const migrationSQL = `
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;
`;
    
    // Utiliser le client Postgres directement
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: 'postgresql://postgres.laqgmqyjstisipsbljha:bwzZSFoqMDrqhR71@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
      ssl: { rejectUnauthorized: false }
    });
    
    const client = await pool.connect();
    
    try {
      await client.query(migrationSQL);
      console.log('✅ Migration SQL appliquée avec succès !\n');
      
      // Ajouter les commentaires
      await client.query(`
        COMMENT ON COLUMN channels.script_preset_id IS 'Default script generation preset for this channel';
        COMMENT ON COLUMN channels.tts_preset_id IS 'Default TTS voice preset for this channel';
        COMMENT ON COLUMN channels.project_preset_id IS 'Default project configuration preset (scenes, prompts, image model, LoRA) for this channel';
        COMMENT ON COLUMN channels.thumbnail_preset_id IS 'Default thumbnail generation preset for this channel';
        COMMENT ON COLUMN channels.thumbnail_preset_enabled IS 'Whether to automatically use the thumbnail preset for this channel';
      `);
      
      console.log('✅ Commentaires ajoutés !\n');
      
      // Vérifier que ça a marché
      const { data: updatedChannels } = await supabase
        .from('channels')
        .select('*')
        .limit(1);
      
      if (updatedChannels && updatedChannels.length > 0) {
        console.log('✅ Vérification : nouvelle structure de channels:', Object.keys(updatedChannels[0]));
      }
      
      console.log('\n🎉 Migration terminée avec succès !');
      console.log('Vous pouvez maintenant enregistrer vos presets par chaîne.');
      
    } finally {
      client.release();
      await pool.end();
    }
    
  } catch (error) {
    console.error('\n❌ Erreur lors de l\'exécution de la migration:');
    console.error(error.message);
    if (error.detail) console.error('Détail:', error.detail);
    if (error.hint) console.error('Astuce:', error.hint);
    process.exit(1);
  }
}

runMigration();
