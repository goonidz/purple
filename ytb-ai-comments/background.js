// YouTube AI Comments - Background Service Worker
// Handles transcript fetching and API key retrieval via VideoFlow/Supabase

const SUPABASE_URL = 'https://laqgmqyjstisipsbljha.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY';
const SESSION_KEY = 'videoflow_session';

// Personal-use fallback Gemini key. Used when no VideoFlow session and no
// popup-stored key (typical case on fresh AdsPower profiles where the user
// is not logged into VideoFlow). Anyone with access to the unpacked
// extension can read this key — keep this extension private.
const HARDCODED_GEMINI_KEY = 'AIzaSyDxQ4hNrrbU7T-vRQtjWo91QE3mTVXmNjs';

// Shared-secret API for fetching transcripts WITHOUT a VideoFlow login.
// Server-side endpoint lives in video-render-service (route /api/extension/
// via nginx). Same caveat as the Gemini key: anyone unpacking the
// extension can read this token, so the endpoint only returns whitelisted
// fields (title/script/notes) and the token can be rotated server-side to
// invalidate every extension copy.
//
// Backend implementation: video-render-service/server.js, route
// /extension/transcript. Documentation: docs/EXTENSION_TRANSCRIPT_API.md
const EXTENSION_API_BASE = 'https://purpleai.duckdns.org/api/extension';
const EXTENSION_API_TOKEN = '0aaf47d93848683737dcd2f75624a8b92e2109ee6eb73a20babeb9dbfb51b721';

// In-memory transcript cache (cleared when service worker restarts)
const transcriptCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TRANSCRIPT') {
    handleGetTranscript(message.videoId).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_API_KEYS') {
    handleGetApiKeys().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_VIDEO_CONTEXT') {
    handleGetVideoContext(message.videoId).then(sendResponse);
    return true;
  }

  if (message.type === 'AUTH_SUCCESS') {
    return false;
  }
});

// --- Transcript fetching ---

async function handleGetTranscript(videoId) {
  if (!videoId) return { success: false, error: 'No videoId' };

  if (transcriptCache.has(videoId)) {
    return { success: true, transcript: transcriptCache.get(videoId) };
  }

  try {
    const transcript = await fetchTranscriptFromYouTube(videoId);
    if (transcript) {
      transcriptCache.set(videoId, transcript);
      return { success: true, transcript };
    }
    return { success: false, error: 'No captions found for this video' };
  } catch (e) {
    console.error('[YT AI BG] Transcript fetch error:', e.message);
    return { success: false, error: e.message };
  }
}

async function fetchCaptionsViaInnertube(videoId) {
  const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20260401.00.00'
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20260401.00.00',
          hl: 'en',
          gl: 'US'
        }
      }
    })
  });

  if (!resp.ok) throw new Error(`Innertube API returned ${resp.status}`);
  const data = await resp.json();

  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    // Log playability status for debugging
    const status = data?.playabilityStatus;
    console.log('[YT AI BG] Innertube: no captions for', videoId,
      '| playability:', status?.status,
      '| reason:', status?.reason || 'none');
    return null;
  }
  console.log('[YT AI BG] Innertube: found', tracks.length, 'caption tracks for', videoId);
  return tracks;
}

async function fetchCaptionsViaPageScrape(videoId) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const resp = await fetch(pageUrl, {
    headers: { 'Accept-Language': 'en' }
  });
  if (!resp.ok) throw new Error(`YouTube page fetch failed: ${resp.status}`);

  const html = await resp.text();
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!match) throw new Error('Could not find ytInitialPlayerResponse');

  const playerResponse = JSON.parse(match[1]);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) return null;
  console.log('[YT AI BG] Page scrape: found', tracks.length, 'caption tracks');
  return tracks;
}

