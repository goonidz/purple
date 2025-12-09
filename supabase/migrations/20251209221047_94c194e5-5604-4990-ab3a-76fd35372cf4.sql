-- Create TTS presets table for saving voice configuration
CREATE TABLE public.tts_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  voice_id TEXT NOT NULL,
  model TEXT,
  speed NUMERIC DEFAULT 1.0,
  pitch INTEGER DEFAULT 0,
  volume NUMERIC DEFAULT 1.0,
  language_boost TEXT DEFAULT 'auto',
  english_normalization BOOLEAN DEFAULT true,
  emotion TEXT DEFAULT 'neutral',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.tts_presets ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own TTS presets" 
ON public.tts_presets 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own TTS presets" 
ON public.tts_presets 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own TTS presets" 
ON public.tts_presets 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own TTS presets" 
ON public.tts_presets 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_tts_presets_updated_at
BEFORE UPDATE ON public.tts_presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();