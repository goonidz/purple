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

    // Try to fetch transcript (optional, don't fail if unavailable)
    let transcript = null;
    try {
      console.log('Attempting to fetch transcript for video:', videoId);
      
      // Fetch the YouTube watch page to get transcript data
      const watchPageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const pageResponse = await fetch(watchPageUrl);
      const pageHtml = await pageResponse.text();
      
      // Try to extract transcript from the page
      // YouTube stores transcript data in a script tag with ytInitialPlayerResponse
      const ytInitialPlayerResponseMatch = pageHtml.match(/var ytInitialPlayerResponse = ({.+?});/s);
      
      if (ytInitialPlayerResponseMatch) {
        try {
          const playerResponse = JSON.parse(ytInitialPlayerResponseMatch[1]);
          const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          
          if (captions && captions.length > 0) {
            // Get the first available caption track (usually auto-generated)
            const captionTrack = captions.find((track: any) => track.kind === 'asr') || captions[0];
            const baseUrl = captionTrack?.baseUrl;
            
            if (baseUrl) {
              console.log('Found caption track, fetching transcript from:', baseUrl);
              const transcriptResponse = await fetch(baseUrl);
              const transcriptXml = await transcriptResponse.text();
              
              // Parse XML transcript
              const textMatches = transcriptXml.matchAll(/<text[^>]*>([^<]+)<\/text>/g);
              const transcriptParts: string[] = [];
              
              for (const match of textMatches) {
                transcriptParts.push(match[1].trim());
              }
              
              if (transcriptParts.length > 0) {
                transcript = transcriptParts.join(' ');
                console.log('Transcript extracted, total length:', transcript.length);
              } else {
                console.log('No transcript text found in XML');
              }
            }
          } else {
            console.log('No captions found in player response');
          }
        } catch (parseError: any) {
          console.log('Error parsing player response:', parseError?.message);
        }
      } else {
        console.log('Could not find ytInitialPlayerResponse in page HTML');
      }
    } catch (transcriptError: any) {
      // Transcript not available (video might not have captions)
      console.log('Transcript not available for video:', videoId, 'Error:', transcriptError?.message || transcriptError);
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




