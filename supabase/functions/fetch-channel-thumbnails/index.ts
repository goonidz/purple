import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { channelHandle } = await req.json();
    if (!channelHandle) {
      return new Response(JSON.stringify({ error: 'channelHandle is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");
    if (!YOUTUBE_API_KEY) {
      throw new Error("YOUTUBE_API_KEY is not configured");
    }

    // Normalize handle: strip leading @ if present
    const handle = channelHandle.replace(/^@/, '');

    // Step 1: Resolve handle to channelId
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(handle)}&key=${YOUTUBE_API_KEY}`;
    const channelResponse = await fetch(channelUrl);
    const channelData = await channelResponse.json();

    if (!channelResponse.ok) {
      if (channelResponse.status === 429 || channelData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
        throw new Error('Quota YouTube API dépassée. Réessayez demain.');
      }
      throw new Error(channelData?.error?.message || 'Failed to resolve channel');
    }

    if (!channelData.items || channelData.items.length === 0) {
      return new Response(JSON.stringify({ error: `Chaîne "@${handle}" introuvable` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const channel = channelData.items[0];
    const channelId = channel.id;
    const channelTitle = channel.snippet?.title || handle;

    // Step 2: Get uploads playlist and fetch recent video IDs
    const uploadsPlaylistId = 'UU' + channelId.substring(2);

    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=15&key=${YOUTUBE_API_KEY}`;
    const playlistResponse = await fetch(playlistUrl);
    const playlistData = await playlistResponse.json();

    if (!playlistResponse.ok) {
      if (playlistResponse.status === 429 || playlistData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
        throw new Error('Quota YouTube API dépassée. Réessayez demain.');
      }
      throw new Error(playlistData?.error?.message || 'Failed to fetch channel videos');
    }

    const items = playlistData.items || [];
    if (items.length === 0) {
      return new Response(JSON.stringify({ error: 'Aucune vidéo trouvée sur cette chaîne' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Build thumbnail URLs directly — no API needed for this
    const thumbnailUrls = items
      .map((item: any) => {
        const videoId = item.contentDetails?.videoId;
        return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null;
      })
      .filter(Boolean);

    return new Response(JSON.stringify({ thumbnailUrls, channelTitle }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('fetch-channel-thumbnails error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
