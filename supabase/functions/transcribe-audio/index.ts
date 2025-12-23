import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's API key from Supabase Vault using service role
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: apiKey, error: apiKeyError } = await supabaseService
      .rpc('get_user_api_key_for_service', {
        target_user_id: user.id,
        key_name: 'replicate'
      });

    if (apiKeyError || !apiKey) {
      console.error('Error retrieving API key:', apiKeyError);
      return new Response(JSON.stringify({ 
        error: 'Replicate API key not configured. Please add your API key in your profile.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const REPLICATE_API_KEY = apiKey;

    const { audioUrl } = await req.json();
    
    if (!audioUrl) {
      throw new Error("audioUrl is required");
    }

    console.log("Starting transcription with Replicate Whisper Diarization for:", audioUrl);

    // Call Replicate API with thomasmol/whisper-diarization model
    const replicateResponse = await fetch("https://api.replicate.com/v1/models/thomasmol/whisper-diarization/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          file_url: audioUrl,
          num_speakers: null, // Auto-detect
          language: null, // Auto-detect
          group_segments: true,
          transcript_output_format: "both", // Get both word-level and segment-level
        },
      }),
    });

    if (!replicateResponse.ok) {
      const errorText = await replicateResponse.text();
      console.error("Replicate API error:", errorText);
      throw new Error(`Replicate API error: ${replicateResponse.status} - ${errorText}`);
    }

    const prediction = await replicateResponse.json();
    console.log("Replicate prediction created:", prediction.id);

    // Poll for completion (Replicate predictions are async)
    let result = prediction;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5s * 120 = 600s)

    while (result.status === "starting" || result.status === "processing") {
      if (attempts >= maxAttempts) {
        throw new Error("Transcription timeout: prediction took too long");
      }

      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: {
          "Authorization": `Token ${REPLICATE_API_KEY}`,
        },
      });

      if (!statusResponse.ok) {
        throw new Error(`Failed to check prediction status: ${statusResponse.status}`);
      }

      result = await statusResponse.json();
      attempts++;
      console.log(`Prediction status (attempt ${attempts}):`, result.status);
    }

    if (result.status === "failed" || result.status === "canceled") {
      throw new Error(`Transcription failed: ${result.error || "Unknown error"}`);
    }

    if (result.status !== "succeeded") {
      throw new Error(`Unexpected prediction status: ${result.status}`);
    }

    const transcriptionData = result.output;
    console.log("Transcription successful");
    console.log("Transcription data:", JSON.stringify(transcriptionData, null, 2));

    // Transform Replicate response to match expected format
    // Replicate returns segments with speaker, start, end, text
    // We need: segments with text, start_time, end_time, and full_text
    const segments = transcriptionData.segments || [];
    const formattedSegments = segments.map((segment: any) => ({
      text: segment.text,
      start_time: segment.start,
      end_time: segment.end,
    }));

    const fullText = segments.map((segment: any) => segment.text).join(" ");

    const formattedTranscript = {
      segments: formattedSegments,
      language_code: transcriptionData.language || "en",
      full_text: fullText,
    };

    console.log("Formatted transcript:", JSON.stringify(formattedTranscript, null, 2));

    return new Response(JSON.stringify(formattedTranscript), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in transcribe-audio function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
