-- Prevent duplicate predictions for the same scene in the same project
-- This creates a unique index that only considers active predictions (pending, processing, starting)

-- First, clean up any existing duplicates (keep only the most recent one)
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY project_id, scene_index, prediction_type 
    ORDER BY created_at DESC
  ) as rn
  FROM pending_predictions
  WHERE status IN ('pending', 'processing', 'starting')
    AND scene_index IS NOT NULL
)
DELETE FROM pending_predictions 
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Create a unique partial index on active predictions per project/scene/type
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_prediction_per_scene
ON pending_predictions (project_id, scene_index, prediction_type)
WHERE status IN ('pending', 'processing', 'starting') AND scene_index IS NOT NULL;
