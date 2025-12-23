-- Add anthropic_api_key column to user_api_keys table
ALTER TABLE public.user_api_keys 
ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;

-- Update store_user_api_key function to support anthropic
CREATE OR REPLACE FUNCTION public.store_user_api_key(
  key_name TEXT,
  key_value TEXT
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_id uuid;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Store the secret in Vault with user_id as part of the name for isolation
  secret_id := vault.create_secret(
    key_value,
    CONCAT('user_api_key_', auth.uid()::text, '_', key_name),
    'API key for user: ' || auth.uid()::text
  );

  -- Update or insert into user_api_keys table to track which keys exist
  INSERT INTO public.user_api_keys (user_id, eleven_labs_api_key, replicate_api_key, anthropic_api_key, updated_at)
  VALUES (
    auth.uid(),
    CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'anthropic' THEN secret_id::text ELSE NULL END,
    now()
  )
  ON CONFLICT (user_id) 
  DO UPDATE SET
    eleven_labs_api_key = CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE user_api_keys.eleven_labs_api_key END,
    replicate_api_key = CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE user_api_keys.replicate_api_key END,
    anthropic_api_key = CASE WHEN key_name = 'anthropic' THEN secret_id::text ELSE user_api_keys.anthropic_api_key END,
    updated_at = now();

  RETURN secret_id;
END;
$$;

-- Update delete_user_api_key function to support anthropic
CREATE OR REPLACE FUNCTION public.delete_user_api_key(key_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_name TEXT;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Construct the secret name
  secret_name := CONCAT('user_api_key_', auth.uid()::text, '_', key_name);

  -- Delete the secret from Vault
  PERFORM vault.delete_secret(
    (SELECT id FROM vault.secrets WHERE name = secret_name)
  );

  -- Update the user_api_keys table
  UPDATE public.user_api_keys
  SET 
    eleven_labs_api_key = CASE WHEN key_name = 'eleven_labs' THEN NULL ELSE eleven_labs_api_key END,
    replicate_api_key = CASE WHEN key_name = 'replicate' THEN NULL ELSE replicate_api_key END,
    anthropic_api_key = CASE WHEN key_name = 'anthropic' THEN NULL ELSE anthropic_api_key END,
    updated_at = now()
  WHERE user_id = auth.uid();

  RETURN TRUE;
END;
$$;

