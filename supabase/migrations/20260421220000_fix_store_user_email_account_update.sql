-- Fix: when editing an existing account, the prior RPC did
-- INSERT ... ON CONFLICT (user_id, email) which conflicts on the PK
-- first (id already exists) and fails with
-- "duplicate key value violates unique constraint user_email_accounts_pkey".
--
-- Split the upsert: if p_id is provided → UPDATE directly (with ownership
-- check); else INSERT (with ON CONFLICT on user_id+email so that re-adding
-- the same email address just updates the existing row).

CREATE OR REPLACE FUNCTION public.store_user_email_account(
  p_id uuid,
  p_name text,
  p_email text,
  p_display_name text,
  p_imap_host text,
  p_imap_port int,
  p_smtp_host text,
  p_smtp_port int,
  p_smtp_ssl boolean,
  p_password text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  account_id uuid;
  secret_id uuid;
  secret_name text;
  owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF p_id IS NOT NULL THEN
    -- Update path: ensure the caller owns the row, then UPDATE in place.
    SELECT user_id INTO owner_id
    FROM public.user_email_accounts
    WHERE id = p_id;

    IF owner_id IS NULL THEN
      RAISE EXCEPTION 'Account not found';
    END IF;

    IF owner_id <> auth.uid() THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.user_email_accounts
    SET
      name = p_name,
      email = p_email,
      display_name = p_display_name,
      imap_host = p_imap_host,
      imap_port = p_imap_port,
      smtp_host = p_smtp_host,
      smtp_port = p_smtp_port,
      smtp_ssl = p_smtp_ssl,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO account_id;
  ELSE
    -- Create path: ON CONFLICT on (user_id, email) so re-adding the
    -- same address silently upgrades the existing row instead of erroring.
    INSERT INTO public.user_email_accounts (
      id, user_id, name, email, display_name,
      imap_host, imap_port, smtp_host, smtp_port, smtp_ssl,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      auth.uid(),
      p_name,
      p_email,
      p_display_name,
      p_imap_host,
      p_imap_port,
      p_smtp_host,
      p_smtp_port,
      p_smtp_ssl,
      now()
    )
    ON CONFLICT (user_id, email) DO UPDATE SET
      name = EXCLUDED.name,
      display_name = EXCLUDED.display_name,
      imap_host = EXCLUDED.imap_host,
      imap_port = EXCLUDED.imap_port,
      smtp_host = EXCLUDED.smtp_host,
      smtp_port = EXCLUDED.smtp_port,
      smtp_ssl = EXCLUDED.smtp_ssl,
      updated_at = now()
    RETURNING id INTO account_id;
  END IF;

  -- Rotate/create the Vault secret only when a password is provided.
  IF p_password IS NOT NULL AND length(p_password) > 0 THEN
    secret_name := CONCAT('user_email_account_', account_id::text);

    DELETE FROM vault.secrets WHERE name = secret_name;

    secret_id := vault.create_secret(
      p_password,
      secret_name,
      'IMAP/SMTP password for user: ' || auth.uid()::text
    );

    UPDATE public.user_email_accounts
    SET password_secret_id = secret_id,
        updated_at = now()
    WHERE id = account_id;
  END IF;

  RETURN account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_user_email_account(
  uuid, text, text, text, text, int, text, int, boolean, text
) TO authenticated;