async function fetchTranscriptFromYouTube(videoId) {
  // Try innertube API first (more reliable, no cookies needed)
  let captionTracks = null;
  try {
    captionTracks = await fetchCaptionsViaInnertube(videoId);
  } catch (e) {
    console.warn('[YT AI BG] Innertube failed, trying page scrape:', e.message);
  }

  // Fallback: scrape watch page
  if (!captionTracks) {
    try {
      captionTracks = await fetchCaptionsViaPageScrape(videoId);
    } catch (e) {
      console.warn('[YT AI BG] Page scrape also failed:', e.message);
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    return null;
  }

  // Prefer manual captions, then auto-generated; prefer video language, then English
  let track = captionTracks.find(t => t.kind !== 'asr')
    || captionTracks.find(t => t.languageCode === 'en')
    || captionTracks[0];

  const trackUrl = track.baseUrl;

  // Try json3 first, fall back to XML
  let fullText = '';
  try {
    const json3Url = trackUrl + (trackUrl.includes('fmt=') ? '' : '&fmt=json3');
    const jsonResp = await fetch(json3Url);
    if (jsonResp.ok) {
      const text = await jsonResp.text();
      if (text && text.startsWith('{')) {
        const trackData = JSON.parse(text);
        const segments = [];
        for (const event of (trackData.events || [])) {
          if (event.segs) {
            for (const seg of event.segs) {
              const t = seg.utf8?.trim();
              if (t && t !== '\n') segments.push(t);
            }
          }
        }
        fullText = segments.join(' ');
      }
    }
  } catch (e) {
    console.warn('[YT AI BG] json3 parse failed, trying XML:', e.message);
  }

  // Fallback: fetch default XML format
  if (!fullText) {
    const xmlResp = await fetch(trackUrl);
    if (!xmlResp.ok) throw new Error(`Caption track fetch failed: ${xmlResp.status}`);
    const xmlText = await xmlResp.text();
    // Parse XML: extract text from <text> elements
    const textMatches = xmlText.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [];
    const segments = textMatches.map(m => {
      const inner = m.replace(/<[^>]+>/g, '').trim();
      // Decode HTML entities
      return inner
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
    }).filter(t => t.length > 0);
    fullText = segments.join(' ');
  }

  fullText = fullText.replace(/\s+/g, ' ').trim();

  // Truncate to ~4000 chars to stay within token limits
  const maxLen = 4000;
  if (fullText.length > maxLen) {
    return fullText.substring(0, maxLen) + '... [transcript truncated]';
  }
  return fullText || null;
}

// --- VideoFlow video context lookup ---

// Path A: logged-in user — hits Supabase REST directly with their JWT.
async function fetchVideoContextViaSession(videoId) {
  const data = await chrome.storage.local.get(SESSION_KEY);
  const session = data[SESSION_KEY];
  if (!session?.access_token) return null;

  const supabaseUrl = session.supabase_url || SUPABASE_URL;
  const anonKey = session.supabase_anon_key || SUPABASE_ANON_KEY;
  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${session.access_token}`
  };

  const calResp = await fetch(
    `${supabaseUrl}/rest/v1/content_calendar?youtube_url=ilike.*${videoId}*&select=title,notes,script,project_id&limit=1`,
    { headers }
  );
  if (!calResp.ok) return null;
  const rows = await calResp.json();
  if (!rows.length) return null;

  const entry = rows[0];
  let script = entry.script || null;
  if (entry.project_id && !script) {
    const projResp = await fetch(
      `${supabaseUrl}/rest/v1/projects?id=eq.${entry.project_id}&select=name,script,summary&limit=1`,
      { headers }
    );
    if (projResp.ok) {
      const projRows = await projResp.json();
      if (projRows.length > 0) {
        const proj = projRows[0];
        script = proj.script || proj.summary || null;
      }
    }
  }
  return {
    source: 'content_calendar (session)',
    title: entry.title || null,
    notes: entry.notes || null,
    script
  };
}

// Path B: no login — hits the shared-secret API on the VPS, which uses
// the service role server-side and only returns whitelisted fields.
// Used on AdsPower profiles that aren't signed into VideoFlow.
async function fetchVideoContextViaSharedToken(videoId) {
  const resp = await fetch(
    `${EXTENSION_API_BASE}/transcript?videoId=${encodeURIComponent(videoId)}`,
    { headers: { 'X-Extension-Token': EXTENSION_API_TOKEN } }
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    console.warn(`[YT AI BG] Shared-token API returned ${resp.status}`);
    return null;
  }
  const data = await resp.json();
  return {
    source: 'content_calendar (shared-token)',
    title: data.title || null,
    notes: data.notes || null,
    script: data.script || null
  };
}

async function handleGetVideoContext(videoId) {
  if (!videoId) return { success: false };

  // Try the logged-in path first (preserves per-user RLS scoping for users
  // who ARE signed into purpleai.duckdns.org via the auth bridge).
  try {
    const result = await fetchVideoContextViaSession(videoId);
    if (result) {
      console.log('[YT AI BG] Got context via VideoFlow session:', result.title, '| script:', result.script ? result.script.length + 'c' : 'null');
      return { success: true, ...result };
    }
  } catch (e) {
    console.warn('[YT AI BG] Session lookup failed:', e.message);
  }

  // Fallback: shared-secret API (works without any login on AdsPower).
  try {
    const result = await fetchVideoContextViaSharedToken(videoId);
    if (result) {
      console.log('[YT AI BG] Got context via shared-token API:', result.title, '| script:', result.script ? result.script.length + 'c' : 'null');
      return { success: true, ...result };
    }
  } catch (e) {
    console.warn('[YT AI BG] Shared-token lookup failed:', e.message);
  }

  console.log('[YT AI BG] Video not found in VideoFlow DB for', videoId);
  return { success: false };
}

// --- API key retrieval via VideoFlow/Supabase ---

async function handleGetApiKeys() {
  // First try VideoFlow session
  try {
    const data = await chrome.storage.local.get(SESSION_KEY);
    const session = data[SESSION_KEY];

    if (session && session.access_token) {
      if (session.expires_at && Date.now() > session.expires_at) {
        return { success: false, error: 'VideoFlow session expired' };
      }

      const supabaseUrl = session.supabase_url || SUPABASE_URL;
      const anonKey = session.supabase_anon_key || SUPABASE_ANON_KEY;

      const geminiKey = await fetchApiKeyFromVault(supabaseUrl, anonKey, session.access_token, 'gemini');
      if (geminiKey) {
        return { success: true, source: 'videoflow', geminiKey };
      }
    }
  } catch (e) {
    console.warn('[YT AI BG] VideoFlow key fetch failed:', e.message);
  }

  // Fallback: locally stored key from popup
  try {
    const data = await chrome.storage.local.get('apiKey');
    if (data.apiKey) {
      return { success: true, source: 'local', geminiKey: data.apiKey };
    }
  } catch {}

  // Last-resort fallback: hardcoded personal key (works on fresh profiles
  // without any VideoFlow login or popup configuration).
  if (HARDCODED_GEMINI_KEY) {
    return { success: true, source: 'hardcoded', geminiKey: HARDCODED_GEMINI_KEY };
  }

  return { success: false, error: 'No API key configured. Connect to VideoFlow or set key in extension settings.' };
}

async function fetchApiKeyFromVault(supabaseUrl, anonKey, accessToken, keyName) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/get_user_api_key`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ key_name: keyName })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase RPC error (${resp.status}): ${text}`);
  }

  const value = await resp.json();
  return value || null;
}
