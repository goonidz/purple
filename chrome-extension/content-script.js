// Content script for VideoFlow Chrome Extension
// Listens for authentication messages from the web page

const ALLOWED_ORIGIN = 'https://purpleai.duckdns.org';
const SESSION_KEY = 'videoflow_session';

console.log('[VideoFlow Content Script] Loaded on:', window.location.href);

// Listen for messages from the web page
window.addEventListener('message', async (event) => {
  console.log('[VideoFlow Content Script] Received message:', {
    origin: event.origin,
    type: event.data?.type
  });

  // Security: Verify the origin
  if (event.origin !== ALLOWED_ORIGIN) {
    console.warn('[VideoFlow Content Script] Rejected message from unauthorized origin:', event.origin);
    return;
  }

  // Check if this is an auth success message
  if (event.data?.type === 'VIDEOFLOW_AUTH_SUCCESS') {
    console.log('[VideoFlow Content Script] Auth success message received');

    const { token, user } = event.data;

    // Validate token format (basic JWT check)
    if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
      console.error('[VideoFlow Content Script] Invalid token format');
      
      // Send error back to page
      window.postMessage({
        type: 'VIDEOFLOW_AUTH_ERROR',
        error: 'Invalid token format'
      }, event.origin);
      
      return;
    }

    // Validate user data
    if (!user || !user.id || !user.email) {
      console.error('[VideoFlow Content Script] Invalid user data');
      
      window.postMessage({
        type: 'VIDEOFLOW_AUTH_ERROR',
        error: 'Invalid user data'
      }, event.origin);
      
      return;
    }

    try {
      // Store session in chrome.storage.local
      const session = {
        access_token: token,
        user: {
          id: user.id,
          email: user.email
        },
        expires_at: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        created_at: Date.now()
      };

      await chrome.storage.local.set({ [SESSION_KEY]: session });
      
      console.log('[VideoFlow Content Script] Session stored successfully');

      // Send confirmation back to the page
      window.postMessage({
        type: 'VIDEOFLOW_AUTH_STORED',
        success: true
      }, event.origin);

      // Notify the extension popup (if open)
      chrome.runtime.sendMessage({
        type: 'AUTH_SUCCESS',
        session
      }).catch(() => {
        // Popup might not be open, that's fine
        console.log('[VideoFlow Content Script] Popup not open, session stored anyway');
      });

    } catch (error) {
      console.error('[VideoFlow Content Script] Error storing session:', error);
      
      window.postMessage({
        type: 'VIDEOFLOW_AUTH_ERROR',
        error: 'Failed to store session'
      }, event.origin);
    }
  }
});

// Notify the page that the content script is ready
window.postMessage({
  type: 'VIDEOFLOW_EXTENSION_READY'
}, ALLOWED_ORIGIN);

console.log('[VideoFlow Content Script] Ready and listening for auth messages');
