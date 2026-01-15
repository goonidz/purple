-- Add metadata column to gpu_render_jobs for storing render info

ALTER TABLE public.gpu_render_jobs
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add comment
COMMENT ON COLUMN public.gpu_render_jobs.metadata IS 'Render metadata (duration, fileSizeMB, resolution, etc.)';
