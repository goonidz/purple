// API URLs for Supabase Edge Functions
const API_BASE_URL = 'https://laqgmqyjstisipsbljha.supabase.co/functions/v1';
const ADD_CALENDAR_ENTRY_URL = `${API_BASE_URL}/add-calendar-entry`;
const GET_USER_CHANNELS_URL = `${API_BASE_URL}/get-user-channels`;
const AUTH_PAGE_URL = 'https://purpleai.duckdns.org/auth';
const CALENDAR_URL = 'https://purpleai.duckdns.org/calendar';

// Session storage key
const SESSION_KEY = 'videoflow_session';

// Show/hide states
function showState(stateId) {
  document.querySelectorAll('.state').forEach(el => el.style.display = 'none');
  const state = document.getElementById(stateId);
  if (state) {
    state.style.display = 'block';
  }
}

function showError(message, elementId = 'login-error') {
  const errorEl = document.getElementById(elementId);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

function hideError(elementId = 'login-error') {
  const errorEl = document.getElementById(elementId);
  if (errorEl) {
    errorEl.style.display = 'none';
  }
}

// Listen for auth success messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[VideoFlow Popup] Received message:', message);
  
  if (message.type === 'AUTH_SUCCESS') {
    console.log('[VideoFlow Popup] Auth success received, refreshing popup');
    
    // Refresh the popup to show logged in state
    handleLoggedIn().then(() => {
      toast.success('Connexion réussie !');
    });
    
    sendResponse({ received: true });
  }
  
  return true; // Keep channel open for async response
});

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[VideoFlow] Popup loaded');
  
  showState('loading-state');
  
  // Check if user is logged in
  const result = await chrome.storage.local.get(SESSION_KEY);
  const session = result[SESSION_KEY];
  
  if (session && session.access_token) {
    console.log('[VideoFlow] User has session token');
    await handleLoggedIn();
  } else {
    console.log('[VideoFlow] No session found');
    showState('login-state');
  }
  
  // Setup event listeners
  setupEventListeners();
});

async function handleLoggedIn() {
  // Check if there's a pending video
  const { pendingVideo } = await chrome.storage.local.get('pendingVideo');
  
  if (pendingVideo) {
    console.log('[VideoFlow] Found pending video:', pendingVideo);
    await showAddVideoForm(pendingVideo);
  } else {
    console.log('[VideoFlow] No pending video, showing default view');
    showState('default-view');
  }
}

async function showAddVideoForm(video) {
  // Load channels
  await loadChannels();
  
  // Fill form
  document.getElementById('video-title').value = video.title || '';
  document.getElementById('video-url').value = video.url;
  document.getElementById('scheduled-date').value = new Date().toISOString().split('T')[0];
  
  showState('add-video-form');
}

async function loadChannels() {
  const result = await chrome.storage.local.get(SESSION_KEY);
  const session = result[SESSION_KEY];
  
  if (!session || !session.access_token) {
    console.error('[VideoFlow] No session token for loading channels');
    return;
  }
  
  try {
    const response = await fetch(GET_USER_CHANNELS_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to load channels');
    }
    
    const select = document.getElementById('channel-select');
    select.innerHTML = '<option value="">Sans chaîne</option>';
    
    if (result.channels && result.channels.length > 0) {
      result.channels.forEach(channel => {
        const option = document.createElement('option');
        option.value = channel.id;
        option.textContent = channel.name;
        select.appendChild(option);
      });
    }
    
    console.log('[VideoFlow] Loaded', result.channels?.length || 0, 'channels');
  } catch (error) {
    console.error('[VideoFlow] Error loading channels:', error);
    showError('Erreur lors du chargement des chaînes', 'add-error');
  }
}

function setupEventListeners() {
  // Login (redirect to auth page)
  document.getElementById('login-btn').addEventListener('click', redirectToAuth);
  
  // Logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  
  // Add video
  document.getElementById('add-btn').addEventListener('click', handleAddVideo);
  document.getElementById('cancel-btn').addEventListener('click', handleCancel);
  
  // Open calendar
  document.getElementById('open-calendar-btn').addEventListener('click', openCalendar);
  document.getElementById('open-calendar-btn-default').addEventListener('click', openCalendar);
  
  // Close
  document.getElementById('close-btn').addEventListener('click', () => window.close());
}

function redirectToAuth() {
  // Open the auth page with a flag indicating it's from the extension
  chrome.tabs.create({ 
    url: `${AUTH_PAGE_URL}?extension=true&return=popup` 
  });
  
  // Show message to user with auto-detection
  document.getElementById('login-state').innerHTML = `
    <div class="header">
      <h2>VideoFlow</h2>
    </div>
    <div class="info-text">
      <p>Connectez-vous dans l'onglet qui vient de s'ouvrir.</p>
      <p class="text-sm text-muted-foreground mt-2">La connexion sera détectée automatiquement...</p>
    </div>
    <div class="spinner"></div>
  `;
  
  // Auto-check for session every 2 seconds
  const checkInterval = setInterval(async () => {
    const result = await chrome.storage.local.get(SESSION_KEY);
    const session = result[SESSION_KEY];
    if (session && session.access_token) {
      clearInterval(checkInterval);
      showState('loading-state');
      await handleLoggedIn();
      console.log('[VideoFlow] Auto-detected successful login');
    }
  }, 2000);
  
  // Stop checking after 5 minutes
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 5 * 60 * 1000);
}

async function handleLogout() {
  await chrome.storage.local.remove(SESSION_KEY);
  await chrome.storage.local.remove('pendingVideo');
  console.log('[VideoFlow] Logged out');
  showState('login-state');
}

async function handleAddVideo() {
  const title = document.getElementById('video-title').value.trim();
  const url = document.getElementById('video-url').value.trim();
  const channelId = document.getElementById('channel-select').value;
  const scheduledDate = document.getElementById('scheduled-date').value;
  
  if (!title || !url || !scheduledDate) {
    showError('Veuillez remplir tous les champs', 'add-error');
    return;
  }
  
  hideError('add-error');
  document.getElementById('add-btn').textContent = 'Ajout...';
  document.getElementById('add-btn').disabled = true;
  
  try {
    const result = await chrome.storage.local.get(SESSION_KEY);
    const session = result[SESSION_KEY];
    
    if (!session || !session.access_token) {
      throw new Error('Session expirée. Veuillez vous reconnecter.');
    }
    
    const response = await fetch(ADD_CALENDAR_ENTRY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        youtube_url: url,
        channel_id: channelId || null,
        scheduled_date: scheduledDate
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Erreur lors de l\'ajout');
    }
    
    console.log('[VideoFlow] Video added to calendar:', result.data);
    
    // Clear pending video
    await chrome.storage.local.remove('pendingVideo');
    
    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'VideoFlow ✅',
      message: `"${title}" ajouté au calendrier`
    });
    
    // Show success state
    showState('success-state');
  } catch (error) {
    console.error('[VideoFlow] Error adding video:', error);
    showError(error.message || 'Erreur lors de l\'ajout', 'add-error');
  } finally {
    document.getElementById('add-btn').textContent = 'Ajouter';
    document.getElementById('add-btn').disabled = false;
  }
}

async function handleCancel() {
  await chrome.storage.local.remove('pendingVideo');
  showState('default-view');
}

function openCalendar() {
  chrome.tabs.create({ url: CALENDAR_URL });
}
