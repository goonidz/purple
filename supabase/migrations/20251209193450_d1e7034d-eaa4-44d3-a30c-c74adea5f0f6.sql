-- Add image_model column to thumbnail_presets table
ALTER TABLE public.thumbnail_presets 
ADD COLUMN image_model TEXT DEFAULT 'seedream-4.5';