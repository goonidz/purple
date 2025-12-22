-- Add source_thumbnail_url column to content_calendar for storing YouTube thumbnail URLs
ALTER TABLE public.content_calendar 
ADD COLUMN IF NOT EXISTS source_thumbnail_url TEXT DEFAULT NULL;




