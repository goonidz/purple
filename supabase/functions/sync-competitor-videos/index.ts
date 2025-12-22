import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Calculate period date filter
function getPeriodDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
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

    const { channelId, period = '30d' } = await req.json();

    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");
    if (!YOUTUBE_API_KEY) {
      throw new Error("YOUTUBE_API_KEY is not configured");
    }

    // Get channels to sync
    let channelsQuery = supabase
      .from('competitor_channels')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (channelId) {
      channelsQuery = channelsQuery.eq('channel_id', channelId);
    }

    const { data: channels, error: channelsError } = await channelsQuery;

    if (channelsError) {
      throw new Error("Failed to fetch channels");
    }

    if (!channels || channels.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No channels to sync", synced: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const periodDate = getPeriodDate(period);
    const publishedAfter = periodDate.toISOString();
    
    console.log(`Syncing ${channels.length} channels for period ${period} (after ${publishedAfter})`);

    let totalVideosSynced = 0;
    const errors: string[] = [];

    for (const channel of channels) {
      try {
        console.log(`Syncing channel: ${channel.channel_name} (${channel.channel_id})`);

        // Fetch videos from this channel
        const videosUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channel.channel_id}&type=video&order=date&publishedAfter=${publishedAfter}&maxResults=50&key=${YOUTUBE_API_KEY}`;
        const videosResponse = await fetch(videosUrl);
        const videosData = await videosResponse.json();

        if (!videosResponse.ok) {
          console.error(`Failed to fetch videos for ${channel.channel_name}:`, videosData);
          errors.push(`${channel.channel_name}: Failed to fetch videos`);
          continue;
        }

        if (!videosData.items?.length) {
          console.log(`No videos found for ${channel.channel_name} in period`);
          continue;
        }

        // Get video IDs
        const videoIds = videosData.items.map((v: any) => v.id.videoId).filter(Boolean);
        
        if (videoIds.length === 0) {
          continue;
        }

        // Fetch video statistics
        const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`;
        const statsResponse = await fetch(statsUrl);
        const statsData = await statsResponse.json();

        if (!statsResponse.ok) {
          console.error(`Failed to fetch stats for ${channel.channel_name}:`, statsData);
          errors.push(`${channel.channel_name}: Failed to fetch video stats`);
          continue;
        }

        // Process each video
        const videosToUpsert = [];
        const avgViews = channel.avg_views_per_video || 1; // Avoid division by zero

        for (const video of statsData.items || []) {
          const publishedAt = new Date(video.snippet.publishedAt);
          const hoursAgo = Math.max(1, (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60));
          const viewCount = parseInt(video.statistics.viewCount) || 0;
          const likeCount = parseInt(video.statistics.likeCount) || 0;
          const commentCount = parseInt(video.statistics.commentCount) || 0;

          const viewsPerHour = viewCount / hoursAgo;
          const outlierScore = viewCount / avgViews;

          videosToUpsert.push({
            channel_id: channel.channel_id,
            video_id: video.id,
            title: video.snippet.title,
            thumbnail_url: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url,
            published_at: video.snippet.publishedAt,
            view_count: viewCount,
            like_count: likeCount,
            comment_count: commentCount,
            views_per_hour: parseFloat(viewsPerHour.toFixed(2)),
            outlier_score: parseFloat(outlierScore.toFixed(2)),
            last_fetched_at: new Date().toISOString(),
          });
        }

        // Upsert videos
        if (videosToUpsert.length > 0) {
          const { error: upsertError } = await supabase
            .from('competitor_videos')
            .upsert(videosToUpsert, { onConflict: 'video_id' });

          if (upsertError) {
            console.error(`Failed to upsert videos for ${channel.channel_name}:`, upsertError);
            errors.push(`${channel.channel_name}: Failed to save videos`);
          } else {
            totalVideosSynced += videosToUpsert.length;
            console.log(`Synced ${videosToUpsert.length} videos for ${channel.channel_name}`);
          }
        }

        // Update channel's updated_at
        await supabase
          .from('competitor_channels')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', channel.id);

      } catch (channelError) {
        console.error(`Error syncing channel ${channel.channel_name}:`, channelError);
        errors.push(`${channel.channel_name}: ${channelError instanceof Error ? channelError.message : 'Unknown error'}`);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: totalVideosSynced,
        channels: channels.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in sync-competitor-videos:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to sync videos";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
