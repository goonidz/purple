// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addToVideoFlow",
    title: "Ajouter au calendrier VideoFlow",
    contexts: ["link", "page", "selection"],
    documentUrlPatterns: ["*://*.youtube.com/*", "*://*/*"]
  });
  
  console.log('[VideoFlow] Extension installed, context menu created');
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addToVideoFlow") {
    console.log('[VideoFlow] Context menu clicked', info);
    
    // Get URL from clicked link, page URL, or selected text
    let url = info.linkUrl || info.pageUrl || info.selectionText;
    
    // Clean up URL if it's selected text
    if (info.selectionText && !info.linkUrl && !info.pageUrl) {
      url = info.selectionText.trim();
    }
    
    console.log('[VideoFlow] URL:', url);
    
    // Check if it's a YouTube URL
    if (!isYouTubeUrl(url)) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'VideoFlow',
        message: 'Ce n\'est pas une URL YouTube valide'
      });
      return;
    }

    // Extract video info
    const videoInfo = getYouTubeVideoInfo(url, tab);
    
    // Store pending video and open popup
    await chrome.storage.local.set({ 
      pendingVideo: { 
        url, 
        title: videoInfo.title,
        videoId: videoInfo.videoId
      } 
    });
    
    console.log('[VideoFlow] Opening popup with video:', videoInfo);
    
    // Open the extension popup
    chrome.action.openPopup();
  }
});

// Helper: Check if URL is YouTube
function isYouTubeUrl(url) {
  if (!url) return false;
  
  // Support various YouTube URL formats
  const youtubePatterns = [
    /youtube\.com\/watch/i,
    /youtu\.be\//i,
    /youtube\.com\/shorts\//i,
    /youtube\.com\/embed\//i,
    /youtube\.com\/v\//i
  ];
  
  return youtubePatterns.some(pattern => pattern.test(url));
}

// Helper: Get YouTube video info
function getYouTubeVideoInfo(url, tab) {
  const videoId = extractVideoId(url);
  
  // Try to get title from the page if available
  let title = 'Vidéo YouTube';
  
  // If we're on a YouTube page, try to use the tab title
  if (tab && tab.title && tab.url && isYouTubeUrl(tab.url)) {
    // Remove " - YouTube" from the end
    title = tab.title.replace(/ - YouTube$/i, '').trim();
  }
  
  return {
    title,
    videoId,
    thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null
  };
}

// Helper: Extract video ID from URL
function extractVideoId(url) {
  if (!url) return null;
  
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&]+)/i,
    /(?:youtu\.be\/)([^?]+)/i,
    /(?:youtube\.com\/shorts\/)([^?]+)/i,
    /(?:youtube\.com\/embed\/)([^?]+)/i,
    /(?:youtube\.com\/v\/)([^?]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}
