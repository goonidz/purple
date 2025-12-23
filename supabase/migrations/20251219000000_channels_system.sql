-- Create channels table for managing video channels
CREATE TABLE IF NOT EXISTS public.channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6', -- Default blue color
  icon TEXT, -- Optional icon identifier
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, name) -- Prevent duplicate channel names per user
);

-- Enable Row Level Security
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own channels" 
ON public.channels 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own channels" 
ON public.channels 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own channels" 
ON public.channels 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own channels" 
ON public.channels 
FOR DELETE 
USING (auth.uid() = user_id);

-- Add channel_id to content_calendar
ALTER TABLE public.content_calendar 
ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL;

-- Create trigger for automatic timestamp updates on channels
CREATE TRIGGER update_channels_updated_at
BEFORE UPDATE ON public.channels
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_content_calendar_channel_id ON public.content_calendar(channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_user_id ON public.channels(user_id);





