DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'animator_presets' AND column_name = 'min_segment_duration'
  ) THEN
    ALTER TABLE public.animator_presets
      ADD COLUMN min_segment_duration numeric NOT NULL DEFAULT 0;
  END IF;
END $$;
