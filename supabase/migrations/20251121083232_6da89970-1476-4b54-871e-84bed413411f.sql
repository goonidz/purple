-- Migration to transfer existing API keys from plain text to Vault
-- This function will be run once to migrate existing keys

CREATE OR REPLACE FUNCTION migrate_existing_api_keys_to_vault()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_record RECORD;
  replicate_secret_id uuid;
  elevenlabs_secret_id uuid;
BEGIN
  -- Loop through all users with API keys stored in plain text
  FOR user_record IN 
    SELECT user_id, replicate_api_key, eleven_labs_api_key 
    FROM user_api_keys 
    WHERE replicate_api_key IS NOT NULL OR eleven_labs_api_key IS NOT NULL
  LOOP
    -- Migrate Replicate API key if it exists and doesn't look like a vault ID
    IF user_record.replicate_api_key IS NOT NULL 
       AND user_record.replicate_api_key NOT LIKE '00000000-0000-0000-0000-%' THEN
      
      -- Store in Vault
      replicate_secret_id := vault.create_secret(
        user_record.replicate_api_key,
        CONCAT('user_api_key_', user_record.user_id::text, '_replicate'),
        'Migrated Replicate API key for user: ' || user_record.user_id::text
      );
      
      -- Update the table to store the vault secret ID instead
      UPDATE user_api_keys 
      SET replicate_api_key = replicate_secret_id::text,
          updated_at = now()
      WHERE user_id = user_record.user_id;
      
      RAISE NOTICE 'Migrated Replicate key for user %', user_record.user_id;
    END IF;
    
    -- Migrate Eleven Labs API key if it exists and doesn't look like a vault ID
    IF user_record.eleven_labs_api_key IS NOT NULL 
       AND user_record.eleven_labs_api_key NOT LIKE '00000000-0000-0000-0000-%' THEN
      
      -- Store in Vault
      elevenlabs_secret_id := vault.create_secret(
        user_record.eleven_labs_api_key,
        CONCAT('user_api_key_', user_record.user_id::text, '_eleven_labs'),
        'Migrated Eleven Labs API key for user: ' || user_record.user_id::text
      );
      
      -- Update the table to store the vault secret ID instead
      UPDATE user_api_keys 
      SET eleven_labs_api_key = elevenlabs_secret_id::text,
          updated_at = now()
      WHERE user_id = user_record.user_id;
      
      RAISE NOTICE 'Migrated Eleven Labs key for user %', user_record.user_id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Migration completed successfully';
END;
$$;

-- Execute the migration immediately
SELECT migrate_existing_api_keys_to_vault();

-- Drop the migration function as it's only needed once
DROP FUNCTION migrate_existing_api_keys_to_vault();