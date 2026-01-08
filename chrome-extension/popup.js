// Import configuration
// Note: Config will be loaded via script tag in popup.html

let supabaseClient = null;

// Initialize Supabase client
async function initSupabase() {
  // Load Supabase from CDN (script loaded in popup.html)
  if (typeof supabase === 'undefined') {
    console.error('[VideoFlow] Supabase not loaded');
    return null;
  }
  
  if (!CONFIG || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    console.error('[VideoFlow] Config not found');
    return null;
  }
  
  if (CONFIG.SUPABASE_URL === 'VOTRE_SUPABASE_URL') {
    showError('Configuration manquante ! Veuillez éditer config.js');
    return null;
  }
  
  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      storage: {
        getItem: async (key) => {
          const result = await chrome.storage.local.get([key]);
          return result[key] || null;
        },
        setItem: async (key, value) => {
          await chrome.storage.local.set({ [key]: value });
        },
        removeItem: async (key) => {
          await chrome.storage.local.remove([key]);
        }
      },
      autoRefreshToken: true,
      persistSession: true
    }
  });
  
  return supabaseClient;
}

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

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[VideoFlow] Popup loaded');
  
  showState('loading-state');
  
  // Initialize Supabase
  const client = await initSupabase();
  if (!client) {
    showState('login-state');
    return;
  }
  
  // Check auth state
  const { data: { session } } = await client.auth.getSession();
  
  if (session) {
    console.log('[VideoFlow] User logged in:', session.user.email);
    await handleLoggedIn();
  } else {
    console.log('[VideoFlow] User not logged in');
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
  if (!supabaseClient) return;
  
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  
  const { data: channels, error } = await supabaseClient
    .from('channels')
    .select('id, name, color')
    .eq('user_id', session.user.id)
    .order('name', { ascending: true });
  
  if (error) {
    console.error('[VideoFlow] Error loading channels:', error);
    return;
  }
  
  const select = document.getElementById('channel-select');
  select.innerHTML = '<option value="">Sans chaîne</option>';
  
  if (channels) {
    channels.forEach(channel => {
      const option = document.createElement('option');
      option.value = channel.id;
      option.textContent = channel.name;
      select.appendChild(option);
    });
  }
  
  console.log('[VideoFlow] Loaded', channels?.length || 0, 'channels');
}

function setupEventListeners() {
  // Login
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('email').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('password').focus();
  });
  document.getElementById('password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  
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

async function handleLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  
  if (!email || !password) {
    showError('Veuillez remplir tous les champs', 'login-error');
    return;
  }
  
  hideError('login-error');
  document.getElementById('login-btn').textContent = 'Connexion...';
  document.getElementById('login-btn').disabled = true;
  
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) throw error;
    
    console.log('[VideoFlow] Login successful');
    await handleLoggedIn();
  } catch (error) {
    console.error('[VideoFlow] Login error:', error);
    showError(error.message || 'Erreur de connexion', 'login-error');
  } finally {
    document.getElementById('login-btn').textContent = 'Se connecter';
    document.getElementById('login-btn').disabled = false;
  }
}

async function handleLogout() {
  if (!supabaseClient) return;
  
  await supabaseClient.auth.signOut();
  await chrome.storage.local.clear();
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
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      throw new Error('Non connecté');
    }
    
    const { data, error } = await supabaseClient
      .from('content_calendar')
      .insert({
        user_id: session.user.id,
        title: title,
        youtube_url: url,
        channel_id: channelId || null,
        scheduled_date: scheduledDate,
        status: 'planned'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    console.log('[VideoFlow] Video added to calendar:', data);
    
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
  const url = CONFIG.CALENDAR_URL || 'https://yourdomain.com/calendar';
  chrome.tabs.create({ url });
}
