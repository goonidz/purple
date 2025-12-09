-- Add new job types for single prompt and image regeneration
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'single_prompt';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'single_image';