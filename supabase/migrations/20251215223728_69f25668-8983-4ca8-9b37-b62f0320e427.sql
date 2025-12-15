-- Add range boundary columns to presets table
ALTER TABLE public.presets 
ADD COLUMN IF NOT EXISTS range_end_1 integer DEFAULT 60,
ADD COLUMN IF NOT EXISTS range_end_2 integer DEFAULT 180;

-- Add range boundary columns to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS range_end_1 integer DEFAULT 60,
ADD COLUMN IF NOT EXISTS range_end_2 integer DEFAULT 180;