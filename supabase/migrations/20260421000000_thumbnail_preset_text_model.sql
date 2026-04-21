-- Add text_model column to thumbnail_presets so users can persist
-- which LLM generates the thumbnail prompts (Claude Sonnet 4.6 / Gemini 3 Flash).
ALTER TABLE thumbnail_presets
  ADD COLUMN IF NOT EXISTS text_model text DEFAULT 'claude-sonnet-4-6';
