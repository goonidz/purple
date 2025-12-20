-- Create storage bucket for rendered videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('rendered-videos', 'rendered-videos', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for rendered-videos bucket
-- Allow authenticated users to upload their own rendered videos
CREATE POLICY "Users can upload their own rendered videos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'rendered-videos' AND
  auth.uid() IS NOT NULL
);

-- Allow users to view their own rendered videos
CREATE POLICY "Users can view their own rendered videos"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'rendered-videos' AND
  auth.uid() IS NOT NULL
);

-- Allow public read access to rendered videos (for sharing)
CREATE POLICY "Public read access to rendered videos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'rendered-videos');

-- Allow users to delete their own rendered videos
CREATE POLICY "Users can delete their own rendered videos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'rendered-videos' AND
  auth.uid() IS NOT NULL
);

