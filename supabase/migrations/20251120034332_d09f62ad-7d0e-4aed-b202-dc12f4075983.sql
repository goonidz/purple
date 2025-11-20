-- Add audio_url column to projects table
ALTER TABLE public.projects
ADD COLUMN audio_url TEXT;

-- Create storage bucket for audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-files', 'audio-files', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for audio-files bucket
CREATE POLICY "Users can upload their own audio files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'audio-files' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own audio files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'audio-files' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Audio files are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'audio-files');

CREATE POLICY "Users can delete their own audio files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'audio-files' AND
  auth.uid()::text = (storage.foldername(name))[1]
);