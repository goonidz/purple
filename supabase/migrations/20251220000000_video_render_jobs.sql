-- Create video_render_jobs table
CREATE TABLE public.video_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  job_id TEXT NOT NULL, -- The jobId from the VPS service
  status_url TEXT,
  video_url TEXT,
  file_size_mb DECIMAL(10, 2),
  duration_seconds DECIMAL(10, 2),
  error_message TEXT,
  steps JSONB DEFAULT '[]',
  current_step TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.video_render_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own video render jobs"
ON public.video_render_jobs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own video render jobs"
ON public.video_render_jobs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own video render jobs"
ON public.video_render_jobs
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own video render jobs"
ON public.video_render_jobs
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_video_render_jobs_updated_at
BEFORE UPDATE ON public.video_render_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for job progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.video_render_jobs;

-- Create index for faster queries
CREATE INDEX idx_video_render_jobs_project_id ON public.video_render_jobs(project_id);
CREATE INDEX idx_video_render_jobs_user_id ON public.video_render_jobs(user_id);
CREATE INDEX idx_video_render_jobs_status ON public.video_render_jobs(status);
CREATE INDEX idx_video_render_jobs_created_at ON public.video_render_jobs(created_at DESC);





