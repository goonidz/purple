-- Per-scene animator code storage for individual scene generation/retry
ALTER TABLE public.project_scenes
  ADD COLUMN IF NOT EXISTS animator_code TEXT,
  ADD COLUMN IF NOT EXISTS animator_code_status TEXT DEFAULT NULL;
-- animator_code_status: null | 'pending' | 'generating' | 'completed' | 'failed'
