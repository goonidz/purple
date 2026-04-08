-- Add QA job types for parallel QA agent system
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'qa_scenes';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'qa_scene';
