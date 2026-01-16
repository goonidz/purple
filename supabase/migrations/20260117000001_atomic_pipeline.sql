-- Migration for atomic pipeline architecture
-- Each scene flows: single_image -> single_qa -> single_upscale

-- Add is_regen column to track regenerated images (max 1 regen per scene)
ALTER TABLE public.generation_jobs
ADD COLUMN IF NOT EXISTS is_regen BOOLEAN DEFAULT false;

-- Add single_upscale to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'single_upscale';

-- Comment for documentation
COMMENT ON COLUMN public.generation_jobs.is_regen IS 'True if this job is a regeneration after QA rejection (max 1 per scene)';
