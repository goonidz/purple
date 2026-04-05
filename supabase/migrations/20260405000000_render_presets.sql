-- Migration: Create render_presets table and link to projects/channels

CREATE TABLE IF NOT EXISTS render_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  framerate INTEGER NOT NULL DEFAULT 25,
  effect_type TEXT NOT NULL DEFAULT 'opencv_zoom',
  use_gpu BOOLEAN NOT NULL DEFAULT true,
  blackscreen_url TEXT,
  blackscreen_opacity REAL NOT NULL DEFAULT 0.45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE render_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own render presets"
  ON render_presets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS render_preset_id UUID REFERENCES render_presets(id) ON DELETE SET NULL;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS render_preset_id UUID REFERENCES render_presets(id) ON DELETE SET NULL;

COMMENT ON TABLE render_presets IS 'Video render presets (fps, effect, GPU, blackscreen overlay)';
COMMENT ON COLUMN channels.render_preset_id IS 'Default render preset for this channel';
