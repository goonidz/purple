// YouTube AI Comments - Content Script
// Injects AI reply buttons next to YouTube comments

(function() {
  'use strict';

  const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  const DEFAULT_PROMPT = `Reply briefly to YouTube comments, like a real human would. Include a natural open-ended question when relevant. No dashes. No preamble. Answer only with the comment response. Write in same language as source comment.

Your question must never be about what they liked / what was the best part etc.. as I answer later, they will have forget. More perosnnal questions related to topic.

Video title: {title}
source comment : {comment}.

Video transcript : {transcript}`;

  const processedComments = new WeakSet();

  // Track which videoIds have a loaded transcript
  const transcriptStatus = new Map();

  const isYouTubeStudio = window.location.hostname === 'studio.youtube.com';

  // Deep querySelector that pierces through Shadow DOM boundaries
  function deepQuerySelector(root, selector) {
    const result = root.querySelector(selector);
    if (result) return result;
    // Try piercing into shadow roots
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        const found = deepQuerySelector(el.shadowRoot, selector);
        if (found) return found;
      }
    }
    return null;
  }

  function getVideoId(commentElement = null) {
    if (!isYouTubeStudio) {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('v');
    }

    if (commentElement) {
      // Walk up to the outermost comment container (including the wrapping div)
      const row = commentElement.closest('.ytcp-comment-thread, ytcp-comment-thread')
        || commentElement;

      // 1. Look for thumbnail img with ytimg.com/vi/VIDEO_ID (most reliable in Studio)
      const thumbImg = deepQuerySelector(row, 'img[src*="ytimg.com/vi/"]');
      if (thumbImg) {
        const srcMatch = thumbImg.src.match(/\/vi\/([^\/]+)/);
        if (srcMatch) {
          console.log('[YT AI] Found videoId from thumbnail:', srcMatch[1]);
          return srcMatch[1];
        }
      }

      // 2. Look for anchor links to /video/ID
      const videoLink = deepQuerySelector(row, 'a[href*="/video/"], a[href*="watch?v="]');
      if (videoLink) {
        const href = videoLink.getAttribute('href');
        const match = href.match(/\/video\/([^\/\?]+)|watch\?v=([^&]+)/);
        if (match) return match[1] || match[2];
      }

      // 3. Walk up even further to the parent div wrapper
      const outerDiv = row.parentElement?.closest('.ytcp-comment-thread, [class*="comment-section"]');
      if (outerDiv && outerDiv !== row) {
        const img = deepQuerySelector(outerDiv, 'img[src*="ytimg.com/vi/"]');
        if (img) {
          const srcMatch = img.src.match(/\/vi\/([^\/]+)/);
          if (srcMatch) return srcMatch[1];
        }
      }

      console.log('[YT AI] Could not find videoId in comment element. Tag:', row.tagName, 'Classes:', row.className?.substring?.(0, 80));
    }

    // Studio: extract video ID from URL path
    const urlMatch = window.location.pathname.match(/\/video\/([^\/]+)/);
    if (urlMatch) return urlMatch[1];

    return null;
  }

  function getVideoTitle(commentElement = null) {
    if (isYouTubeStudio && commentElement) {
      const row = commentElement.closest('.ytcp-comment-thread, ytcp-comment-thread') || commentElement;
      // Studio: title is in #video-title inside ytcp-comment-video-thumbnail
      const titleEl = row.querySelector('#video-title yt-formatted-string, #video-title');
      if (titleEl) return titleEl.textContent?.trim() || null;
    }
    // Regular YouTube: use page title
    const pageTitle = document.title?.replace(/ - YouTube$/, '').trim();
    return pageTitle || null;
  }

  // Fetch transcript via background service worker
  async function getTranscript(commentElement = null) {
    const videoId = getVideoId(commentElement);
    if (!videoId) {
      console.log('[YT AI] No videoId found');
      return null;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TRANSCRIPT',
        videoId
      });

      if (response?.success) {
        transcriptStatus.set(videoId, true);
        updateTranscriptIndicators(videoId, true);
        return response.transcript;
      } else {
        console.log('[YT AI] Transcript not available:', response?.error);
        transcriptStatus.set(videoId, false);
        updateTranscriptIndicators(videoId, false);
        return null;
      }
    } catch (e) {
      console.error('[YT AI] Error requesting transcript:', e.message);
      return null;
    }
  }

  // Resolve prompt template and the API path to use.
  //
  // `apiKey === null` is now a valid result and means "use the VPS proxy"
  // (no client-side key needed). generateReply() handles both cases.
  // Priority:
  //  1. VideoFlow session (per-user Gemini key from Vault, source='videoflow')
  //  2. Local key stored via the popup (source='local')
  //  3. VPS proxy (source='vps-proxy', apiKey=null) — default for AdsPower
  //     profiles that aren't logged into VideoFlow.
  async function getPromptTemplate() {
    if (!isExtensionContextValid()) {
      throw new Error('Extension was updated. Please refresh the page.');
    }

    let promptTemplate = DEFAULT_PROMPT;
    try {
      const localData = await new Promise(resolve => {
        chrome.storage.local.get(['promptTemplate'], result => resolve(result));
      });
      if (localData.promptTemplate) promptTemplate = localData.promptTemplate;
    } catch {}

    // Try VideoFlow keys / proxy decision via background worker
    try {
      const keysResponse = await chrome.runtime.sendMessage({ type: 'GET_API_KEYS' });
      if (keysResponse?.success) {
        return {
          prompt: promptTemplate,
          apiKey: keysResponse.geminiKey || null,
          source: keysResponse.source || 'vps-proxy',
        };
      }
    } catch (e) {
      console.warn('[YT AI] Background key fetch failed:', e.message);
    }

    // Hard fallback to locally stored key (popup) — only reached if the
    // background worker itself errored out.
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['apiKey'], (result) => {
          resolve({
            prompt: promptTemplate,
            apiKey: result.apiKey || null,
            source: result.apiKey ? 'local' : 'vps-proxy',
          });
        });
      } catch {
        resolve({ prompt: promptTemplate, apiKey: null, source: 'vps-proxy' });
      }
    });
  }

  // --- Transcript indicator ---

  function updateTranscriptIndicators(videoId, available) {
    document.querySelectorAll(`.ytb-ai-transcript-icon[data-video-id="${videoId}"]`).forEach(icon => {
      icon.classList.toggle('ytb-ai-transcript-ok', available);
      icon.classList.toggle('ytb-ai-transcript-none', !available);
      icon.title = available ? 'Transcript loaded' : 'No transcript available';
    });
  }

  function createTranscriptIcon(videoId) {
    const icon = document.createElement('span');
    icon.className = 'ytb-ai-transcript-icon';
    icon.setAttribute('data-video-id', videoId || '');
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
    </svg>`;

    const status = transcriptStatus.get(videoId);
    if (status === true) {
      icon.classList.add('ytb-ai-transcript-ok');
      icon.title = 'Transcript loaded';
    } else if (status === false) {
      icon.classList.add('ytb-ai-transcript-none');
      icon.title = 'No transcript available';
    } else {
      icon.classList.add('ytb-ai-transcript-none');
      icon.title = 'Transcript not yet loaded';
    }

    return icon;
  }

  // --- UI components ---

  function createAIButton(forStudio = false) {
    const button = document.createElement('button');
    button.className = 'ytb-ai-comment-btn' + (forStudio ? ' ytb-ai-studio-btn' : '');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
    `;
    button.title = 'Generate AI Reply';
    return button;
  }

  function createSpinner() {
    const spinner = document.createElement('div');
    spinner.className = 'ytb-ai-spinner';
    return spinner;
  }

  function isExtensionContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // --- Gemini API ---
  //
  // Two paths:
  //  - apiKey provided → direct call to Google (used when the user has a
  //    personal key via VideoFlow or the popup).
  //  - apiKey null/empty → relay through the VPS proxy (default), which
  //    holds the API key server-side. This is the path used on AdsPower
  //    profiles that aren't signed into VideoFlow.
  async function generateReply(commentText, apiKey, promptTemplate, transcript, title) {
    let prompt = promptTemplate.replace('{comment}', commentText);
    prompt = prompt.replace('{title}', title || '(Unknown)');
    prompt = prompt.replace('{transcript}', transcript || '(No transcript available)');

    if (!apiKey) {
      // Proxy path — background worker calls /api/extension/generate.
      const resp = await chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', prompt });
      if (!resp?.success) {
        throw new Error(resp?.error || 'Proxy request failed');
      }
      if (resp.finishReason && resp.finishReason !== 'STOP') {
        console.warn('[YT AI] Unexpected finish reason (proxy):', resp.finishReason);
      }
      return resp.text || '';
    }

    // Direct path — user has a personal Gemini key.
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          stopSequences: []
        }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn('[YT AI] Unexpected finish reason:', finishReason);
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // --- Reply insertion ---

  function openReplyBox(commentElement) {
    const replyButton = commentElement.querySelector('#reply-button-end button, [aria-label="Reply"], ytd-button-renderer#reply-button-end button');
    if (replyButton) {
      replyButton.click();
      return true;
    }
    return false;
  }

  function insertReplyText(commentElement, text) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const replyBox = commentElement.querySelector('#contenteditable-root, [contenteditable="true"]');
        if (replyBox) {
          clearInterval(checkInterval);

          replyBox.focus();
          replyBox.innerHTML = '';
          document.execCommand('insertText', false, text);

          if (!replyBox.textContent || replyBox.textContent.length < text.length / 2) {
            replyBox.textContent = text;
            replyBox.dispatchEvent(new Event('focus', { bubbles: true }));
            replyBox.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: text
            }));
            replyBox.dispatchEvent(new Event('change', { bubbles: true }));
          }

          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(replyBox);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);

          resolve(true);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 5000);
    });
  }

  async function handleStudioReply(commentElement, text) {
    let replyButton = commentElement.querySelector(
      'button[aria-label*="Reply"], button[aria-label*="reply"], .reply-button, ytcp-button[id*="reply"], button.reply-button'
    );

    if (!replyButton) {
      const buttons = commentElement.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.trim().toLowerCase() === 'reply') {
          btn.click();
          break;
        }
      }
    } else {
      replyButton.click();
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const replyInput = document.querySelector(
      'textarea[placeholder*="reply" i], textarea[placeholder*="Reply" i], [contenteditable="true"], ytcp-comment-reply-dialog textarea, .reply-dialog textarea, textarea'
    );

    if (replyInput) {
      replyInput.focus();
      replyInput.value = text;
      replyInput.dispatchEvent(new Event('input', { bubbles: true }));
      replyInput.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }

  // --- AI button click handler ---

  async function handleAIButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    let commentElement, commentText;

    if (isYouTubeStudio) {
      commentElement = button.closest('ytcp-comment-thread');
      if (!commentElement) commentElement = button.closest('ytcp-comment-row, [class*="comment-row"], tr');
      if (!commentElement) commentElement = button.closest('.comment-item, [class*="comment"]');

      if (!commentElement) {
        console.error('[YT AI] Could not find Studio comment element');
        return;
      }

      const textSelectors = [
        '#body #main #content', '#content', '#main #content',
        '.ytcp-comment-view-model__main-comment', '.ytcp-comment-view-model__comment-content',
        '[id="content"]', 'yt-formatted-string#content', '#comment-content', '.comment-text'
      ];

      for (const selector of textSelectors) {
        const el = commentElement.querySelector(selector);
        if (el) {
          const text = el.textContent?.trim();
          if (text && text.length > 5) {
            commentText = text;
            break;
          }
        }
      }

      if (!commentText) {
        const allElements = commentElement.querySelectorAll('span, div, p, yt-formatted-string, #plain-text');
        for (const el of allElements) {
          const text = el.textContent?.trim();
          if (text && text.length > 15 &&
            !text.includes('subscriber') && !text.includes('Reply') && !text.includes('replies') &&
            !text.match(/^\d+ (day|hour|minute|week|month|year)s? ago$/) && !text.startsWith('@')) {
            commentText = text;
            break;
          }
        }
      }

      if (!commentText) {
        const textBlocks = [];
        const walker = document.createTreeWalker(commentElement, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent.trim();
          if (text.length > 10) textBlocks.push(text);
        }
        textBlocks.sort((a, b) => b.length - a.length);
        for (const text of textBlocks) {
          if (!text.includes('subscriber') && !text.includes('@') && text.length > 20) {
            commentText = text;
            break;
          }
        }
      }
    } else {
      commentElement = button.closest('ytd-comment-thread-renderer, ytd-comment-renderer');
      if (!commentElement) {
        console.error('[YT AI] Could not find comment element');
        return;
      }
      const commentTextElement = commentElement.querySelector('#content-text, .yt-core-attributed-string');
      commentText = commentTextElement?.textContent?.trim();
    }

    if (!commentText) {
      alert('Could not extract comment text');
      return;
    }

    const originalContent = button.innerHTML;
    button.innerHTML = '';
    button.appendChild(createSpinner());
    button.disabled = true;

    try {
      const { prompt, apiKey } = await getPromptTemplate();

      let transcript = null;
      let videoTitle = getVideoTitle(commentElement);
      const videoId = getVideoId(commentElement);

      // 1. Search VideoFlow DB first (has the actual script written for the video)
      if (videoId) {
        try {
          const vfContext = await chrome.runtime.sendMessage({ type: 'GET_VIDEO_CONTEXT', videoId });
          if (vfContext?.success) {
            console.log('[YT AI] VideoFlow context found:', vfContext.source);
            if (vfContext.script) {
              transcript = vfContext.script;
              console.log('[YT AI] Using VideoFlow script:', transcript.length, 'chars');
            }
            if (vfContext.title) {
              videoTitle = vfContext.title;
            }
          }
        } catch (e) {
          console.warn('[YT AI] VideoFlow context lookup failed:', e.message);
        }
      }

      // 2. Fallback: get transcript from YouTube
      if (!transcript) {
        transcript = await getTranscript(commentElement);
      }

      if (transcript) {
        console.log('[YT AI] Transcript loaded:', transcript.length, 'chars');
      } else {
        console.log('[YT AI] No transcript available');
      }
      if (videoTitle) {
        console.log('[YT AI] Video title:', videoTitle);
      }

      const reply = await generateReply(commentText, apiKey, prompt, transcript, videoTitle);

      if (!reply) throw new Error('Empty response from API');

      if (isYouTubeStudio) {
        const inserted = await handleStudioReply(commentElement, reply.trim());
        if (!inserted) {
          await navigator.clipboard.writeText(reply.trim());
          alert('Reply copied to clipboard! Paste it in the reply box.');
        }
      } else {
        if (openReplyBox(commentElement)) {
          const inserted = await insertReplyText(commentElement, reply.trim());
          if (!inserted) throw new Error('Could not insert reply text');
        } else {
          throw new Error('Could not open reply box');
        }
      }
    } catch (error) {
      console.error('[YT AI] Reply Error:', error);
      alert(`AI Reply Error: ${error.message}`);
    } finally {
      button.innerHTML = originalContent;
      button.disabled = false;
    }
  }

  // --- Button injection ---

  function injectAIButton(commentElement) {
    if (processedComments.has(commentElement)) return;

    const actionButtons = commentElement.querySelector('#action-buttons, ytd-comment-action-buttons-renderer');
    if (!actionButtons) return;
    if (actionButtons.querySelector('.ytb-ai-comment-btn')) return;

    const videoId = getVideoId(commentElement);

    const wrapper = document.createElement('span');
    wrapper.className = 'ytb-ai-btn-wrapper';

    const aiButton = createAIButton(false);
    aiButton.addEventListener('click', handleAIButtonClick);
    wrapper.appendChild(aiButton);

    const transcriptIcon = createTranscriptIcon(videoId);
    wrapper.appendChild(transcriptIcon);

    actionButtons.appendChild(wrapper);
    processedComments.add(commentElement);
  }

  function injectStudioAIButton(commentElement) {
    if (processedComments.has(commentElement)) return;
    if (commentElement.querySelector('.ytb-ai-comment-btn')) return;

    let replyButton = null;
    const selectors = [
      'button[aria-label*="Reply"]', 'button[aria-label*="reply"]',
      '#reply-button button', 'ytcp-button#reply-button',
      '[id*="reply"] button', '.reply-button'
    ];

    for (const selector of selectors) {
      replyButton = commentElement.querySelector(selector);
      if (replyButton) break;
    }

    if (!replyButton) {
      const buttons = commentElement.querySelectorAll('button, ytcp-button, [role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        if (text === 'reply' || text === 'répondre') {
          replyButton = btn;
          break;
        }
      }
    }

    if (!replyButton) return;

    const videoId = getVideoId(commentElement);

    const wrapper = document.createElement('span');
    wrapper.className = 'ytb-ai-btn-wrapper';

    const aiButton = createAIButton(true);
    aiButton.addEventListener('click', handleAIButtonClick);
    wrapper.appendChild(aiButton);

    const transcriptIcon = createTranscriptIcon(videoId);
    wrapper.appendChild(transcriptIcon);

    try {
      if (replyButton.parentNode) {
        replyButton.parentNode.insertBefore(wrapper, replyButton.nextSibling);
      }
    } catch (e) {
      commentElement.appendChild(wrapper);
    }

    processedComments.add(commentElement);
  }

  // --- Comment processing ---

  function processComments() {
    if (isYouTubeStudio) {
      let studioComments = document.querySelectorAll('ytcp-comment-row');
      if (studioComments.length === 0) studioComments = document.querySelectorAll('[class*="comment-row"]');
      if (studioComments.length === 0) studioComments = document.querySelectorAll('ytcp-comment-thread');
      if (studioComments.length === 0) studioComments = document.querySelectorAll('ytcp-comment-view-model');

      if (studioComments.length === 0) {
        const replyButtons = document.querySelectorAll('button');
        const commentContainers = new Set();
        replyButtons.forEach(btn => {
          if (btn.textContent.trim() === 'Reply') {
            let parent = btn.parentElement;
            for (let i = 0; i < 5; i++) {
              if (parent && parent.parentElement) parent = parent.parentElement;
            }
            if (parent) commentContainers.add(parent);
          }
        });
        studioComments = Array.from(commentContainers);
      }

      studioComments.forEach(injectStudioAIButton);
    } else {
      const comments = document.querySelectorAll('ytd-comment-thread-renderer, ytd-comment-renderer');
      comments.forEach(injectAIButton);
    }
  }

  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) {
        clearTimeout(window.ytbAIProcessTimeout);
        window.ytbAIProcessTimeout = setTimeout(processComments, 300);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  // --- Init ---

  function init() {
    processComments();
    setupObserver();

    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(processComments, 500);
    }, { passive: true });

    console.log('[YT AI] Extension loaded -', isYouTubeStudio ? 'YouTube Studio mode' : 'YouTube mode');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, isYouTubeStudio ? 2000 : 1000);
    });
  } else {
    setTimeout(init, isYouTubeStudio ? 2000 : 1000);
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[YT AI] URL changed, re-processing...');
      setTimeout(processComments, 1500);
    }
  }).observe(document.body, { subtree: true, childList: true });

})();
