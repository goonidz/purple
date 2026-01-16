-- Add preset_id column to projects table to track which preset was used
-- This allows the backend to load LoRA and other settings from the preset

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS preset_id UUID REFERENCES presets(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_preset_id ON projects(preset_id);

COMMENT ON COLUMN projects.preset_id IS 'Reference to the preset used for this project, allows loading LoRA and other settings';
