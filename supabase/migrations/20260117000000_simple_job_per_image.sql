-- Simple architecture: 1 job per image
-- This migration adds fields to generation_jobs to support individual image jobs

-- Add new columns to generation_jobs
ALTER TABLE public.generation_jobs
ADD COLUMN IF NOT EXISTS scene_index INTEGER,
ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES public.generation_jobs(id) ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_generation_jobs_parent_id 
ON public.generation_jobs(parent_job_id) 
WHERE parent_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_scene_index 
ON public.generation_jobs(project_id, scene_index) 
WHERE scene_index IS NOT NULL;

-- Index for counting processing jobs globally
CREATE INDEX IF NOT EXISTS idx_generation_jobs_processing_count 
ON public.generation_jobs(status, created_at) 
WHERE status IN ('processing', 'pending');

-- Comments
COMMENT ON COLUMN public.generation_jobs.scene_index IS 'Scene index for single image jobs (0-based)';
COMMENT ON COLUMN public.generation_jobs.parent_job_id IS 'Parent job ID for grouped operations (e.g., all 22 image jobs share same parent)';
