-- Add duration_ranges JSONB column to projects table
ALTER TABLE public.projects 
ADD COLUMN duration_ranges jsonb DEFAULT '[{"endSeconds": 60, "sceneDuration": 4}, {"endSeconds": 180, "sceneDuration": 6}, {"endSeconds": null, "sceneDuration": 8}]'::jsonb;

-- Add duration_ranges JSONB column to presets table
ALTER TABLE public.presets 
ADD COLUMN duration_ranges jsonb DEFAULT '[{"endSeconds": 60, "sceneDuration": 4}, {"endSeconds": 180, "sceneDuration": 6}, {"endSeconds": null, "sceneDuration": 8}]'::jsonb;