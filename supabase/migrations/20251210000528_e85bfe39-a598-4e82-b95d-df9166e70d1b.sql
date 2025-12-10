-- Add export_base_path column to user_api_keys table
ALTER TABLE public.user_api_keys 
ADD COLUMN IF NOT EXISTS export_base_path text;