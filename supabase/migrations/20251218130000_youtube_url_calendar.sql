-- Add youtube_url column to content_calendar
ALTER TABLE public.content_calendar 
ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT NULL;
