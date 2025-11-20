-- Create presets table for saving configuration templates
CREATE TABLE public.presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  scene_duration_0to1 INTEGER DEFAULT 4,
  scene_duration_1to3 INTEGER DEFAULT 6,
  scene_duration_3plus INTEGER DEFAULT 8,
  example_prompts JSONB DEFAULT '[]'::jsonb,
  image_width INTEGER DEFAULT 1920,
  image_height INTEGER DEFAULT 1080,
  aspect_ratio TEXT DEFAULT '16:9',
  style_reference_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.presets ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own presets" 
ON public.presets 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own presets" 
ON public.presets 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own presets" 
ON public.presets 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own presets" 
ON public.presets 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_presets_updated_at
BEFORE UPDATE ON public.presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();