-- Add prompt_system_message column to presets table
ALTER TABLE public.presets 
ADD COLUMN prompt_system_message text DEFAULT NULL;