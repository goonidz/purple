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
  const sessionData = await chrome.storage.local.get(SESSION_KEY);
  const session = sessionData[SESSION_KEY];
  
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
  
  // Fill form - leave title empty (will be auto-fetched)
  document.getElementById('video-title').value = '';
  document.getElementById('video-url').value = video.url;
  document.getElementById('scheduled-date').value = new Date().toISOString().split('T')[0];
  
  showState('add-video-form');
}

async function loadChannels() {
  const sessionData = await chrome.storage.local.get(SESSION_KEY);
  const session = sessionData[SESSION_KEY];
  
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
      // Session expirée
      if (response.status === 401) {
        console.error('[VideoFlow] Session expired, clearing storage');
        await chrome.storage.local.remove(SESSION_KEY);
        showError('Session expirée. Veuillez vous reconnecter.', 'add-error');
        setTimeout(() => {
          redirectToAuth();
        }, 2000);
        return;
      }
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to load channels');
    }
    
    const customSelectDisplay = document.getElementById('custom-select-display');
    const customSelectDropdown = document.getElementById('custom-select-dropdown');
    const hiddenInput = document.getElementById('channel-select');
    
    // Store channels for later use
    window.channelsData = result.channels || [];
    
    // Clear dropdown
    customSelectDropdown.innerHTML = '';
    
    // Get default channel from storage
    const { default_channel_id } = await chrome.storage.local.get('default_channel_id');
    
    // Add "Sans chaîne" option
    const noChannelOption = document.createElement('div');
    noChannelOption.className = 'custom-select-option';
    // Only mark as selected if no default channel
    if (!default_channel_id) {
      noChannelOption.classList.add('selected');
    }
    noChannelOption.dataset.value = '';
    noChannelOption.innerHTML = '<span class="channel-color-dot"></span><span class="channel-name">Sans chaîne</span>';
    customSelectDropdown.appendChild(noChannelOption);
    
    // Add channel options with colors
    if (result.channels && result.channels.length > 0) {
      result.channels.forEach(channel => {
        console.log('[VideoFlow] Channel:', channel.name, 'Color:', channel.color);
        
        const option = document.createElement('div');
        option.className = 'custom-select-option';
        option.dataset.value = channel.id;
        option.dataset.color = channel.color || '';
        option.dataset.name = channel.name;
        
        const colorDot = document.createElement('span');
        colorDot.className = 'channel-color-dot';
        if (channel.color) {
          colorDot.style.backgroundColor = channel.color;
          console.log('[VideoFlow] Applied color to', channel.name, ':', channel.color);
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'channel-name';
        nameSpan.textContent = channel.name;
        
        // Add star icon for marking default
        const starIcon = document.createElement('span');
        starIcon.className = 'channel-star';
        starIcon.textContent = '⭐';
        starIcon.title = 'Définir comme chaîne par défaut';
        if (channel.id === default_channel_id) {
          starIcon.classList.add('is-default');
        }
        
        // Handle star click
        starIcon.addEventListener('click', async (e) => {
          e.stopPropagation();
          
          // Toggle default
          if (channel.id === default_channel_id) {
            // Remove default
            await chrome.storage.local.remove('default_channel_id');
            starIcon.classList.remove('is-default');
            console.log('[VideoFlow] Removed default channel');
          } else {
            // Set as default
            await chrome.storage.local.set({ default_channel_id: channel.id });
            // Remove is-default from all other stars
            customSelectDropdown.querySelectorAll('.channel-star').forEach(s => {
              s.classList.remove('is-default');
            });
            starIcon.classList.add('is-default');
            console.log('[VideoFlow] Set default channel:', channel.name);
          }
        });
        
        option.appendChild(colorDot);
        option.appendChild(nameSpan);
        option.appendChild(starIcon);
        customSelectDropdown.appendChild(option);
      });
      
      // Auto-select default channel if exists
      if (default_channel_id) {
        const defaultChannel = result.channels.find(c => c.id === default_channel_id);
        if (defaultChannel) {
          const colorDot = customSelectDisplay.querySelector('.channel-color-dot');
          const nameSpan = customSelectDisplay.querySelector('.channel-name');
          
          if (defaultChannel.color) {
            colorDot.style.backgroundColor = defaultChannel.color;
            colorDot.style.display = 'inline-block';
          }
          nameSpan.textContent = defaultChannel.name;
          hiddenInput.value = defaultChannel.id;
          
          // Update selected state in dropdown
          customSelectDropdown.querySelectorAll('.custom-select-option').forEach(opt => {
            if (opt.dataset.value === defaultChannel.id) {
              opt.classList.add('selected');
            } else {
              opt.classList.remove('selected');
            }
          });
          
          console.log('[VideoFlow] Auto-selected default channel:', defaultChannel.name);
        }
      }
    }
    
    // Toggle dropdown
    customSelectDisplay.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = customSelectDropdown.style.display === 'block';
      customSelectDropdown.style.display = isOpen ? 'none' : 'block';
      customSelectDisplay.classList.toggle('active', !isOpen);
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      customSelectDropdown.style.display = 'none';
      customSelectDisplay.classList.remove('active');
    });
    
    // Handle option selection
    customSelectDropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.custom-select-option');
      if (!option) return;
      
      // Update selected state
      customSelectDropdown.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      option.classList.add('selected');
      
      // Update display
      const colorDot = customSelectDisplay.querySelector('.channel-color-dot');
      const nameSpan = customSelectDisplay.querySelector('.channel-name');
      const color = option.dataset.color;
      const name = option.dataset.name || 'Sans chaîne';
      
      if (color) {
        colorDot.style.backgroundColor = color;
        colorDot.style.display = 'inline-block';
      } else {
        colorDot.style.backgroundColor = 'transparent';
        colorDot.style.display = 'none';
      }
      nameSpan.textContent = name;
      
      // Update hidden input
      hiddenInput.value = option.dataset.value;
      
      // Close dropdown
      customSelectDropdown.style.display = 'none';
      customSelectDisplay.classList.remove('active');
    });
    
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
    const sessionData = await chrome.storage.local.get(SESSION_KEY);
    const session = sessionData[SESSION_KEY];
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
  
  if (!url || !scheduledDate) {
    showError('Veuillez sélectionner une date', 'add-error');
    return;
  }
  
  hideError('add-error');
  document.getElementById('add-btn').textContent = 'Ajout...';
  document.getElementById('add-btn').disabled = true;
  
  try {
    const sessionData = await chrome.storage.local.get(SESSION_KEY);
    const session = sessionData[SESSION_KEY];
    
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
      // Session expirée
      if (response.status === 401) {
        console.error('[VideoFlow] Session expired during add video');
        await chrome.storage.local.remove(SESSION_KEY);
        throw new Error('Session expirée. Reconnectez-vous et réessayez.');
      }
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
