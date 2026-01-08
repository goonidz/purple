#!/usr/bin/env node

import pg from 'pg';
const { Pool } = pg;

console.log('🔍 Connexion à la base de données Supabase...\n');

const pool = new Pool({
  connectionString: 'postgresql://postgres.laqgmqyjstisipsbljha:bwzZSFoqMDrqhR71@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('✅ Connecté à Supabase PostgreSQL\n');
    
    // Vérifier les colonnes existantes
    console.log('🔍 Vérification des colonnes existantes...');
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns
      WHERE table_name = 'channels' 
        AND column_name IN ('script_preset_id', 'tts_preset_id', 'project_preset_id', 'thumbnail_preset_id', 'thumbnail_preset_enabled')
      ORDER BY column_name;
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('✅ Colonnes déjà existantes:', checkResult.rows.map(r => r.column_name).join(', '));
      console.log('\n✨ Migration déjà appliquée !');
      return;
    }
    
    console.log('⚠️  Colonnes non trouvées, application de la migration...\n');
    
    // Appliquer la migration
    const migrationSQL = `
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;
`;
    
    await client.query(migrationSQL);
    console.log('✅ Colonnes ajoutées avec succès!\n');
    
    // Ajouter les commentaires
    console.log('📝 Ajout des commentaires...');
    await client.query(`
      COMMENT ON COLUMN channels.script_preset_id IS 'Default script generation preset for this channel';
      COMMENT ON COLUMN channels.tts_preset_id IS 'Default TTS voice preset for this channel';
      COMMENT ON COLUMN channels.project_preset_id IS 'Default project configuration preset (scenes, prompts, image model, LoRA) for this channel';
      COMMENT ON COLUMN channels.thumbnail_preset_id IS 'Default thumbnail generation preset for this channel';
      COMMENT ON COLUMN channels.thumbnail_preset_enabled IS 'Whether to automatically use the thumbnail preset for this channel';
    `);
    console.log('✅ Commentaires ajoutés!\n');
    
    // Vérification finale
    const finalCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns
      WHERE table_name = 'channels' 
        AND column_name IN ('script_preset_id', 'tts_preset_id', 'project_preset_id', 'thumbnail_preset_id', 'thumbnail_preset_enabled')
      ORDER BY column_name;
    `);
    
    console.log('✅ Vérification finale - colonnes créées:', finalCheck.rows.map(r => r.column_name).join(', '));
    console.log('\n🎉 Migration terminée avec succès!');
    console.log('Vous pouvez maintenant enregistrer vos presets par chaîne dans l\'interface.\n');
    
  } catch (error) {
    console.error('\n❌ Erreur lors de la migration:');
    console.error('Message:', error.message);
    if (error.detail) console.error('Détail:', error.detail);
    if (error.hint) console.error('Astuce:', error.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration().catch((error) => {
  console.error('\n❌ Erreur fatale:', error.message);
  process.exit(1);
});
