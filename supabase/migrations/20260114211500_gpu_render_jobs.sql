-- GPU Pod render job queue (separate from VPS video_render_jobs)

CREATE TABLE public.gpu_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status public.job_status NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  video_url TEXT,
  error_message TEXT,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.gpu_render_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies (client can only see its own jobs)
CREATE POLICY "Users can view their own gpu render jobs"
ON public.gpu_render_jobs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own gpu render jobs"
ON public.gpu_render_jobs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own gpu render jobs"
ON public.gpu_render_jobs
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own gpu render jobs"
ON public.gpu_render_jobs
FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_gpu_render_jobs_updated_at
BEFORE UPDATE ON public.gpu_render_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for job progress updates (optional but useful)
ALTER PUBLICATION supabase_realtime ADD TABLE public.gpu_render_jobs;

-- Indexes
CREATE INDEX idx_gpu_render_jobs_project_id ON public.gpu_render_jobs(project_id);
CREATE INDEX idx_gpu_render_jobs_user_id ON public.gpu_render_jobs(user_id);
CREATE INDEX idx_gpu_render_jobs_status ON public.gpu_render_jobs(status);
CREATE INDEX idx_gpu_render_jobs_created_at ON public.gpu_render_jobs(created_at DESC);

-- Atomic claim function for workers (use with service role)
CREATE OR REPLACE FUNCTION public.claim_gpu_render_job(p_worker_id TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  user_id UUID,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT gj.id
    FROM public.gpu_render_jobs gj
    WHERE gj.status = 'pending'
    ORDER BY gj.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ),
  claimed AS (
    UPDATE public.gpu_render_jobs gj
    SET
      status = 'processing',
      progress = COALESCE(gj.progress, 0),
      claimed_by = p_worker_id,
      claimed_at = now(),
      started_at = COALESCE(gj.started_at, now()),
      updated_at = now()
    WHERE gj.id IN (SELECT id FROM candidate)
    RETURNING gj.id, gj.project_id, gj.user_id, gj.payload
  )
  SELECT c.id, c.project_id, c.user_id, c.payload
  FROM claimed c;
END;
$$;

