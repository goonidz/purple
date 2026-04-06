-- Animator Workflow: tables + columns for Remotion Animator integration

-- 1. animator_presets — per-channel animator configuration
CREATE TABLE IF NOT EXISTS public.animator_presets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  channel_id uuid REFERENCES public.channels(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',
  enabled boolean NOT NULL DEFAULT false,
  branding_config jsonb NOT NULL DEFAULT '{
    "palette": {
      "bg": "#111118",
      "accent": "#ef4444",
      "accentDim": "rgba(239,68,68,0.25)",
      "text": "#f0f0f0",
      "textDim": "rgba(240,240,240,0.35)"
    },
    "typography": {
      "fontFamily": "system-ui, sans-serif",
      "heroSize": 150,
      "titleSize": 56,
      "subtitleSize": 32,
      "labelSize": 21
    },
    "animation": {
      "fadeRatio": 0.12,
      "staggerFrames": 8,
      "premountFrames": 15
    }
  }'::jsonb,
  extra_prompt text DEFAULT '',
  model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  chunk_size integer NOT NULL DEFAULT 25,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.animator_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own animator_presets"
  ON public.animator_presets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own animator_presets"
  ON public.animator_presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own animator_presets"
  ON public.animator_presets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own animator_presets"
  ON public.animator_presets FOR DELETE
  USING (auth.uid() = user_id);

-- 2. remotion_render_jobs — tracking Remotion renders
CREATE TABLE IF NOT EXISTS public.remotion_render_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','rendering','completed','failed','cancelled')),
  composition_id text,
  input_props jsonb DEFAULT '{}'::jsonb,
  progress integer DEFAULT 0,
  video_url text,
  error_message text,
  duration_in_frames integer,
  fps integer DEFAULT 30,
  width integer DEFAULT 1920,
  height integer DEFAULT 1080,
  codec text DEFAULT 'h264',
  crf integer,
  cost_usd numeric(10,6) DEFAULT 0,
  tokens jsonb DEFAULT '{}'::jsonb,
  generated_code text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.remotion_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own remotion_render_jobs"
  ON public.remotion_render_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own remotion_render_jobs"
  ON public.remotion_render_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage remotion_render_jobs"
  ON public.remotion_render_jobs FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. Add animator_preset_id to channels
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'channels' AND column_name = 'animator_preset_id'
  ) THEN
    ALTER TABLE public.channels ADD COLUMN animator_preset_id uuid REFERENCES public.animator_presets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Add animator_segments to projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'animator_segments'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN animator_segments jsonb;
  END IF;
END $$;

-- 5. Add animator_video_url to projects (for the final rendered video)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'animator_video_url'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN animator_video_url text;
  END IF;
END $$;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_remotion_render_jobs_status ON public.remotion_render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_remotion_render_jobs_project ON public.remotion_render_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_animator_presets_channel ON public.animator_presets(channel_id);
