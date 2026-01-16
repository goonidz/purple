-- Atomic RPC function to update QA status in projects.prompts without race conditions
-- This uses jsonb_set to atomically update a single element of the prompts array

CREATE OR REPLACE FUNCTION update_prompt_qa_status(
  p_project_id UUID,
  p_scene_index INTEGER,
  p_qa_checked BOOLEAN,
  p_qa_status TEXT,
  p_qa_explication TEXT DEFAULT NULL,
  p_qa_regeneration_prompt TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  current_prompt JSONB;
  updated_prompt JSONB;
BEGIN
  -- Get the current prompt at the scene index
  SELECT prompts->p_scene_index INTO current_prompt
  FROM projects
  WHERE id = p_project_id;
  
  IF current_prompt IS NULL THEN
    RAISE WARNING 'No prompt found at scene_index % for project %', p_scene_index, p_project_id;
    RETURN;
  END IF;
  
  -- Build the updated prompt object
  updated_prompt := current_prompt 
    || jsonb_build_object('qa_checked', p_qa_checked)
    || jsonb_build_object('qa_status', p_qa_status);
  
  -- Add optional fields only if provided
  IF p_qa_explication IS NOT NULL THEN
    updated_prompt := updated_prompt || jsonb_build_object('qa_explication', p_qa_explication);
  END IF;
  
  IF p_qa_regeneration_prompt IS NOT NULL THEN
    updated_prompt := updated_prompt || jsonb_build_object('qa_regeneration_prompt', p_qa_regeneration_prompt);
  END IF;
  
  -- Atomically update just this one element in the prompts array
  UPDATE projects
  SET prompts = jsonb_set(prompts, ARRAY[p_scene_index::text], updated_prompt)
  WHERE id = p_project_id;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION update_prompt_qa_status TO service_role;
