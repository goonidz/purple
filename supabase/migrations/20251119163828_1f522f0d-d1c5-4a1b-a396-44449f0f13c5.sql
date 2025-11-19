-- Replace example_prompt (TEXT) with example_prompts (JSONB array)
ALTER TABLE projects 
DROP COLUMN IF EXISTS example_prompt;

ALTER TABLE projects 
ADD COLUMN example_prompts JSONB DEFAULT '[]'::jsonb;