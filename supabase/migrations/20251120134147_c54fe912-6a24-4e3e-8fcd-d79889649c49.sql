-- Create title_presets table
CREATE TABLE public.title_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  example_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.title_presets ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own title presets" 
ON public.title_presets 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own title presets" 
ON public.title_presets 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own title presets" 
ON public.title_presets 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own title presets" 
ON public.title_presets 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create generated_titles table
CREATE TABLE public.generated_titles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.generated_titles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own generated titles" 
ON public.generated_titles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own generated titles" 
ON public.generated_titles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own generated titles" 
ON public.generated_titles 
FOR DELETE 
USING (auth.uid() = user_id);

-- Add trigger for updated_at on title_presets
CREATE TRIGGER update_title_presets_updated_at
BEFORE UPDATE ON public.title_presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
