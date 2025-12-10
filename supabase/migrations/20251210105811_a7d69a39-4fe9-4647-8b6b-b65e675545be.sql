-- Make project_id nullable in generation_jobs for standalone thumbnail generation
ALTER TABLE public.generation_jobs ALTER COLUMN project_id DROP NOT NULL;

-- Make project_id nullable in pending_predictions for standalone thumbnail generation  
ALTER TABLE public.pending_predictions ALTER COLUMN project_id DROP NOT NULL;