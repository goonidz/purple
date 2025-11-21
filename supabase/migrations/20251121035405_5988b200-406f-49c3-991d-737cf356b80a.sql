-- Create table for generated descriptions
CREATE TABLE IF NOT EXISTS public.generated_descriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  descriptions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.generated_descriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own descriptions"
  ON public.generated_descriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own descriptions"
  ON public.generated_descriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own descriptions"
  ON public.generated_descriptions
  FOR DELETE
  USING (auth.uid() = user_id);