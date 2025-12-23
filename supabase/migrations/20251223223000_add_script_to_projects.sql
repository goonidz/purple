-- Add script column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS script TEXT;

-- Add comment
COMMENT ON COLUMN public.projects.script IS 'Generated script for the video project';
