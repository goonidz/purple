-- Computed columns for PostgREST: returns array length without transferring full JSON
CREATE OR REPLACE FUNCTION public.scene_count(public.projects)
RETURNS integer
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_array_length($1.scenes), 0)
$$;

CREATE OR REPLACE FUNCTION public.prompt_count(public.projects)
RETURNS integer
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_array_length($1.prompts), 0)
$$;
