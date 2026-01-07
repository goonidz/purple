-- Add source_transcript column to content_calendar for storing YouTube video transcripts
ALTER TABLE public.content_calendar 
ADD COLUMN IF NOT EXISTS source_transcript TEXT DEFAULT NULL;
