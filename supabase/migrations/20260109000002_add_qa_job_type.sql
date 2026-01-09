-- Add 'qa' to the job_type enum for quality assurance checks
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'qa';
