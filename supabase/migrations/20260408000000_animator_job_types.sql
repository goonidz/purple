-- Add animator job types to generation_jobs for job-based scene generation
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'animator_scenes';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'animator_scene';
