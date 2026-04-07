DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'animator_tokens'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN animator_tokens jsonb DEFAULT null;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'animator_cost_usd'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN animator_cost_usd numeric DEFAULT null;
  END IF;
END $$;
