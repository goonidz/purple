-- Créer une table séparée pour les presets de miniatures
CREATE TABLE IF NOT EXISTS public.thumbnail_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  example_urls jsonb DEFAULT '[]'::jsonb,
  character_ref_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.thumbnail_presets ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own thumbnail presets"
ON public.thumbnail_presets
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own thumbnail presets"
ON public.thumbnail_presets
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own thumbnail presets"
ON public.thumbnail_presets
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own thumbnail presets"
ON public.thumbnail_presets
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_thumbnail_presets_updated_at
BEFORE UPDATE ON public.thumbnail_presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Retirer les colonnes de miniatures de la table presets
ALTER TABLE public.presets
DROP COLUMN IF EXISTS thumbnail_example_urls,
DROP COLUMN IF EXISTS thumbnail_character_ref_url;