// Auth content script for YouTube AI Comments
// Captures VideoFlow session token on purpleai.duckdns.org/auth
// Adapted from chrome-extension/content-script.js

const ALLOWED_ORIGIN = 'https://purpleai.duckdns.org';
const SESSION_KEY = 'videoflow_session';

console.log('[YT AI Auth] Loaded on:', window.location.href);

window.addEventListener('message', async (event) => {
  if (event.origin !== ALLOWED_ORIGIN) return;

  if (event.data?.type === 'VIDEOFLOW_AUTH_SUCCESS') {
    const { token, user, supabaseUrl, supabaseAnonKey } = event.data;

    if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
      console.error('[YT AI Auth] Invalid token format');
      window.postMessage({ type: 'VIDEOFLOW_AUTH_ERROR', error: 'Invalid token format' }, event.origin);
      return;
    }

    if (!user || !user.id || !user.email) {
      console.error('[YT AI Auth] Invalid user data');
      window.postMessage({ type: 'VIDEOFLOW_AUTH_ERROR', error: 'Invalid user data' }, event.origin);
      return;
    }

    try {
      const session = {
        access_token: token,
        user: { id: user.id, email: user.email },
        supabase_url: supabaseUrl || null,
        supabase_anon_key: supabaseAnonKey || null,
        expires_at: Date.now() + (7 * 24 * 60 * 60 * 1000),
        created_at: Date.now()
      };

      await chrome.storage.local.set({ [SESSION_KEY]: session });
      console.log('[YT AI Auth] Session stored for', user.email);

      window.postMessage({ type: 'VIDEOFLOW_AUTH_STORED', success: true }, event.origin);

      chrome.runtime.sendMessage({ type: 'AUTH_SUCCESS', session }).catch(() => {});
    } catch (error) {
      console.error('[YT AI Auth] Error storing session:', error);
      window.postMessage({ type: 'VIDEOFLOW_AUTH_ERROR', error: 'Failed to store session' }, event.origin);
    }
  }
});

window.postMessage({ type: 'VIDEOFLOW_EXTENSION_READY' }, ALLOWED_ORIGIN);
console.log('[YT AI Auth] Ready and listening for auth messages');
