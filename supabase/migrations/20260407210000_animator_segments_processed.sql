DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'animator_segments_processed'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN animator_segments_processed jsonb;
  END IF;
END $$;
