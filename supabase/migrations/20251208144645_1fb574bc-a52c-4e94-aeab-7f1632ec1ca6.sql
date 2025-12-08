-- Create content calendar table for planned videos
CREATE TABLE public.content_calendar (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'scripted', 'audio_ready', 'generating', 'completed')),
  script TEXT,
  audio_url TEXT,
  notes TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.content_calendar ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own calendar entries" 
ON public.content_calendar 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own calendar entries" 
ON public.content_calendar 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own calendar entries" 
ON public.content_calendar 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own calendar entries" 
ON public.content_calendar 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_content_calendar_updated_at
BEFORE UPDATE ON public.content_calendar
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();