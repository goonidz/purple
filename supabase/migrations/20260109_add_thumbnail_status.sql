-- Add 'thumbnail' status to content_calendar table
-- This status comes after 'generating' and before 'completed'

-- Drop the existing constraint
ALTER TABLE public.content_calendar DROP CONSTRAINT IF EXISTS content_calendar_status_check;

-- Add the new constraint with 'thumbnail' status
ALTER TABLE public.content_calendar 
ADD CONSTRAINT content_calendar_status_check 
CHECK (status IN ('planned', 'scripted', 'audio_ready', 'generating', 'thumbnail', 'completed'));
