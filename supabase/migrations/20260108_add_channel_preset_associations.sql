-- Migration: Add preset associations to channels table
-- This enables each channel to have default presets for automatic selection

-- Add preset reference columns to channels table
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;

-- Add comments for documentation
COMMENT ON COLUMN channels.script_preset_id IS 'Default script generation preset for this channel';
COMMENT ON COLUMN channels.tts_preset_id IS 'Default TTS voice preset for this channel';
COMMENT ON COLUMN channels.project_preset_id IS 'Default project configuration preset (scenes, prompts, image model, LoRA) for this channel';
COMMENT ON COLUMN channels.thumbnail_preset_id IS 'Default thumbnail generation preset for this channel';
COMMENT ON COLUMN channels.thumbnail_preset_enabled IS 'Whether to automatically use the thumbnail preset for this channel';
