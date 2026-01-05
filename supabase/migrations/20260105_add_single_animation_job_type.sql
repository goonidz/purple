-- Add 'single_animation' to the job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'single_animation';
