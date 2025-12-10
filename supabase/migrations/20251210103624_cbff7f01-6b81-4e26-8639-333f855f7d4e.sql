-- Create table for generated tags history
CREATE TABLE public.generated_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.generated_tags ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own generated tags" 
ON public.generated_tags 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own generated tags" 
ON public.generated_tags 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own generated tags" 
ON public.generated_tags 
FOR DELETE 
USING (auth.uid() = user_id);