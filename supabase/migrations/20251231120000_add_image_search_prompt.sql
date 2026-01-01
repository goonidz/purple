-- Add image_search_prompt_system column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS image_search_prompt_system TEXT;

COMMENT ON COLUMN public.projects.image_search_prompt_system IS 'Custom system prompt for generating image search queries via Brave Search';
