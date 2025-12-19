-- Create export_path_presets table
CREATE TABLE IF NOT EXISTS public.export_path_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.export_path_presets ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own export path presets"
    ON public.export_path_presets
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own export path presets"
    ON public.export_path_presets
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own export path presets"
    ON public.export_path_presets
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own export path presets"
    ON public.export_path_presets
    FOR DELETE
    USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_export_path_presets_user_id ON public.export_path_presets(user_id);

-- Function to ensure only one default preset per user
CREATE OR REPLACE FUNCTION ensure_single_default_export_path()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = true THEN
        UPDATE public.export_path_presets 
        SET is_default = false 
        WHERE user_id = NEW.user_id AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce single default
CREATE TRIGGER trigger_single_default_export_path
    AFTER INSERT OR UPDATE ON public.export_path_presets
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_default_export_path();
