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

    // Try to fetch transcript directly from YouTube (optional, don't fail if unavailable)
    let transcript = null;
    let transcriptSource = null;
    try {
      console.log('Attempting to fetch transcript directly for video:', videoId);
      
      // Fetch the YouTube video page to get caption track info
      const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });
      
      if (videoPageResponse.ok) {
        const html = await videoPageResponse.text();
        
        // Try to find caption track URL in the page
        const captionUrlMatch = html.match(/"captionTracks":\s*\[(.*?)\]/);
        
        if (captionUrlMatch) {
          console.log('Found caption tracks in page');
          
          // Extract the baseUrl for captions
          const baseUrlMatch = captionUrlMatch[1].match(/"baseUrl":\s*"([^"]+)"/);
          
          if (baseUrlMatch) {
            let captionUrl = baseUrlMatch[1].replace(/\\u0026/g, '&');
            console.log('Caption URL found:', captionUrl.substring(0, 100) + '...');
            
            // Fetch the caption XML
            const captionResponse = await fetch(captionUrl);
            
            if (captionResponse.ok) {
              const captionXml = await captionResponse.text();
              
              // Parse the XML to extract text
              const textSegments: string[] = [];
              const textMatches = captionXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
              
              for (const match of textMatches) {
                let text = match[1]
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/&nbsp;/g, ' ')
                  .trim();
                
                if (text) {
                  textSegments.push(text);
                }
              }
              
              if (textSegments.length > 0) {
                transcript = textSegments.join(' ');
                transcriptSource = 'youtube_captions';
                console.log('Transcript extracted successfully, length:', transcript.length, 'segments:', textSegments.length);
              }
            }
          }
        }
        
        // If no captions found, try alternative method (timedtext)
        if (!transcript) {
          const timedtextMatch = html.match(/"baseUrl":\s*"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/);
          
          if (timedtextMatch) {
            let timedtextUrl = timedtextMatch[1].replace(/\\u0026/g, '&');
            console.log('Trying timedtext URL...');
            
            const timedtextResponse = await fetch(timedtextUrl);
            
            if (timedtextResponse.ok) {
              const timedtextXml = await timedtextResponse.text();
              const textSegments: string[] = [];
              const textMatches = timedtextXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
              
              for (const match of textMatches) {
                let text = match[1]
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/&nbsp;/g, ' ')
                  .trim();
                
                if (text) {
                  textSegments.push(text);
                }
              }
              
              if (textSegments.length > 0) {
                transcript = textSegments.join(' ');
                transcriptSource = 'youtube_timedtext';
                console.log('Transcript extracted via timedtext, length:', transcript.length);
              }
            }
          }
        }
        
        if (!transcript) {
          console.log('No captions available for this video');
        }
      }
    } catch (transcriptError: any) {
      console.error('Transcript fetch error:', transcriptError?.message);
      console.log('Could not fetch transcript for video:', videoId);
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




