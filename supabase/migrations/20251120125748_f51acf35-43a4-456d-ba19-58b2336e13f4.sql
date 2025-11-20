-- Ajouter les colonnes pour les presets de miniatures
ALTER TABLE public.presets
ADD COLUMN IF NOT EXISTS thumbnail_example_urls jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS thumbnail_character_ref_url text;