-- Create storage policies for style-references bucket
-- Allow anyone to read files (bucket is public)
CREATE POLICY "Public can view style reference images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'style-references');

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload style reference images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'style-references');

-- Allow authenticated users to delete their own files
CREATE POLICY "Users can delete style reference images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'style-references');