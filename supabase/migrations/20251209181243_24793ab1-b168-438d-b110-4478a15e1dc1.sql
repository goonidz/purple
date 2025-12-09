-- Add thumbnail_preset_id column to projects table
ALTER TABLE public.projects 
ADD COLUMN thumbnail_preset_id uuid REFERENCES public.thumbnail_presets(id) ON DELETE SET NULL;