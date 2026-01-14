-- Fix ambiguous column reference in claim_gpu_render_job

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
    WHERE gj.id IN (SELECT candidate.id FROM candidate)
    RETURNING gj.id, gj.project_id, gj.user_id, gj.payload
  )
  SELECT c.id, c.project_id, c.user_id, c.payload
  FROM claimed c;
END;
$$;
