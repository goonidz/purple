import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TEXT_LENGTH = 50_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { 
      script, 
      voice = 'English_expressive_narrator', 
      model = 'speech-2.8-turbo', 
      speed = 1.0,
      pitch = 0,
      volume = 1.0,
      languageBoost = 'auto',
      englishNormalization = true,
      emotion,
      projectId,
      userId: passedUserId
    } = await req.json();

    let userId: string;
    
    if (passedUserId && authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'NO_MATCH')) {
      userId = passedUserId;
    } else {
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    }

    if (!script) {
      throw new Error("Script is required");
    }

    if (script.length > MAX_TEXT_LENGTH) {
      throw new Error(`Text too long: ${script.length} characters (max ${MAX_TEXT_LENGTH.toLocaleString()})`);
    }

    console.log(`MiniMax TTS: ${script.length} chars, model=${model}, voice=${voice}`);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin.rpc(
      'get_user_api_key_for_service',
      { target_user_id: userId, key_name: 'minimax' }
    );

    if (apiKeyError || !apiKeyData) {
      return new Response(
        JSON.stringify({ error: "MiniMax API key not configured. Please add it in your profile." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const voiceId = voice || "English_expressive_narrator";

    // Always use async v2 API — handles up to 50k chars in a single call
    const { audioBytes, duration } = await generateAudioAsyncV2(
      apiKeyData, script, model, voiceId, speed, volume, pitch,
      languageBoost, englishNormalization, emotion
    );

    console.log(`Audio generated (${audioBytes.length} bytes, ~${duration}s), uploading...`);

    const timestamp = Date.now();
    const filename = `${userId}/${projectId || 'temp'}/${timestamp}_minimax_generated.mp3`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('audio-files')
      .upload(filename, audioBytes, { contentType: 'audio/mpeg', upsert: true });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('audio-files')
      .getPublicUrl(filename);

    console.log("Uploaded:", publicUrl);

    // Update project audio_url
    if (projectId) {
      await supabaseAdmin
        .from('projects')
        .update({ audio_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', projectId);
    }

    return new Response(
      JSON.stringify({ audioUrl: publicUrl, duration }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("MiniMax TTS error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generateAudioAsyncV2(
  apiKey: string,
  text: string,
  model: string,
  voiceId: string,
  speed: number,
  volume: number,
  pitch: number,
  languageBoost: string,
  englishNormalization: boolean,
  emotion?: string
): Promise<{ audioBytes: Uint8Array; duration: number }> {

  // Step 1: Create async task
  const body: Record<string, any> = {
    model,
    text,
    language_boost: languageBoost,
    voice_setting: {
      voice_id: voiceId,
      speed,
      vol: volume,
      pitch,
      english_normalization: englishNormalization,
    },
    audio_setting: {
      audio_sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1,
    },
  };

  if (emotion && emotion !== 'neutral') {
    body.voice_setting.emotion = emotion;
  }

  console.log("Creating async v2 task...");
  const createResponse = await fetch('https://api.minimax.io/v1/t2a_async_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error("MiniMax async create error:", createResponse.status, errorText);
    throw new Error(`MiniMax API error ${createResponse.status}: ${errorText.substring(0, 300)}`);
  }

  const createResult = await createResponse.json();
  console.log("Task created:", JSON.stringify(createResult).substring(0, 300));

  if (createResult.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax API error: ${createResult.base_resp?.status_msg || 'Unknown error'} (code ${createResult.base_resp?.status_code})`);
  }

  const taskId = createResult.task_id;
  const fileId = createResult.file_id;
  if (!taskId) throw new Error("No task_id in response");

  console.log(`Task ${taskId} created, file_id=${fileId}, polling...`);

  // Step 2: Poll for completion (max 15 minutes)
  const MAX_ATTEMPTS = 180;
  const POLL_MS = 5000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));

    const statusResponse = await fetch(
      `https://api.minimax.io/v1/query/t2a_async_v2?task_id=${taskId}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );

    if (!statusResponse.ok) {
      console.error(`Poll error (attempt ${attempt + 1}): HTTP ${statusResponse.status}`);
      continue;
    }

    const statusResult = await statusResponse.json();

    if (statusResult.base_resp?.status_code !== 0) {
      throw new Error(`MiniMax poll error: ${statusResult.base_resp?.status_msg || 'Unknown'}`);
    }

    // Status: 0=preparing, 1=running, 2=success, 3=failed
    if (statusResult.status === 2) {
      const audioUrl = statusResult.file_url || statusResult.audio_file?.download_url;
      if (!audioUrl) {
        console.error("No audio URL in completed task:", JSON.stringify(statusResult).substring(0, 500));
        throw new Error("Task completed but no audio URL returned");
      }

      console.log(`Task complete (attempt ${attempt + 1}), downloading audio...`);

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Failed to download audio: HTTP ${audioResponse.status}`);
      }

      const audioBytes = new Uint8Array(await audioResponse.arrayBuffer());
      const duration = statusResult.extra_info?.audio_length
        ? Math.round(statusResult.extra_info.audio_length / 1000)
        : Math.round(text.split(/\s+/).length / 2.5);

      return { audioBytes, duration };
    }

    if (statusResult.status === 3) {
      throw new Error(`MiniMax task failed: ${statusResult.error_message || 'Unknown error'}`);
    }

    if (attempt % 12 === 11) {
      console.log(`Still polling... (attempt ${attempt + 1}/${MAX_ATTEMPTS}, status=${statusResult.status})`);
    }
  }

  throw new Error(`MiniMax task timed out after ${(MAX_ATTEMPTS * POLL_MS / 60000).toFixed(0)} minutes`);
}
