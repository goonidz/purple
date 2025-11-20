-- Create table for storing generated thumbnails
CREATE TABLE public.generated_thumbnails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  thumbnail_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.generated_thumbnails ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own generated thumbnails"
ON public.generated_thumbnails
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own generated thumbnails"
ON public.generated_thumbnails
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own generated thumbnails"
ON public.generated_thumbnails
FOR DELETE
USING (auth.uid() = user_id);