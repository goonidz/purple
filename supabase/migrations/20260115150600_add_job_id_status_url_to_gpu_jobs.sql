-- Add job_id and status_url columns to gpu_render_jobs for RunPod Serverless integration

ALTER TABLE public.gpu_render_jobs
ADD COLUMN IF NOT EXISTS job_id TEXT,
ADD COLUMN IF NOT EXISTS status_url TEXT;

-- Add index for job_id lookups
CREATE INDEX IF NOT EXISTS idx_gpu_render_jobs_job_id ON public.gpu_render_jobs(job_id);

-- Add comment
COMMENT ON COLUMN public.gpu_render_jobs.job_id IS 'RunPod job ID for tracking serverless renders';
COMMENT ON COLUMN public.gpu_render_jobs.status_url IS 'RunPod status URL for polling job progress';
