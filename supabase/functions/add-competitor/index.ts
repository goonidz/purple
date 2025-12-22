import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Extract channel ID from various YouTube URL formats
function extractChannelId(input: string): { channelId: string | null; type: 'id' | 'handle' | 'custom' | null } {
  const trimmed = input.trim();
  
  // Direct channel ID (starts with UC)
  if (/^UC[\w-]{22}$/.test(trimmed)) {
    return { channelId: trimmed, type: 'id' };
  }
  
  // URL patterns
  const patterns = [
    // youtube.com/channel/UC...
    { regex: /youtube\.com\/channel\/(UC[\w-]{22})/, type: 'id' as const },
    // youtube.com/@handle
    { regex: /youtube\.com\/@([\w.-]+)/, type: 'handle' as const },
    // youtube.com/c/customname or youtube.com/user/username
    { regex: /youtube\.com\/(?:c|user)\/([\w.-]+)/, type: 'custom' as const },
    // Just a handle starting with @
    { regex: /^@([\w.-]+)$/, type: 'handle' as const },
  ];
  
  for (const { regex, type } of patterns) {
    const match = trimmed.match(regex);
    if (match) {
      return { channelId: match[1], type };
    }
  }
  
  return { channelId: null, type: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Client for user auth
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Service client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { channelUrl } = await req.json();

    if (!channelUrl) {
      return new Response(
        JSON.stringify({ error: "channelUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");
    if (!YOUTUBE_API_KEY) {
      throw new Error("YOUTUBE_API_KEY is not configured");
    }

    // Extract channel identifier
    const { channelId: identifier, type } = extractChannelId(channelUrl);
    
    if (!identifier || !type) {
      return new Response(
        JSON.stringify({ error: "Invalid YouTube channel URL or ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Extracted identifier: ${identifier}, type: ${type}`);

    // Resolve to actual channel ID if needed
    let actualChannelId = identifier;
    
    if (type === 'handle') {
      // Use search API to find channel by handle
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent('@' + identifier)}&key=${YOUTUBE_API_KEY}`;
      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();
      
      if (!searchResponse.ok || !searchData.items?.length) {
        console.error("Channel search failed:", searchData);
        return new Response(
          JSON.stringify({ error: "Chaîne YouTube non trouvée. Vérifiez l'URL ou le handle." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      actualChannelId = searchData.items[0].snippet.channelId;
    } else if (type === 'custom') {
      // Search for custom URL channel
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(identifier)}&key=${YOUTUBE_API_KEY}`;
      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();
      
      if (!searchResponse.ok || !searchData.items?.length) {
        console.error("Channel search failed:", searchData);
        return new Response(
          JSON.stringify({ error: "Chaîne YouTube non trouvée. Vérifiez l'URL ou le handle." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      actualChannelId = searchData.items[0].snippet.channelId;
    }

    console.log(`Resolved channel ID: ${actualChannelId}`);

    // Check if already tracking this channel
    const { data: existing } = await supabase
      .from('competitor_channels')
      .select('id')
      .eq('user_id', user.id)
      .eq('channel_id', actualChannelId)
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({ error: "You are already tracking this channel" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check competitor limit (20 max)
    const { count } = await supabase
      .from('competitor_channels')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (count && count >= 20) {
      return new Response(
        JSON.stringify({ error: "Maximum of 20 competitors reached. Remove some to add new ones." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch channel details
    const channelUrl2 = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${actualChannelId}&key=${YOUTUBE_API_KEY}`;
    const channelResponse = await fetch(channelUrl2);
    const channelData = await channelResponse.json();

    if (!channelResponse.ok || !channelData.items?.length) {
      console.error("Channel fetch failed:", channelData);
      return new Response(
        JSON.stringify({ error: "Failed to fetch channel details" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const channel = channelData.items[0];
    const channelInfo = {
      channel_id: actualChannelId,
      channel_name: channel.snippet.title,
      channel_avatar: channel.snippet.thumbnails?.default?.url || channel.snippet.thumbnails?.medium?.url,
      subscriber_count: parseInt(channel.statistics.subscriberCount) || 0,
    };

    // Fetch recent videos to calculate average views
    const videosUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${actualChannelId}&type=video&order=date&maxResults=30&key=${YOUTUBE_API_KEY}`;
    const videosResponse = await fetch(videosUrl);
    const videosData = await videosResponse.json();

    let avgViewsPerVideo = 0;

    if (videosResponse.ok && videosData.items?.length > 0) {
      // Get video IDs to fetch statistics
      const videoIds = videosData.items.map((v: any) => v.id.videoId).join(',');
      const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}&key=${YOUTUBE_API_KEY}`;
      const statsResponse = await fetch(statsUrl);
      const statsData = await statsResponse.json();

      if (statsResponse.ok && statsData.items?.length > 0) {
        const totalViews = statsData.items.reduce((sum: number, v: any) => {
          return sum + (parseInt(v.statistics.viewCount) || 0);
        }, 0);
        avgViewsPerVideo = Math.round(totalViews / statsData.items.length);
      }
    }

    console.log(`Channel ${channelInfo.channel_name}: avg views = ${avgViewsPerVideo}`);

    // Insert into database
    const { data: insertedChannel, error: insertError } = await supabase
      .from('competitor_channels')
      .insert({
        user_id: user.id,
        ...channelInfo,
        avg_views_per_video: avgViewsPerVideo,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error("Failed to add competitor");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        channel: insertedChannel 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in add-competitor:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to add competitor";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
