-- Add lora_url and lora_steps columns to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS lora_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS lora_steps INTEGER DEFAULT 10;

-- Add lora_url and lora_steps columns to presets table
ALTER TABLE public.presets 
ADD COLUMN IF NOT EXISTS lora_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS lora_steps INTEGER DEFAULT 10;