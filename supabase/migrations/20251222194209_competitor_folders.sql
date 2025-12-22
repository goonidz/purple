-- Migration: Add folders system for competitor channels

-- Table des dossiers
CREATE TABLE competitor_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6', -- Couleur par défaut (bleu)
  position INTEGER DEFAULT 0,    -- Ordre d'affichage
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

-- Ajouter folder_id à competitor_channels
ALTER TABLE competitor_channels 
  ADD COLUMN folder_id UUID REFERENCES competitor_folders(id) ON DELETE SET NULL;

-- Index pour performances
CREATE INDEX idx_competitor_folders_user ON competitor_folders(user_id);
CREATE INDEX idx_competitor_channels_folder ON competitor_channels(folder_id);

-- RLS pour competitor_folders
ALTER TABLE competitor_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their folders" ON competitor_folders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their folders" ON competitor_folders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their folders" ON competitor_folders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their folders" ON competitor_folders
  FOR DELETE USING (auth.uid() = user_id);
