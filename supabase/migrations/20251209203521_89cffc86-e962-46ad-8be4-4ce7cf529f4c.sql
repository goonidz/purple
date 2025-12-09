-- Create table for script generation presets
CREATE TABLE public.script_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  custom_prompt TEXT,
  duration TEXT DEFAULT 'medium',
  style TEXT DEFAULT 'educational',
  language TEXT DEFAULT 'fr',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.script_presets ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own script presets" 
ON public.script_presets 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own script presets" 
ON public.script_presets 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own script presets" 
ON public.script_presets 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own script presets" 
ON public.script_presets 
FOR DELETE 
USING (auth.uid() = user_id);