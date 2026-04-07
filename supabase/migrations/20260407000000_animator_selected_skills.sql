-- Add selected_skills column to animator_presets
-- Stores an array of skill filenames the user wants sent to Claude
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'animator_presets' AND column_name = 'selected_skills'
  ) THEN
    ALTER TABLE public.animator_presets
      ADD COLUMN selected_skills jsonb NOT NULL DEFAULT '["animations.md","timing.md","sequencing.md","charts.md","text-animations.md"]'::jsonb;
  END IF;
END $$;
