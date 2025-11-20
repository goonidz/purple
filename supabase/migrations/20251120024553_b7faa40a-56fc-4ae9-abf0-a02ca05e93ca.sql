-- Create storage bucket for generated images
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for generated-images bucket
CREATE POLICY "Allow public read access to generated images"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated-images');

CREATE POLICY "Allow authenticated users to upload generated images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'generated-images' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Allow authenticated users to update their generated images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'generated-images' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Allow authenticated users to delete their generated images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'generated-images' 
  AND auth.uid() IS NOT NULL
);