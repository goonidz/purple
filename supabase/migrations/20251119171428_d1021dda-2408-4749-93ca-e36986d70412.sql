-- Create a storage bucket for style reference images
INSERT INTO storage.buckets (id, name, public)
VALUES ('style-references', 'style-references', true)
ON CONFLICT (id) DO NOTHING;