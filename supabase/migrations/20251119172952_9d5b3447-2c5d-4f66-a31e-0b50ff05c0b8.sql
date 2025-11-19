-- Add style_reference_url column to projects table
ALTER TABLE public.projects 
ADD COLUMN style_reference_url TEXT;