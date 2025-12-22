-- Migration: Support multiple folders per channel (many-to-many)

-- Table de liaison many-to-many
CREATE TABLE competitor_channel_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES competitor_channels(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES competitor_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel_id, folder_id)
);

-- Migrer les données existantes
INSERT INTO competitor_channel_folders (channel_id, folder_id)
SELECT id, folder_id
FROM competitor_channels
WHERE folder_id IS NOT NULL;

-- Index pour performances
CREATE INDEX idx_channel_folders_channel ON competitor_channel_folders(channel_id);
CREATE INDEX idx_channel_folders_folder ON competitor_channel_folders(folder_id);

-- RLS
ALTER TABLE competitor_channel_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view channel folders" ON competitor_channel_folders
  FOR SELECT USING (
    channel_id IN (SELECT id FROM competitor_channels WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can manage channel folders" ON competitor_channel_folders
  FOR ALL USING (
    channel_id IN (SELECT id FROM competitor_channels WHERE user_id = auth.uid())
  );

-- Supprimer l'ancienne colonne folder_id (on garde pour l'instant pour compatibilité, on la supprimera plus tard)
-- ALTER TABLE competitor_channels DROP COLUMN folder_id;
