-- Create thumbnail_projects table for standalone thumbnail generation
CREATE TABLE IF NOT EXISTS public.thumbnail_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    script TEXT NOT NULL,
    preset_id UUID REFERENCES public.thumbnail_presets(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.thumbnail_projects ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own thumbnail projects"
    ON public.thumbnail_projects
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own thumbnail projects"
    ON public.thumbnail_projects
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own thumbnail projects"
    ON public.thumbnail_projects
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own thumbnail projects"
    ON public.thumbnail_projects
    FOR DELETE
    USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_thumbnail_projects_user_id ON public.thumbnail_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_thumbnail_projects_created_at ON public.thumbnail_projects(created_at DESC);

-- Update generated_thumbnails to reference thumbnail_projects
-- Add a column for thumbnail_project_id (separate from video project_id)
ALTER TABLE public.generated_thumbnails 
ADD COLUMN IF NOT EXISTS thumbnail_project_id UUID REFERENCES public.thumbnail_projects(id) ON DELETE CASCADE;

-- Create index for thumbnail_project_id
CREATE INDEX IF NOT EXISTS idx_generated_thumbnails_thumbnail_project_id ON public.generated_thumbnails(thumbnail_project_id);
