import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

// Mirror the Supabase access token into a same-origin cookie so the CRM
// (FastAPI mounted at /crm on the same host) can read it on navigation.
// Supabase-js stores tokens in localStorage by default; navigating to
// /crm/ is a full page load, which doesn't carry localStorage — hence
// the cookie bridge. The cookie is Secure + SameSite=Lax and scoped to
// the whole site so nginx can forward it to the FastAPI upstream.
const CRM_COOKIE = 'videoflow-sb-access-token';

function syncAccessTokenCookie(token: string | null | undefined) {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? ' Secure;' : '';
  if (!token) {
    document.cookie = `${CRM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax;${secure}`;
    return;
  }
  // Cookies can't store JSON reliably, so we store the raw JWT. The
  // Python side accepts either a raw JWT or a JSON blob with
  // `access_token`.
  document.cookie = `${CRM_COOKIE}=${token}; Path=/; Max-Age=3600; SameSite=Lax;${secure}`;
}

supabase.auth.getSession().then(({ data }) => {
  syncAccessTokenCookie(data.session?.access_token);
});

supabase.auth.onAuthStateChange((_event, session) => {
  syncAccessTokenCookie(session?.access_token);
});
