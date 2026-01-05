-- Add visual_continuity_enabled column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visual_continuity_enabled BOOLEAN DEFAULT false;
