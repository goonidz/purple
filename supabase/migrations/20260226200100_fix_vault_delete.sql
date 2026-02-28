-- Fix: vault.delete_secret() doesn't exist, use DELETE FROM vault.secrets directly
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
  secret_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  secret_name := CONCAT('user_api_key_', auth.uid()::text, '_', key_name);

  -- Delete existing vault secret if it exists (enables updates)
  DELETE FROM vault.secrets WHERE name = secret_name;

  -- Create new secret in Vault
  secret_id := vault.create_secret(
    key_value,
    secret_name,
    'API key for user: ' || auth.uid()::text
  );

  INSERT INTO public.user_api_keys (user_id, eleven_labs_api_key, replicate_api_key, anthropic_api_key, brave_api_key, gemini_api_key, updated_at)
  VALUES (
    auth.uid(),
    CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'anthropic' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'brave' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'gemini' THEN secret_id::text ELSE NULL END,
    now()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    eleven_labs_api_key = CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE user_api_keys.eleven_labs_api_key END,
    replicate_api_key = CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE user_api_keys.replicate_api_key END,
    anthropic_api_key = CASE WHEN key_name = 'anthropic' THEN secret_id::text ELSE user_api_keys.anthropic_api_key END,
    brave_api_key = CASE WHEN key_name = 'brave' THEN secret_id::text ELSE user_api_keys.brave_api_key END,
    gemini_api_key = CASE WHEN key_name = 'gemini' THEN secret_id::text ELSE user_api_keys.gemini_api_key END,
    updated_at = now();

  RETURN secret_id;
END;
$$;

-- Also fix delete_user_api_key to use DELETE instead of vault.delete_secret
CREATE OR REPLACE FUNCTION public.delete_user_api_key(key_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  secret_name := CONCAT('user_api_key_', auth.uid()::text, '_', key_name);

  DELETE FROM vault.secrets WHERE name = secret_name;

  UPDATE public.user_api_keys
  SET
    eleven_labs_api_key = CASE WHEN key_name = 'eleven_labs' THEN NULL ELSE eleven_labs_api_key END,
    replicate_api_key = CASE WHEN key_name = 'replicate' THEN NULL ELSE replicate_api_key END,
    anthropic_api_key = CASE WHEN key_name = 'anthropic' THEN NULL ELSE anthropic_api_key END,
    brave_api_key = CASE WHEN key_name = 'brave' THEN NULL ELSE brave_api_key END,
    gemini_api_key = CASE WHEN key_name = 'gemini' THEN NULL ELSE gemini_api_key END,
    updated_at = now()
  WHERE user_id = auth.uid();

  RETURN TRUE;
END;
$$;
