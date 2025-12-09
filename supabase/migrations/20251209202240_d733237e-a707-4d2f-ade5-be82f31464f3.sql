-- Add new job types for the script-to-video workflow
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'script_generation';
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'audio_generation';
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'full_video';