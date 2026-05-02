-- Adds optional audience_description field to channels so users can describe
-- the target audience for each channel (used as context for future LLM tasks).
ALTER TABLE public.channels
ADD COLUMN IF NOT EXISTS audience_description text;

COMMENT ON COLUMN public.channels.audience_description IS 'Optional free-text description of the channel target audience.';
