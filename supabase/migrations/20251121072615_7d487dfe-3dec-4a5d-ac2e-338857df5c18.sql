-- Enable the pgsodium extension for Vault
CREATE EXTENSION IF NOT EXISTS pgsodium;

-- Create secure functions to manage API keys in Vault
-- Function to store an API key securely in Vault
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
  -- But store only the vault secret_id, not the actual key
  INSERT INTO public.user_api_keys (user_id, eleven_labs_api_key, replicate_api_key, updated_at)
  VALUES (
    auth.uid(),
    CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE NULL END,
    now()
  )
  ON CONFLICT (user_id) 
  DO UPDATE SET
    eleven_labs_api_key = CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE user_api_keys.eleven_labs_api_key END,
    replicate_api_key = CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE user_api_keys.replicate_api_key END,
    updated_at = now();

  RETURN secret_id;
END;
$$;

-- Function to retrieve an API key securely from Vault
CREATE OR REPLACE FUNCTION public.get_user_api_key(key_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_name TEXT;
  decrypted_value TEXT;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Construct the secret name
  secret_name := CONCAT('user_api_key_', auth.uid()::text, '_', key_name);

  -- Retrieve and decrypt the secret from Vault
  SELECT decrypted_secret INTO decrypted_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name;

  RETURN decrypted_value;
END;
$$;

-- Function for edge functions to retrieve API keys (service role access)
CREATE OR REPLACE FUNCTION public.get_user_api_key_for_service(
  target_user_id uuid,
  key_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_name TEXT;
  decrypted_value TEXT;
BEGIN
  -- This function should only be called by edge functions with service role
  -- Construct the secret name
  secret_name := CONCAT('user_api_key_', target_user_id::text, '_', key_name);

  -- Retrieve and decrypt the secret from Vault
  SELECT decrypted_secret INTO decrypted_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name;

  RETURN decrypted_value;
END;
$$;

-- Function to delete an API key
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
    updated_at = now()
  WHERE user_id = auth.uid();

  RETURN TRUE;
END;
$$;

-- Grant execute permissions on the functions
GRANT EXECUTE ON FUNCTION public.store_user_api_key(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_api_key_for_service(uuid, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_api_key(TEXT) TO authenticated;