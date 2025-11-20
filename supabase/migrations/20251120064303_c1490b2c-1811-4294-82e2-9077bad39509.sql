-- Add image dimension columns to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS image_width INTEGER DEFAULT 1920,
ADD COLUMN IF NOT EXISTS image_height INTEGER DEFAULT 1080,
ADD COLUMN IF NOT EXISTS aspect_ratio TEXT DEFAULT '16:9';