-- Adds optional youtube_url field to channels so users can link each channel to its YouTube URL.
ALTER TABLE public.channels
ADD COLUMN IF NOT EXISTS youtube_url text;

COMMENT ON COLUMN public.channels.youtube_url IS 'Optional URL of the corresponding YouTube channel (set in the channel manager UI).';
