-- Add was_regenerated column to track scenes that went through regeneration
ALTER TABLE project_scenes ADD COLUMN IF NOT EXISTS was_regenerated BOOLEAN DEFAULT FALSE;

-- Add regenerated_prompt column to store the QA-suggested prompt used for regeneration
ALTER TABLE project_scenes ADD COLUMN IF NOT EXISTS regenerated_prompt TEXT DEFAULT NULL;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_project_scenes_was_regenerated ON project_scenes(project_id, was_regenerated) WHERE was_regenerated = TRUE;
