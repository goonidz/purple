-- Add source_url column to content_calendar for scraping YouTube videos
ALTER TABLE public.content_calendar 
ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT NULL;


