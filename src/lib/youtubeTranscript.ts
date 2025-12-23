// Client-side YouTube transcript fetcher
// Fetches transcripts directly from the user's browser (no server needed)

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
];

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  source: string;
}

// Extract video ID from YouTube URL
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Fetch with CORS proxy
async function fetchWithProxy(url: string): Promise<string | null> {
  for (const proxy of CORS_PROXIES) {
    try {
      const proxyUrl = proxy + encodeURIComponent(url);
      const response = await fetch(proxyUrl);
      
      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      console.log(`Proxy ${proxy} failed, trying next...`);
    }
  }
  return null;
}

// Parse XML transcript to segments
function parseTranscriptXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const textMatches = xml.matchAll(/<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([^<]*)<\/text>/g);
  
  for (const match of textMatches) {
    const start = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    let text = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\\n/g, ' ')
      .replace(/\n/g, ' ')
      .trim();
    
    if (text) {
      segments.push({ text, start, duration });
    }
  }
  
  return segments;
}

// Main function to fetch transcript
export async function fetchYouTubeTranscript(videoUrl: string): Promise<TranscriptResult | null> {
  const videoId = extractVideoId(videoUrl);
  
  if (!videoId) {
    console.error('Invalid YouTube URL');
    return null;
  }
  
  console.log(`Fetching transcript for video: ${videoId}`);
  
  // Method 1: Try Invidious instances (most reliable)
  const invidiousInstances = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://vid.puffyan.us',
    'https://invidious.privacyredirect.com',
  ];
  
  for (const instance of invidiousInstances) {
    try {
      console.log(`Trying Invidious: ${instance}`);
      
      // Get captions list
      const captionsResponse = await fetch(`${instance}/api/v1/captions/${videoId}`);
      
      if (captionsResponse.ok) {
        const captionsData = await captionsResponse.json();
        
        if (captionsData.captions && captionsData.captions.length > 0) {
          // Prefer auto-generated or first available
          const caption = captionsData.captions.find((c: any) => 
            c.label?.toLowerCase().includes('auto') || 
            c.label?.toLowerCase().includes('english') ||
            c.label?.toLowerCase().includes('français')
          ) || captionsData.captions[0];
          
          if (caption) {
            // Fetch transcript in VTT format
            const transcriptUrl = `${instance}${caption.url}`;
            const transcriptResponse = await fetch(transcriptUrl);
            
            if (transcriptResponse.ok) {
              const vttContent = await transcriptResponse.text();
              
              // Parse VTT
              const lines = vttContent.split('\n');
              const segments: TranscriptSegment[] = [];
              let currentStart = 0;
              
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Parse timestamp line
                const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
                if (timeMatch) {
                  currentStart = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
                  continue;
                }
                
                // Skip headers and empty lines
                if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || 
                    line.startsWith('Language:') || line === '' || /^\d+$/.test(line)) {
                  continue;
                }
                
                // Clean text
                const text = line
                  .replace(/<[^>]+>/g, '')
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .trim();
                
                if (text) {
                  segments.push({ text, start: currentStart, duration: 0 });
                }
              }
              
              if (segments.length > 0) {
                const fullText = segments.map(s => s.text).join(' ');
                console.log(`✅ Transcript fetched via ${instance}, ${segments.length} segments`);
                return {
                  text: fullText,
                  segments,
                  source: 'invidious'
                };
              }
            }
          }
        }
      }
    } catch (error) {
      console.log(`Invidious ${instance} failed:`, error);
    }
  }
  
  // Method 2: Direct YouTube with CORS proxy
  try {
    console.log('Trying direct YouTube with CORS proxy...');
    
    const html = await fetchWithProxy(`https://www.youtube.com/watch?v=${videoId}`);
    
    if (html) {
      // Extract ytInitialPlayerResponse
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      
      if (playerMatch) {
        const playerData = JSON.parse(playerMatch[1]);
        const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (captionTracks && captionTracks.length > 0) {
          const track = captionTracks[0];
          const captionXml = await fetchWithProxy(track.baseUrl);
          
          if (captionXml) {
            const segments = parseTranscriptXml(captionXml);
            
            if (segments.length > 0) {
              const fullText = segments.map(s => s.text).join(' ');
              console.log(`✅ Transcript fetched via CORS proxy, ${segments.length} segments`);
              return {
                text: fullText,
                segments,
                source: 'youtube_cors'
              };
            }
          }
        }
      }
    }
  } catch (error) {
    console.log('CORS proxy method failed:', error);
  }
  
  console.log('❌ No transcript available');
  return null;
}
