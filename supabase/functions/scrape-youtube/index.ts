import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// VPS Transcription Service URL
const VPS_TRANSCRIPTION_URL = Deno.env.get('VPS_TRANSCRIPTION_URL') || 'http://51.91.158.233:3001';

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

    // Try to fetch transcript via VPS service (optional, don't fail if unavailable)
    let transcript = null;
    let transcriptSource = null;
    try {
      console.log('Attempting to fetch transcript from VPS service for video:', videoId);
      
      // Call VPS transcription service - synchronous mode for quick response
      const transcriptResponse = await fetch(`${VPS_TRANSCRIPTION_URL}/transcribe/youtube/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          language: 'auto',
          forceWhisper: false // Try YouTube captions first
        })
      });
      
      if (transcriptResponse.ok) {
        const transcriptData = await transcriptResponse.json();
        console.log('VPS transcript response:', {
          success: transcriptData.success,
          hasText: !!transcriptData.text,
          textLength: transcriptData.text?.length || 0,
          source: transcriptData.source
        });
        
        if (transcriptData.success && transcriptData.text) {
          transcript = transcriptData.text;
          transcriptSource = transcriptData.source || 'vps';
          console.log('Transcript extracted successfully via VPS, length:', transcript.length);
        }
      } else {
        const errorText = await transcriptResponse.text();
        console.log('VPS transcript service error:', transcriptResponse.status, errorText);
      }
    } catch (transcriptError: any) {
      // VPS service not available or error
      console.error('VPS transcript fetch error:', transcriptError?.message);
      console.log('Transcript service unavailable for video:', videoId);
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




