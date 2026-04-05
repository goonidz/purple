// YouTube AI Comments - Popup Script

const SESSION_KEY = 'videoflow_session';

const DEFAULT_PROMPT = `Reply briefly to YouTube comments, like a real human would. Include a natural open-ended question when relevant. No dashes. No preamble. Answer only with the comment response. Write in same language as source comment.

Video title: {title}
source comment : {comment}.

Video transcript : {transcript}`;

// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const apiKeySection = document.getElementById('apiKeySection');
const promptTextarea = document.getElementById('promptTemplate');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const toggleKeyBtn = document.getElementById('toggleKey');
const statusDiv = document.getElementById('status');
const statusText = document.getElementById('statusText');

// Auth elements
const authConnected = document.getElementById('authConnected');
const authDisconnected = document.getElementById('authDisconnected');
const authEmail = document.getElementById('authEmail');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

let isVideoFlowConnected = false;

// Load saved settings and auth state
document.addEventListener('DOMContentLoaded', async () => {
  // Load prompt and local API key
  chrome.storage.local.get(['apiKey', 'promptTemplate'], (result) => {
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
    promptTextarea.value = result.promptTemplate || DEFAULT_PROMPT;
  });

  // Check VideoFlow auth
  await checkAuthStatus();
});

async function checkAuthStatus() {
  try {
    const data = await chrome.storage.local.get(SESSION_KEY);
    const session = data[SESSION_KEY];

    if (session && session.access_token) {
      // Check if expired
      if (session.expires_at && Date.now() > session.expires_at) {
        await chrome.storage.local.remove(SESSION_KEY);
        showDisconnected();
        return;
      }

      showConnected(session.user?.email || 'Unknown');
    } else {
      showDisconnected();
    }
  } catch (e) {
    showDisconnected();
  }
}

function showConnected(email) {
  isVideoFlowConnected = true;
  authConnected.classList.remove('hidden');
  authDisconnected.classList.add('hidden');
  authEmail.textContent = email;
  apiKeySection.classList.add('hidden');
}

function showDisconnected() {
  isVideoFlowConnected = false;
  authConnected.classList.add('hidden');
  authDisconnected.classList.remove('hidden');
  authEmail.textContent = '';
  apiKeySection.classList.remove('hidden');
}

// Connect to VideoFlow
connectBtn.addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://purpleai.duckdns.org/auth?extension=true'
  });
});

// Disconnect
disconnectBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(SESSION_KEY);
  showDisconnected();
  showStatus('Disconnected from VideoFlow');
});

// Listen for auth updates from background/content scripts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SESSION_KEY]) {
    if (changes[SESSION_KEY].newValue) {
      const session = changes[SESSION_KEY].newValue;
      showConnected(session.user?.email || 'Unknown');
      showStatus('Connected to VideoFlow!');
    } else {
      showDisconnected();
    }
  }
});

// Toggle API key visibility
toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleKeyBtn.innerHTML = isPassword
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>`;
});

function showStatus(message, isError = false) {
  statusDiv.className = 'status ' + (isError ? 'error' : 'success');
  statusText.textContent = message;
  setTimeout(() => {
    statusDiv.className = 'status';
  }, 3000);
}

function validateSettings() {
  const prompt = promptTextarea.value.trim();

  // Only require API key if not connected to VideoFlow
  if (!isVideoFlowConnected) {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('Please enter your Gemini API key or connect to VideoFlow', true);
      return false;
    }
  }

  if (!prompt) {
    showStatus('Please enter a prompt template', true);
    return false;
  }

  if (!prompt.includes('{comment}')) {
    showStatus('Prompt must include {comment} placeholder', true);
    return false;
  }

  if (!prompt.includes('{transcript}')) {
    showStatus('Prompt should include {transcript} for video context', true);
    return false;
  }

  return true;
}

saveBtn.addEventListener('click', () => {
  if (!validateSettings()) return;

  const settings = {
    promptTemplate: promptTextarea.value.trim()
  };

  // Only save API key if provided (even if connected, keep as fallback)
  const apiKey = apiKeyInput.value.trim();
  if (apiKey) {
    settings.apiKey = apiKey;
  }

  chrome.storage.local.set(settings, () => {
    if (chrome.runtime.lastError) {
      showStatus('Error saving settings: ' + chrome.runtime.lastError.message, true);
    } else {
      showStatus('Settings saved successfully!');
    }
  });
});

resetBtn.addEventListener('click', () => {
  promptTextarea.value = DEFAULT_PROMPT;
  showStatus('Prompt reset to default');
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveBtn.click();
  }
});
