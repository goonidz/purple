-- Add current_step to generation_jobs for real-time progress feedback in the UI

ALTER TABLE public.generation_jobs
ADD COLUMN IF NOT EXISTS current_step TEXT;
