-- Créer une fonction pour exécuter du SQL (à usage unique pour la migration)
CREATE OR REPLACE FUNCTION exec_migration_sql()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Ajouter les colonnes de preset à la table channels
  ALTER TABLE channels 
    ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;

  -- Ajouter les commentaires
  EXECUTE 'COMMENT ON COLUMN channels.script_preset_id IS ''Default script generation preset for this channel''';
  EXECUTE 'COMMENT ON COLUMN channels.tts_preset_id IS ''Default TTS voice preset for this channel''';
  EXECUTE 'COMMENT ON COLUMN channels.project_preset_id IS ''Default project configuration preset (scenes, prompts, image model, LoRA) for this channel''';
  EXECUTE 'COMMENT ON COLUMN channels.thumbnail_preset_id IS ''Default thumbnail generation preset for this channel''';
  EXECUTE 'COMMENT ON COLUMN channels.thumbnail_preset_enabled IS ''Whether to automatically use the thumbnail preset for this channel''';

  RETURN 'Migration applied successfully!';
END;
$$;
