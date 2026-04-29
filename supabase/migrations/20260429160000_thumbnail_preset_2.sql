-- A/B test for thumbnail generation: optional second preset.
-- Splits the 5 generated thumbnails between preset 1 (existing) and an
-- optional preset 2, with auto-load mirroring the preset 1 chain
-- (projects.thumbnail_preset_id_2 → channels.thumbnail_preset_id_2 via
-- content_calendar). NULL = A/B disabled (current behaviour, default).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id_2 uuid
  REFERENCES thumbnail_presets(id) ON DELETE SET NULL;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id_2 uuid
  REFERENCES thumbnail_presets(id) ON DELETE SET NULL;

COMMENT ON COLUMN projects.thumbnail_preset_id_2 IS
  'Optional second thumbnail preset for A/B-style generation. Inherits from channels.thumbnail_preset_id_2 at project creation.';
COMMENT ON COLUMN channels.thumbnail_preset_id_2 IS
  'Optional second thumbnail preset that propagates to new projects on this channel for A/B generation.';
