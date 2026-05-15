-- Thumbnail preset pairing for A/B auto-load.
-- Lets a thumbnail preset declare its preferred "partner" preset (preset B) and
-- a default count of variations from that partner. When the preset auto-loads
-- in the thumbnail generator (from project or channel), the partner is also
-- auto-applied — but only if the project/channel has NOT explicitly set its
-- own preset 2 (explicit assignment still wins).

ALTER TABLE thumbnail_presets
  ADD COLUMN IF NOT EXISTS pair_preset_id uuid
  REFERENCES thumbnail_presets(id) ON DELETE SET NULL;

ALTER TABLE thumbnail_presets
  ADD COLUMN IF NOT EXISTS pair_preset_count integer NOT NULL DEFAULT 2
  CHECK (pair_preset_count >= 0 AND pair_preset_count <= 5);

COMMENT ON COLUMN thumbnail_presets.pair_preset_id IS
  'Optional sibling preset used as the B side of an A/B thumbnail test. Auto-applied in the generator when no explicit project/channel preset 2 is set.';
COMMENT ON COLUMN thumbnail_presets.pair_preset_count IS
  'Default number of variations (0-5) to generate from pair_preset_id when the pair auto-loads. Ignored when pair_preset_id is NULL.';
