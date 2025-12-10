-- Make project_id nullable in generated_thumbnails for standalone thumbnail generation
ALTER TABLE public.generated_thumbnails ALTER COLUMN project_id DROP NOT NULL;