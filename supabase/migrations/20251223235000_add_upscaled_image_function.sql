-- Create a function to atomically update a single scene's imageUrl AND mark it as upscaled
-- This prevents re-upscaling images that were already processed
CREATE OR REPLACE FUNCTION public.update_scene_image_url_upscaled(
  p_project_id uuid,
  p_scene_index integer,
  p_image_url text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_prompts jsonb;
  updated_prompts jsonb;
  scene_obj jsonb;
BEGIN
  -- Get current prompts with row lock to prevent concurrent modifications
  SELECT prompts INTO current_prompts
  FROM projects
  WHERE id = p_project_id
  FOR UPDATE;
  
  IF current_prompts IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Check if scene index exists
  IF p_scene_index < 0 OR p_scene_index >= jsonb_array_length(current_prompts) THEN
    RETURN FALSE;
  END IF;
  
  -- Get the current scene object
  scene_obj := current_prompts->p_scene_index;
  
  -- Update imageUrl and add isUpscaled flag
  scene_obj := jsonb_set(scene_obj, '{imageUrl}', to_jsonb(p_image_url));
  scene_obj := jsonb_set(scene_obj, '{isUpscaled}', 'true'::jsonb);
  
  -- Update the prompts array with the modified scene
  updated_prompts := jsonb_set(current_prompts, ARRAY[p_scene_index::text], scene_obj);
  
  -- Write back
  UPDATE projects
  SET prompts = updated_prompts, updated_at = now()
  WHERE id = p_project_id;
  
  RETURN TRUE;
END;
$$;
