-- Migration: Add duration field to competitor_videos to filter out shorts

ALTER TABLE competitor_videos 
  ADD COLUMN duration_seconds INTEGER;

CREATE INDEX idx_competitor_videos_duration ON competitor_videos(duration_seconds);
