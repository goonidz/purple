-- Add branding_markdown text column to animator_presets
ALTER TABLE public.animator_presets ADD COLUMN IF NOT EXISTS branding_markdown text DEFAULT '';
