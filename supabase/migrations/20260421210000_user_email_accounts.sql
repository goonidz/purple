-- User email accounts (CRM webmail integration)
-- Each user can store multiple IMAP/SMTP account credentials.
-- Password is stored in Supabase Vault, only a reference id is kept in the table.

CREATE TABLE IF NOT EXISTS public.user_email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  display_name text,
  imap_host text NOT NULL DEFAULT 'mail.privateemail.com',
  imap_port int NOT NULL DEFAULT 993,
  smtp_host text NOT NULL DEFAULT 'mail.privateemail.com',
  smtp_port int NOT NULL DEFAULT 465,
  smtp_ssl boolean NOT NULL DEFAULT true,
  password_secret_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);

CREATE INDEX IF NOT EXISTS user_email_accounts_user_id_idx
  ON public.user_email_accounts (user_id);

ALTER TABLE public.user_email_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own email accounts"
  ON public.user_email_accounts;

CREATE POLICY "users manage own email accounts"
  ON public.user_email_accounts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- Upsert an email account + store its password in Vault.
-- Called by the authenticated user from the React profile UI.
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

  -- If updating: ensure the caller owns the row.
  IF p_id IS NOT NULL THEN
    SELECT user_id INTO owner_id
    FROM public.user_email_accounts
    WHERE id = p_id;

    IF owner_id IS NOT NULL AND owner_id <> auth.uid() THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Upsert the row (by (user_id, email) pair).
  INSERT INTO public.user_email_accounts (
    id, user_id, name, email, display_name,
    imap_host, imap_port, smtp_host, smtp_port, smtp_ssl,
    updated_at
  )
  VALUES (
    COALESCE(p_id, gen_random_uuid()),
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

  -- Only rotate/create the Vault secret when a password is provided.
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


-- Read the decrypted password for one account.
-- SECURITY DEFINER: the row's user_id must match auth.uid() OR the caller
-- must use the service_role (FastAPI backend).
CREATE OR REPLACE FUNCTION public.get_user_email_account_password(
  account_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  target_user_id uuid;
  secret_name text;
  decrypted_value text;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  SELECT user_id INTO owner_id
  FROM public.user_email_accounts
  WHERE id = account_id;

  IF owner_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF owner_id <> target_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  secret_name := CONCAT('user_email_account_', account_id::text);

  SELECT decrypted_secret INTO decrypted_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name;

  RETURN decrypted_value;
END;
$$;


-- Delete an account row + its Vault secret.
CREATE OR REPLACE FUNCTION public.delete_user_email_account(account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  secret_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  SELECT user_id INTO owner_id
  FROM public.user_email_accounts
  WHERE id = account_id;

  IF owner_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  secret_name := CONCAT('user_email_account_', account_id::text);
  DELETE FROM vault.secrets WHERE name = secret_name;

  DELETE FROM public.user_email_accounts WHERE id = account_id;

  RETURN TRUE;
END;
$$;


-- Trigger to keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_user_email_accounts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_email_accounts_updated_at
  ON public.user_email_accounts;

CREATE TRIGGER user_email_accounts_updated_at
  BEFORE UPDATE ON public.user_email_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_email_accounts_updated_at();


GRANT EXECUTE ON FUNCTION public.store_user_email_account(
  uuid, text, text, text, text, int, text, int, boolean, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_user_email_account_password(uuid, uuid)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.delete_user_email_account(uuid)
  TO authenticated;
