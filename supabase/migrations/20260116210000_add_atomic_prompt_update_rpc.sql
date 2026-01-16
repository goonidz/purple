-- Atomic function to update a single prompt in the projects.prompts JSONB array
-- This prevents race conditions when multiple prompt jobs complete simultaneously

CREATE OR REPLACE FUNCTION update_prompt_in_array(
  p_project_id UUID,
  p_scene_index INTEGER,
  p_prompt TEXT,
  p_scene_text TEXT DEFAULT NULL,
  p_start_time NUMERIC DEFAULT NULL,
  p_end_time NUMERIC DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  current_prompts JSONB;
  new_prompt JSONB;
  array_length INTEGER;
BEGIN
  -- Get current prompts array with row lock to prevent concurrent modifications
  SELECT prompts INTO current_prompts
  FROM projects
  WHERE id = p_project_id
  FOR UPDATE;
  
  -- Initialize array if null
  IF current_prompts IS NULL THEN
    current_prompts := '[]'::JSONB;
  END IF;
  
  -- Ensure array is long enough
  array_length := jsonb_array_length(current_prompts);
  WHILE array_length <= p_scene_index LOOP
    current_prompts := current_prompts || 'null'::JSONB;
    array_length := array_length + 1;
  END LOOP;
  
  -- Build the new prompt object, preserving existing fields
  new_prompt := COALESCE(current_prompts->p_scene_index, '{}'::JSONB);
  
  -- Update fields
  new_prompt := jsonb_set(new_prompt, '{scene}', to_jsonb('Scène ' || (p_scene_index + 1)));
  new_prompt := jsonb_set(new_prompt, '{prompt}', to_jsonb(p_prompt));
  
  IF p_scene_text IS NOT NULL THEN
    new_prompt := jsonb_set(new_prompt, '{text}', to_jsonb(p_scene_text));
  END IF;
  
  IF p_start_time IS NOT NULL THEN
    new_prompt := jsonb_set(new_prompt, '{startTime}', to_jsonb(p_start_time));
  END IF;
  
  IF p_end_time IS NOT NULL THEN
    new_prompt := jsonb_set(new_prompt, '{endTime}', to_jsonb(p_end_time));
    IF p_start_time IS NOT NULL THEN
      new_prompt := jsonb_set(new_prompt, '{duration}', to_jsonb(p_end_time - p_start_time));
    END IF;
  END IF;
  
  -- Set the prompt at the specific index atomically
  current_prompts := jsonb_set(current_prompts, ARRAY[p_scene_index::TEXT], new_prompt);
  
  -- Update the project
  UPDATE projects
  SET prompts = current_prompts,
      updated_at = NOW()
  WHERE id = p_project_id;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION update_prompt_in_array TO service_role;
