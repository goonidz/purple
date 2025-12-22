-- Migration: Competitor Tracking Feature
-- Track YouTube competitor channels and their videos with outlier score calculation

-- Table des chaines concurrentes
CREATE TABLE competitor_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,              -- YouTube channel ID (UC...)
  channel_name TEXT NOT NULL,
  channel_avatar TEXT,
  subscriber_count INTEGER DEFAULT 0,
  avg_views_per_video INTEGER DEFAULT 0, -- Moyenne sur 10 dernieres videos
  is_active BOOLEAN DEFAULT true,        -- Pour filtrer dans la vue
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, channel_id)
);

-- Table des videos des concurrents
CREATE TABLE competitor_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,              -- YouTube channel ID
  video_id TEXT NOT NULL UNIQUE,         -- YouTube video ID
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  views_per_hour NUMERIC(10,2),          -- Calcule
  outlier_score NUMERIC(10,2),           -- Calcule (ex: 49.0 pour 49x)
  last_fetched_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour performances
CREATE INDEX idx_competitor_channels_user ON competitor_channels(user_id);
CREATE INDEX idx_competitor_videos_channel ON competitor_videos(channel_id);
CREATE INDEX idx_competitor_videos_published ON competitor_videos(published_at DESC);
CREATE INDEX idx_competitor_videos_outlier ON competitor_videos(outlier_score DESC);

-- RLS
ALTER TABLE competitor_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_videos ENABLE ROW LEVEL SECURITY;

-- Policy for competitor_channels: users can manage their own competitors
CREATE POLICY "Users can view their competitors" ON competitor_channels
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their competitors" ON competitor_channels
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their competitors" ON competitor_channels
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their competitors" ON competitor_channels
  FOR DELETE USING (auth.uid() = user_id);

-- Policy for competitor_videos: users can view videos from their tracked channels
CREATE POLICY "Users can view videos from their competitors" ON competitor_videos
  FOR SELECT USING (
    channel_id IN (SELECT channel_id FROM competitor_channels WHERE user_id = auth.uid())
  );

-- Service role can manage all competitor videos (for edge functions)
CREATE POLICY "Service role can manage competitor videos" ON competitor_videos
  FOR ALL USING (auth.role() = 'service_role');
