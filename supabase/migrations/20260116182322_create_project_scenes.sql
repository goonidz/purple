-- Robust Normalized Scenes Table
-- This table replaces the prompts JSON array for high-concurrency reliability

CREATE TABLE IF NOT EXISTS public.project_scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    scene_index INTEGER NOT NULL,
    
    -- Content
    prompt TEXT,
    original_prompt TEXT,
    
    -- Image data (Generation)
    image_url TEXT,
    image_width INTEGER,
    image_height INTEGER,
    
    -- QA data
    qa_checked BOOLEAN DEFAULT false,
    qa_status TEXT, -- 'OK', 'REJECT', 'ERROR'
    qa_explication TEXT,
    qa_regeneration_prompt TEXT,
    
    -- Upscale data
    upscaled_url TEXT,
    is_upscaled BOOLEAN DEFAULT false,
    
    -- Video data (Animation)
    video_url TEXT,
    
    -- Metadata
    continuity_group_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Constraints
    UNIQUE(project_id, scene_index)
);

-- Enable RLS
ALTER TABLE public.project_scenes ENABLE ROW LEVEL SECURITY;

-- Simple policy: users can see/edit scenes of their own projects
CREATE POLICY "Users can manage scenes of their own projects"
ON public.project_scenes
FOR ALL
USING (
    project_id IN (
        SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_scenes_project_id ON public.project_scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_scenes_lookup ON public.project_scenes(project_id, scene_index);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_project_scenes_updated_at
    BEFORE UPDATE ON public.project_scenes
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Comment for documentation
COMMENT ON TABLE public.project_scenes IS 'Normalized storage for project scenes, replacing JSON prompts for better concurrency control.';
