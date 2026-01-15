-- Add current_step to gpu_render_jobs for better UI feedback

ALTER TABLE public.gpu_render_jobs 
ADD COLUMN IF NOT EXISTS current_step TEXT;
