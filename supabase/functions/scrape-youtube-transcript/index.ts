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

// Poll Apify dataset until run is complete
async function pollApifyDataset(
  runId: string,
  datasetId: string,
  token: string,
  maxAttempts: number = 15,
  delayMs: number = 2000
): Promise<any[]> {
  const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    try {
      const response = await fetch(datasetUrl);
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          return data;
        }
      }
    } catch (error) {
      console.error(`Poll attempt ${attempt + 1} failed:`, error);
    }
  }
  
  throw new Error('Timeout: Dataset not ready after maximum attempts');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, calendarEntryId } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL YouTube requise' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!calendarEntryId) {
      return new Response(
        JSON.stringify({ error: 'calendarEntryId requis' }),
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

    // Get user authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client for user auth
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get user
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Supabase service role key for database updates and vault access
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Configuration Supabase manquante' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user's Apify API key from Supabase Vault using service role
    const { data: apifyToken, error: apiKeyError } = await supabase
      .rpc('get_user_api_key_for_service', {
        target_user_id: user.id,
        key_name: 'apify'
      });

    if (apiKeyError || !apifyToken) {
      console.error('Error retrieving Apify API key:', apiKeyError);
      return new Response(
        JSON.stringify({ 
          error: 'Apify API key not configured. Please add your API key in your profile.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Start Apify actor run
    const actorId = 'topaz_sharingan~youtube-transcript-scraper-1';
    const startRunUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}`;
    
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    const startResponse = await fetch(startRunUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startUrls: [{ url: youtubeUrl }],
      }),
    });

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      console.error('Apify start run error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Erreur lors du démarrage du scraping Apify' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const runData = await startResponse.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    console.log(`Apify run started: ${runId}, dataset: ${datasetId}`);

    // Poll dataset until transcript is available
    let transcriptData: any[] = [];
    try {
      transcriptData = await pollApifyDataset(runId, datasetId, apifyToken);
    } catch (error) {
      console.error('Error polling Apify dataset:', error);
      return new Response(
        JSON.stringify({ error: 'Timeout: La transcription n\'a pas pu être récupérée' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract transcript text from Apify data
    // The structure may vary, but typically it's an array with transcript objects
    let transcriptText = '';
    
    console.log('Apify dataset data (full):', JSON.stringify(transcriptData, null, 2));
    
    if (transcriptData && transcriptData.length > 0) {
      // Try to find transcript in various possible formats
      const firstItem = transcriptData[0];
      
      console.log('First item structure:', JSON.stringify(firstItem, null, 2));
      
      if (firstItem.transcript) {
        console.log('Found transcript in firstItem.transcript');
        transcriptText = firstItem.transcript;
      } else if (firstItem.text) {
        console.log('Found transcript in firstItem.text');
        transcriptText = firstItem.text;
      } else if (firstItem.transcripts && Array.isArray(firstItem.transcripts)) {
        // If it's an array of transcript segments, join them
        console.log('Found transcripts array with', firstItem.transcripts.length, 'segments');
        transcriptText = firstItem.transcripts
          .map((seg: any) => seg.text || seg.transcript || '')
          .join(' ');
      } else if (firstItem.subtitles && Array.isArray(firstItem.subtitles)) {
        // Try subtitles field (another common format)
        console.log('Found subtitles array with', firstItem.subtitles.length, 'segments');
        transcriptText = firstItem.subtitles
          .map((seg: any) => seg.text || seg.transcript || '')
          .join(' ');
      } else if (typeof firstItem === 'string') {
        console.log('First item is a string');
        transcriptText = firstItem;
      } else {
        // Try to stringify and extract text from any field containing "transcript" or "text"
        console.log('Trying regex extraction...');
        const jsonStr = JSON.stringify(firstItem);
        
        // Try multiple patterns
        const transcriptMatch = jsonStr.match(/"transcript":\s*"([^"]+)"/i) ||
                               jsonStr.match(/"text":\s*"([^"]+)"/i) ||
                               jsonStr.match(/"subtitles":\s*"([^"]+)"/i);
        
        if (transcriptMatch) {
          console.log('Found transcript via regex');
          transcriptText = transcriptMatch[1];
        } else {
          // Last resort: check all string values in the object
          console.log('Searching all object values...');
          const allValues = Object.values(firstItem);
          for (const value of allValues) {
            if (typeof value === 'string' && value.length > 100) {
              console.log('Found long string value, using as transcript');
              transcriptText = value;
              break;
            }
          }
        }
      }
    }

    if (!transcriptText) {
      console.error('No transcript found in Apify data. Full data:', JSON.stringify(transcriptData, null, 2));
      return new Response(
        JSON.stringify({ 
          error: 'Aucune transcription trouvée dans les données Apify',
          debug: {
            dataReceived: transcriptData,
            dataLength: transcriptData?.length || 0,
            firstItemKeys: transcriptData?.[0] ? Object.keys(transcriptData[0]) : []
          }
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update calendar entry with transcript
    const { error: updateError } = await supabase
      .from('content_calendar')
      .update({ source_transcript: transcriptText })
      .eq('id', calendarEntryId);

    if (updateError) {
      console.error('Error updating calendar entry:', updateError);
      return new Response(
        JSON.stringify({ error: 'Erreur lors de la mise à jour de l\'entrée calendrier' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        transcript: transcriptText,
        length: transcriptText.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error scraping YouTube transcript:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erreur lors du scraping de la transcription' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
