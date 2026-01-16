-- ============================================================================
-- GENERATION QUEUE - Scalable architecture for image generation
-- ============================================================================
-- This migration creates a centralized queue system for all generation tasks
-- with global concurrency control and atomic claiming to prevent race conditions.
-- ============================================================================

-- Create the generation_queue table
CREATE TABLE IF NOT EXISTS public.generation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  -- Type and index
  generation_type TEXT NOT NULL, -- 'scene_image', 'upscale', 'thumbnail', 'qa'
  item_index INTEGER NOT NULL,   -- scene_index, thumbnail_index, etc.
  
  -- Payload (prompt, dimensions, style_refs, etc.)
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  prediction_id TEXT,            -- Replicate prediction ID
  result_url TEXT,               -- Final result URL
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  
  -- Priority (higher = processed first)
  priority INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Constraint: one item per project/type/index (prevents duplicates)
  CONSTRAINT uq_generation_queue_item UNIQUE (project_id, generation_type, item_index)
);

-- ============================================================================
-- INDEXES for optimal query performance
-- ============================================================================

-- Index for claiming pending items (most important query)
CREATE INDEX idx_generation_queue_pending 
ON public.generation_queue(status, priority DESC, created_at ASC)
WHERE status = 'pending';

-- Index for checking processing items (concurrency control)
CREATE INDEX idx_generation_queue_processing 
ON public.generation_queue(status)
WHERE status = 'processing';

-- Index for job-based lookups (progress tracking)
CREATE INDEX idx_generation_queue_job_id 
ON public.generation_queue(job_id);

-- Index for prediction ID lookups (webhook handling)
CREATE INDEX idx_generation_queue_prediction_id 
ON public.generation_queue(prediction_id)
WHERE prediction_id IS NOT NULL;

-- Index for project-based lookups
CREATE INDEX idx_generation_queue_project_id 
ON public.generation_queue(project_id);

-- Index for cleanup of old completed items
CREATE INDEX idx_generation_queue_completed 
ON public.generation_queue(completed_at)
WHERE status IN ('completed', 'failed');

-- ============================================================================
-- RPC: Atomic claim function with FOR UPDATE SKIP LOCKED
-- ============================================================================
-- This function atomically claims N items from the queue without race conditions.
-- Uses SKIP LOCKED to allow concurrent workers without blocking.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_queue_items(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.generation_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id 
    FROM public.generation_queue
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.generation_queue q
  SET 
    status = 'processing', 
    started_at = now()
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

-- ============================================================================
-- RPC: Get queue statistics for monitoring
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_queue_stats()
RETURNS TABLE(
  pending_count BIGINT,
  processing_count BIGINT,
  completed_count BIGINT,
  failed_count BIGINT,
  oldest_pending TIMESTAMPTZ,
  oldest_processing TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
    COUNT(*) FILTER (WHERE status = 'processing') as processing_count,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
    MIN(created_at) FILTER (WHERE status = 'pending') as oldest_pending,
    MIN(started_at) FILTER (WHERE status = 'processing') as oldest_processing
  FROM public.generation_queue;
END;
$$;

-- ============================================================================
-- RPC: Reset stuck items (processing for too long)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reset_stuck_queue_items(
  p_stuck_threshold_minutes INTEGER DEFAULT 10,
  p_max_retries INTEGER DEFAULT 3
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  reset_count INTEGER;
BEGIN
  WITH stuck AS (
    SELECT id
    FROM public.generation_queue
    WHERE status = 'processing'
      AND started_at < now() - (p_stuck_threshold_minutes || ' minutes')::interval
      AND retry_count < p_max_retries
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.generation_queue q
  SET 
    status = 'pending',
    started_at = NULL,
    retry_count = retry_count + 1
  FROM stuck s
  WHERE q.id = s.id;
  
  GET DIAGNOSTICS reset_count = ROW_COUNT;
  RETURN reset_count;
END;
$$;

-- ============================================================================
-- RPC: Mark items as permanently failed (exceeded retries)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fail_exceeded_retries(p_max_retries INTEGER DEFAULT 3)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  failed_count INTEGER;
BEGIN
  UPDATE public.generation_queue
  SET 
    status = 'failed',
    error_message = COALESCE(error_message, '') || ' [Exceeded max retries]',
    completed_at = now()
  WHERE status = 'processing'
    AND started_at < now() - interval '10 minutes'
    AND retry_count >= p_max_retries;
  
  GET DIAGNOSTICS failed_count = ROW_COUNT;
  RETURN failed_count;
END;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.generation_queue ENABLE ROW LEVEL SECURITY;

-- Users can view their own queue items
CREATE POLICY "Users can view their own queue items"
ON public.generation_queue FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own queue items
CREATE POLICY "Users can insert their own queue items"
ON public.generation_queue FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own queue items
CREATE POLICY "Users can update their own queue items"
ON public.generation_queue FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own queue items
CREATE POLICY "Users can delete their own queue items"
ON public.generation_queue FOR DELETE
USING (auth.uid() = user_id);

-- ============================================================================
-- GRANT permissions for service role (Edge Functions)
-- ============================================================================

GRANT ALL ON public.generation_queue TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_queue_items TO service_role;
GRANT EXECUTE ON FUNCTION public.get_queue_stats TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_stuck_queue_items TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_exceeded_retries TO service_role;

-- ============================================================================
-- Add index to pending_predictions for better performance (fix for existing system)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pending_predictions_project_lookup 
ON public.pending_predictions(project_id, prediction_type, status, created_at);

-- ============================================================================
-- COMMENTS for documentation
-- ============================================================================

COMMENT ON TABLE public.generation_queue IS 'Centralized queue for all generation tasks with global concurrency control';
COMMENT ON COLUMN public.generation_queue.generation_type IS 'Type of generation: scene_image, upscale, thumbnail, qa';
COMMENT ON COLUMN public.generation_queue.priority IS 'Higher priority items are processed first (default 0)';
COMMENT ON COLUMN public.generation_queue.payload IS 'JSON payload containing prompt, dimensions, style refs, etc.';
COMMENT ON FUNCTION public.claim_queue_items IS 'Atomically claim N items from the queue using FOR UPDATE SKIP LOCKED';
COMMENT ON FUNCTION public.get_queue_stats IS 'Get queue statistics for monitoring dashboard';
COMMENT ON FUNCTION public.reset_stuck_queue_items IS 'Reset items stuck in processing state back to pending';
