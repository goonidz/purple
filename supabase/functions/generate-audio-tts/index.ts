import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ElevenLabs voice IDs
const VOICE_IDS: Record<string, string> = {
  // French voices
  "charlotte": "XB0fDUnXU5powFXDhCwa",
  "daniel": "onwK4e9ZLuTAKqWW03F9",
  // English voices
  "aria": "9BWtsMINqrJLrRacOk9x",
  "roger": "CwhRBWXzGAHq8TQ4Fs17",
  "sarah": "EXAVITQu4vr4xnSDxMaL",
  "charlie": "IKne3meq5aSn9XLyUdCD",
  "george": "JBFqnCBsd6RMkjVDRZzb",
  "brian": "nPczCjzI2devNBz1zQrb",
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

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { script, voice = 'daniel', projectId } = await req.json();

    if (!script) {
      throw new Error("Script is required");
    }

    console.log("Generating audio for script, length:", script.length);

    // Get user's ElevenLabs API key from Vault
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin.rpc(
      'get_user_api_key_for_service',
      { target_user_id: user.id, key_name: 'eleven_labs' }
    );

    if (apiKeyError || !apiKeyData) {
      console.error("Error fetching ElevenLabs API key:", apiKeyError);
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured. Please add it in your profile." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const voiceId = VOICE_IDS[voice.toLowerCase()] || VOICE_IDS.daniel;

    console.log("Calling ElevenLabs TTS with voice:", voice, "voiceId:", voiceId);

    // Call ElevenLabs TTS API
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKeyData,
        },
        body: JSON.stringify({
          text: script,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      console.error("ElevenLabs API error:", ttsResponse.status, errorText);
      throw new Error(`ElevenLabs API error: ${ttsResponse.status}`);
    }

    console.log("Audio generated, uploading to storage...");

    // Get the audio as ArrayBuffer
    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${user.id}/${projectId || 'temp'}/${timestamp}_generated.mp3`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('audio-files')
      .upload(filename, audioBytes, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('audio-files')
      .getPublicUrl(filename);

    console.log("Audio uploaded to:", publicUrl);

    return new Response(
      JSON.stringify({ 
        audioUrl: publicUrl,
        duration: Math.round(script.split(/\s+/).length / 2.5), // Estimated duration in seconds
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Audio generation error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
