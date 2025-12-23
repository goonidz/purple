import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Extract video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/ // Just the video ID
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Get thumbnail URL (try highest resolution first)
function getThumbnailUrl(videoId: string): string {
  // maxresdefault is the highest quality (1280x720)
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

// Get all thumbnail sizes
function getAllThumbnailUrls(videoId: string): Record<string, string> {
  return {
    maxres: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    hq: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    mq: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    sd: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    default: `https://img.youtube.com/vi/${videoId}/default.jpg`,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL YouTube requise' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const videoId = extractVideoId(url);
    
    if (!videoId) {
      return new Response(
        JSON.stringify({ error: 'URL YouTube invalide' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use YouTube's oEmbed API to get title (no API key needed)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    
    const oembedResponse = await fetch(oembedUrl);
    
    if (!oembedResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Vidéo non trouvée ou privée' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const oembedData = await oembedResponse.json();

    // Check if maxres thumbnail exists (not all videos have it)
    const maxresThumbnail = getThumbnailUrl(videoId);
    const thumbnailCheck = await fetch(maxresThumbnail, { method: 'HEAD' });
    
    // If maxres doesn't exist (404), fall back to hqdefault
    const thumbnailUrl = thumbnailCheck.ok 
      ? maxresThumbnail 
      : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // Try to fetch transcript using multiple methods (optional, don't fail if unavailable)
    let transcript = null;
    let transcriptSource = null;
    
    // Method 1: Try Invidious instances (public YouTube alternative with transcript API)
    const invidiousInstances = [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://invidious.privacyredirect.com',
      'https://vid.puffyan.us',
    ];
    
    for (const instance of invidiousInstances) {
      if (transcript) break;
      
      try {
        console.log(`Trying Invidious instance: ${instance}`);
        
        // Get video captions list
        const captionsResponse = await fetch(`${instance}/api/v1/captions/${videoId}`, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (captionsResponse.ok) {
          const captionsData = await captionsResponse.json();
          console.log('Captions available:', captionsData.captions?.length || 0);
          
          if (captionsData.captions && captionsData.captions.length > 0) {
            // Prefer auto-generated captions or first available
            const caption = captionsData.captions.find((c: any) => c.label?.includes('auto')) 
              || captionsData.captions[0];
            
            if (caption) {
              // Fetch the actual transcript
              const transcriptResponse = await fetch(`${instance}${caption.url}&fmt=vtt`);
              
              if (transcriptResponse.ok) {
                const vttContent = await transcriptResponse.text();
                
                // Parse VTT format
                const lines = vttContent.split('\n');
                const textSegments: string[] = [];
                
                for (const line of lines) {
                  // Skip timing lines, headers, and empty lines
                  if (line.includes('-->') || line.startsWith('WEBVTT') || line.startsWith('Kind:') || 
                      line.startsWith('Language:') || line.trim() === '' || /^\d+$/.test(line.trim())) {
                    continue;
                  }
                  
                  // Clean the text
                  const cleanedText = line
                    .replace(/<[^>]+>/g, '') // Remove HTML tags
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .trim();
                  
                  if (cleanedText && !textSegments.includes(cleanedText)) {
                    textSegments.push(cleanedText);
                  }
                }
                
                if (textSegments.length > 0) {
                  transcript = textSegments.join(' ');
                  transcriptSource = 'invidious';
                  console.log(`Transcript extracted via ${instance}, length: ${transcript.length}`);
                  break;
                }
              }
            }
          }
        }
      } catch (invError: any) {
        console.log(`Invidious ${instance} failed:`, invError.message);
      }
    }
    
    // Method 2: Direct YouTube API (fallback)
    if (!transcript) {
      try {
        console.log('Trying direct YouTube caption fetch...');
        
        const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          }
        });
        
        if (videoPageResponse.ok) {
          const html = await videoPageResponse.text();
          
          // Look for captionTracks in ytInitialPlayerResponse
          const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
          
          if (playerResponseMatch) {
            try {
              const playerData = JSON.parse(playerResponseMatch[1]);
              const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
              
              if (captionTracks && captionTracks.length > 0) {
                const track = captionTracks[0];
                const captionUrl = track.baseUrl;
                
                console.log('Found caption URL in player response');
                
                const captionResponse = await fetch(captionUrl);
                if (captionResponse.ok) {
                  const captionXml = await captionResponse.text();
                  const textSegments: string[] = [];
                  const textMatches = captionXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
                  
                  for (const match of textMatches) {
                    const text = match[1]
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'")
                      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
                      .trim();
                    
                    if (text) {
                      textSegments.push(text);
                    }
                  }
                  
                  if (textSegments.length > 0) {
                    transcript = textSegments.join(' ');
                    transcriptSource = 'youtube_direct';
                    console.log('Transcript extracted via direct YouTube, length:', transcript.length);
                  }
                }
              }
            } catch (parseError) {
              console.log('Could not parse player response');
            }
          }
        }
      } catch (directError: any) {
        console.log('Direct YouTube fetch failed:', directError.message);
      }
    }
    
    if (!transcript) {
      console.log('No transcript available for this video (tried all methods)');
    }

    return new Response(
      JSON.stringify({
        success: true,
        videoId,
        title: oembedData.title,
        author: oembedData.author_name,
        authorUrl: oembedData.author_url,
        thumbnailUrl,
        thumbnails: getAllThumbnailUrls(videoId),
        embedHtml: oembedData.html,
        transcript,
        transcriptSource,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error scraping YouTube:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erreur lors du scraping' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});




