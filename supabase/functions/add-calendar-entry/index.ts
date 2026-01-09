import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const { title, youtube_url, channel_id, scheduled_date } = await req.json();

    // Validate required fields
    if (!youtube_url || !scheduled_date) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required fields', 
          required: ['youtube_url', 'scheduled_date']
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate YouTube URL format
    const youtubePatterns = [
      /youtube\.com\/watch/i,
      /youtu\.be\//i,
      /youtube\.com\/shorts\//i,
      /youtube\.com\/embed\//i,
    ];
    
    const isValidYoutubeUrl = youtubePatterns.some(pattern => pattern.test(youtube_url));
    if (!isValidYoutubeUrl) {
      return new Response(
        JSON.stringify({ error: 'Invalid YouTube URL format' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Insert into content_calendar
    // Only fill source_url (not youtube_url) to trigger automatic scraping
    const { data, error } = await supabase
      .from('content_calendar')
      .insert({
        user_id: user.id,
        title: title?.trim() || 'Vidéo YouTube',
        source_url: youtube_url.trim(),
        channel_id: channel_id || null,
        scheduled_date: scheduled_date,
        status: 'planned',
        notes: `Ajouté via extension Chrome le ${new Date().toISOString()}`
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting calendar entry:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Calendar entry created by user ${user.id}: "${title}" on ${scheduled_date}`);

    // Launch scraping in background (fire and forget)
    const baseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const userProvidedTitle = title?.trim();
    
    const scrapingPromise = (async () => {
      try {
        // 1. Scrape title and thumbnail
        const scrapeResponse = await fetch(`${baseUrl}/functions/v1/scrape-youtube`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: youtube_url }),
        });

        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json();
          
          // Only update title if user didn't provide one
          const updateData: any = {
            source_thumbnail_url: scrapeData.thumbnailUrl,
          };
          
          if (!userProvidedTitle) {
            updateData.title = scrapeData.title || 'Vidéo YouTube';
          }
          
          // Update entry with scraped data
          await supabase
            .from('content_calendar')
            .update(updateData)
            .eq('id', data.id);

          console.log(`Scraped ${userProvidedTitle ? 'thumbnail' : 'title and thumbnail'} for entry ${data.id}`);
        }

        // 2. Scrape transcript (in background, don't await)
        fetch(`${baseUrl}/functions/v1/scrape-youtube-transcript`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            url: youtube_url,
            calendarEntryId: data.id 
          }),
        }).catch(err => {
          console.error('Transcript scraping failed (background):', err);
        });

      } catch (error) {
        console.error('Background scraping error:', error);
      }
    })();

    // Don't await the promise - let it run in background
    scrapingPromise.catch(() => {}); // Suppress unhandled rejection

    return new Response(
      JSON.stringify({ success: true, data }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
